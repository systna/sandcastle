# Plan: Sequential Reviewer Quality Gate

> Source PRD: `docs/research/sequential-reviewer-quality-gate.md`

Strengthen the `sequential-reviewer` template into a quality gate: a fixed Claude Code
implementer + Codex reviewer, where the reviewer is read-only and emits structured findings,
the implementer owns all commits/closure, and a task closes only after the reviewer approves.

## Architectural decisions

Durable decisions that apply across all phases:

- **Roles (v1, fixed):** Claude Code = implementer; Codex (`gpt-5.4`) = reviewer. `--agent`
  is ignored with a printed fixed-role note. Selector uses the implementer agent.
- **Codex auth:** host `~/.codex` writable bind-mount
  `{ hostPath: "~/.codex", sandboxPath: "~/.codex" }` (resolves to `/home/agent/.codex`).
  No `OPENAI_KEY`/Codex API key in `.env.example`. Missing `~/.codex` fails early via the
  existing "Mount hostPath does not exist" error.
- **Scaffold strategy:** template-owned, pre-baked `Dockerfile`/`Containerfile` (both CLIs)
  and verbatim `main.mts`, selected by a `scaffoldStrategy: "fixed-role"` branch in
  `scaffold()`. Only `docker`→provider substitution runs; the `claudeCode`/model
  `rewriteMainTs` pass is skipped. `AgentEntry` is **not** refactored into composable blocks.
- **Branch naming:** task branch `sandcastle/issue-{id}`; selector branch
  `sandcastle/sequential-reviewer/selector-{timestamp}`. Task branches are deterministic and
  reused across rounds/runs.
- **Structured output:** selector tag `<task-selection>` (nullable `task`); reviewer tag
  `<review>` (`taskId`, `verdict`, `items[]`, `issueCommentMarkdown`). Gate passes only when
  `items` is non-empty and every item is `approved`; `verdict` must agree with the item list.
- **Public API:** add `output?: OutputDefinition` to `SandboxRunOptions` and typed `output`
  to `SandboxRunResult`, matching top-level `run()` semantics.
- **Scaffold template arg:** optional `COMMENT_TASK_COMMAND` on `IssueTrackerEntry.templateArgs`
  (GitHub: `gh issue comment <ID> --body-file <FILE>`). Non-GitHub trackers are rejected for
  this template before substitution.
- **Comment audit path:** `.sandcastle/logs/review-comments/issue-<ID>-round-<R>.md`
  (`logs/` already gitignored → stays out of commits and the non-mutation guard).
- **Loop bounds:** `MAX_TASKS = 10`, `MAX_REVIEW_ROUNDS = 3`. Fix rounds are fresh
  implementer calls with `REVIEW_FINDINGS` injected via `promptArgs` (no `.resume()`).
- **Release:** `@ai-hero/sandcastle` changeset, type `minor`.

### Two spec-trivia items to resolve during Phase 2

- Verify `sandboxProvider`/registry exposes a `containerfileName` (Docker→`Dockerfile`,
  Podman→`Containerfile`); add it if absent.
- Exclude the template-owned `Dockerfile`/`Containerfile` from the generic template-file
  copy so only the selected one lands in `.sandcastle/`.

---

## Phase 1: `sandbox.run({ output })` public API

**User stories**: PRD §6.1 — reusable sandboxes can extract typed selector and reviewer
payloads while staying warm (foundation for all later phases).

### What to build

Add structured-output support to the reusable `sandbox.run()` path so it behaves like
top-level `run()`: object and string outputs, the `maxIterations === 1` requirement, the
"resolved prompt must contain the opening tag" check, extraction after the iteration, and
`StructuredOutputError` on missing tag / malformed JSON / schema failure. Support
`output.maxRetries` (resume + token-efficient feedback) and reject it for non-resumable
providers. Reuse the existing extraction and retry-feedback logic from top-level `run()`
rather than duplicating it.

### Acceptance criteria

- [ ] `SandboxRunOptions` accepts `output`; `SandboxRunResult` returns typed `output`
- [ ] Returns typed object output and string output; overloads narrow the return type
- [ ] Rejects `output` with `maxIterations > 1`
- [ ] Rejects a resolved prompt missing the opening tag
- [ ] Throws `StructuredOutputError` on malformed JSON / schema failure
- [ ] `output.maxRetries` works for resumable providers; rejected for non-resumable ones
- [ ] Works inside a reusable sandbox without recreating it
- [ ] `npm run typecheck` and `npm test` pass

---

## Phase 2: End-to-end happy path (headline tracer bullet)

**User stories**: PRD §1 target behavior, Goals 1–3; D0, D0.1, D3, §7 scaffold, §5.1–5.3,
§5.7.

### What to build

The thinnest complete run: fixed-role `init` scaffold plus a single-round loop. Scaffold
ships the template-owned dual-CLI `Dockerfile`/`Containerfile`, verbatim `main.mts` (Claude
implementer + Codex reviewer factories, `~/.codex` mount), Claude-only `.env.example`, and
ignores `--agent` with a note. `main.mts` runs: selector (`<task-selection>`) → create
deterministic task sandbox → implement + commit → Codex review (`<review>`) → if approved,
implementer closes the task. GitHub Issues only; no fix loop, guard, or comment posting yet.

### Acceptance criteria

- [ ] `init --template sequential-reviewer` scaffolds the template-owned
      `Dockerfile`/`Containerfile` (both Claude Code + Codex installs), not from `AGENT_REGISTRY`
- [ ] Generated `main.mts` references both `claudeCode` and `codex`, is **not** rewritten to
      `--agent`'s factory/model, and configures `{ hostPath: "~/.codex", sandboxPath: "~/.codex" }`
- [ ] Generated `.env.example` has Claude + issue-tracker auth guidance and **no** Codex key
- [ ] Explicit `--agent` is ignored with the fixed-role note
- [ ] Selector emits a task + deterministic `sandcastle/issue-{id}` branch (or null → clean exit)
      and runs in a separate short-lived sandbox without committing
- [ ] Happy path runs end-to-end: implement → approve → close; next task only after closure
- [ ] No unresolved `{{...}}` template args remain after scaffold
- [ ] `npm run typecheck` and `npm test` pass

---

## Phase 3: Review fix loop + escalation

**User stories**: PRD §1 "repeat implement→review→fix", §5.4, §5.5 gate, §10.5.

### What to build

Add the `changes_requested` path. When the reviewer requests changes, run a fresh implementer
fix round with `REVIEW_FINDINGS` (fix only `changes_requested` items), then re-review, up to
`MAX_REVIEW_ROUNDS`. Validate the verdict/items invariant after schema validation. On
non-convergence, stop and preserve the branch (optionally post a "did not pass" comment).

### Acceptance criteria

- [ ] `changes_requested` triggers a fresh implementer run with `REVIEW_FINDINGS` (not `.resume()`)
- [ ] Approve after a fix round closes the task
- [ ] Gate passes only when items non-empty and all `approved`; verdict/items invariant enforced
- [ ] Workflow stops and preserves the branch after `MAX_REVIEW_ROUNDS`
- [ ] `npm run typecheck` and `npm test` pass

---

## Phase 4: Reviewer non-mutation guard

**User stories**: PRD §9, Goal 5, D1.

### What to build

Capture `git rev-parse HEAD` + `git status --porcelain` (on the task worktree) immediately
before and after the reviewer run. Fail the workflow if the reviewer produced commits, moved
HEAD, or left/changed worktree state; preserve the branch and do not proceed to closure — even
if the reviewer reported approval.

### Acceptance criteria

- [ ] A reviewer that commits fails the guard
- [ ] A reviewer that leaves a dirty worktree fails the guard
- [ ] Guard checks the task worktree only, not the mounted `~/.codex` cache
- [ ] Guard failure preserves the branch and blocks closure
- [ ] `npm run typecheck` and `npm test` pass

---

## Phase 5: Review-comment audit trail

**User stories**: PRD §5.6, D5, Goal 7.

### What to build

Add optional `COMMENT_TASK_COMMAND` (GitHub) to the tracker registry. After each review round
the script writes `issueCommentMarkdown` to `.sandcastle/logs/review-comments/issue-<ID>-round-<R>.md`
and runs an implementer comment prompt that posts it via `{{COMMENT_TASK_COMMAND}}`, then
removes the temp file. The reviewer never runs `gh issue comment`. Reject non-GitHub trackers
for this template at init.

### Acceptance criteria

- [ ] GitHub Issues substitutes `COMMENT_TASK_COMMAND`; field is optional for other registries
- [ ] Implementer posts the reviewer-authored comment before closure
- [ ] Comment temp files live under `.sandcastle/logs/review-comments/` (gitignored)
- [ ] Reviewer is never asked to comment, close, or label
- [ ] Non-GitHub tracker + this template is rejected with a clear error at init
- [ ] `npm run typecheck` and `npm test` pass

---

## Phase 6: Failure-matrix hardening + docs/changeset

**User stories**: PRD §10 (remaining cases), §12, §11.4, Goal 8.

### What to build

Implement the remaining failure behaviors (malformed selector/review → fail loud; implementer
no-commits → stop; review-passes-but-close-fails → fail + preserve; comment-post fails → fail
loud). Update the README template-table wording and (if public) the `sandbox.run({ output })`
sections; add the `minor` changeset; refresh prompt snapshots; ensure the full §11 test matrix
and `typecheck`/`test` are green.

### Acceptance criteria

- [ ] §10 failure cases behave as specified (fail loud / stop / preserve branch as appropriate)
- [ ] README template description and any API docs updated
- [ ] `minor` changeset added for `@ai-hero/sandcastle`
- [ ] Full test matrix (§11.1–11.3) passes; snapshots updated
- [ ] `npm run typecheck` and `npm test` pass
