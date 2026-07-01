# Sequential Reviewer Quality Gate Specification

Status: ready for implementation planning
Date: 2026-06-30

This document specifies the next version of the `sequential-reviewer` template.
The goal is to turn it from an implement-then-review workflow, where the
reviewer may edit the source branch, into a stricter quality gate where the
implementer owns all code changes and issue closure while a distinct reviewer
agent produces structured findings.

## 1. Background

The current `sequential-reviewer` template lives in
`src/templates/sequential-reviewer/`. Its `main.mts` loop creates one named
branch per outer iteration, runs an implementer once, then runs a reviewer in
the same sandbox and branch.

Current behavior:

- The implementer chooses one open task from the issue tracker.
- The implementer writes code, verifies, commits, and closes the task.
- The reviewer reviews the branch diff.
- The reviewer is allowed to make corrections directly on the source branch.
- The loop advances after the review phase finishes.

Target behavior:

- The workflow knows the task id before implementation starts.
- The implementer is the only agent allowed to change code.
- The implementer is the only agent allowed to close the task.
- The reviewer has full repo read access, but must not modify the codebase.
- The reviewer reports structured review items back to the implementer.
- The reviewer authors a task comment body, but the implementer posts it so
  humans can audit the review history.
- The workflow repeats implement -> review -> fix until the review gate passes.
- The next task is selected only after the current task is approved and closed.

## 2. Goals

1. Improve code quality by requiring a distinct reviewer agent to approve each
   task before the next task is selected.
2. Use Claude Code as the implementer and Codex as the reviewer for the first
   implementation.
3. Preserve a single source branch per task so implementation and fixes accrue
   on the same deterministic branch.
4. Make review output machine-readable with an explicit approval gate.
5. Keep reviewer authority narrow: read the repo, inspect diffs, report
   findings, and author comment bodies only.
6. Keep implementer authority broad enough to fix findings, commit changes, and
   post review comments and close the task after approval.
7. Leave an auditable trail of reviewer comments on GitHub Issues when the
   GitHub issue tracker is selected.
8. Keep the template self-contained, following ADR 0009.

## 3. Non-goals

- Do not build a generic workflow engine.
- Do not introduce shared template helpers under `src/templates/_shared`.
- Do not make the reviewer run in a physically read-only sandbox in the first
  implementation. Prompt enforcement plus post-review dirty-state checks are
  the first layer.
- Do not require every issue tracker to support the strengthened
  `sequential-reviewer` workflow in the first implementation. This workflow is
  GitHub-Issues-first because it relies on `gh issue` commands for listing,
  viewing, commenting, and closing.
- Do not let the reviewer close tasks, add labels, open pull requests, or commit
  code.
- Do not change the behavior of other templates except where common public API
  changes require tests or docs.

## 4. Design Decisions

### D0. Fixed default roles, with template-local role configuration

The first implementation uses fixed default roles:

- implementer: Claude Code
- reviewer: Codex

The current `sandcastle init` flow has a single `--agent` option and no separate
reviewer-agent configuration. Therefore the strengthened `sequential-reviewer`
template should not rely on `--agent` to choose roles. It should scaffold Claude
Code for implementation and Codex for review.

For this template, `--agent` is accepted only for CLI compatibility with the
current init flow. The selected agent must not change the fixed roles, the
generated Dockerfile/Containerfile, `.env.example`, or model factories. If the
user passes `--agent` explicitly, init should print a note such as:

```text
sequential-reviewer uses fixed roles: Claude Code implementer and Codex
reviewer. Ignoring --agent=<value> for this template.
```

Rejecting conflicting `--agent` values would also be defensible, but this spec
chooses "ignore with a printed note" to keep existing init invocations working
while making the fixed-role behavior visible.

The generated `main.mts` should still make the roles easy to change by keeping
agent factories and model strings as top-level configuration constants. That is
the first role-configuration seam. A later implementation may add explicit init
options such as `--implementer-agent` and `--reviewer-agent`, but that is not
required for this spec.

Changing the roles in `main.mts` is not enough by itself. The scaffold must
also install the required CLIs, document the required authentication setup, and
configure any runtime mounts required by those CLIs. For Codex, the first
implementation should use the host's cached `~/.codex` directory and inject it
into the sandbox with a runtime bind mount. Do not use `OPENAI_KEY` for this
template.

### D0.1. Codex reviewer auth comes from mounted `~/.codex`

The Codex reviewer should authenticate by reusing the host Codex CLI cache. The
generated `main.mts` must configure the selected bind-mount sandbox provider to
mount:

```ts
{ hostPath: "~/.codex", sandboxPath: "~/.codex" }
```

For Docker and Podman providers, `sandboxPath: "~/.codex"` resolves to
`/home/agent/.codex`, because those providers set the sandbox home directory to
`/home/agent`. The mount should be writable, matching the existing
`sandcastle-systna` runner pattern in
`/Users/Q455042/Documents/dove/sandcastle-systna/.sandcastle/lib/run-pipeline.mts`,
so Codex can refresh ChatGPT auth tokens during a run.

This is a runtime mount requirement, not a Dockerfile requirement. The sandbox
image installs the Codex CLI, but the host auth cache must not be copied into
the image, committed to the repo, or represented as a key in `.env.example`.

Security constraint: mounting `~/.codex` gives processes inside that sandbox
access to Codex credentials and local Codex state. Treat this template as a
trusted local workflow. Do not use this mounted-cache mode for untrusted
repositories, public CI, forked PRs, or workflows that intentionally execute
untrusted project code with network access. A later implementation can add
role-scoped or run-scoped mounts, but the first implementation accepts this
tradeoff to reuse the existing host Codex login.

Preconditions and failure behavior:

- host `~/.codex` must exist before the generated workflow starts
- the host cache must contain usable Codex CLI authentication for noninteractive
  `codex exec`
- if `~/.codex` is missing, sandbox provider mount validation should fail early
  with the existing "Mount hostPath does not exist" error
- if the cache exists but auth is invalid, the Codex reviewer run should fail
  with the Codex CLI auth error
- reviewer dirty-state guards should check only the task worktree, not the
  mounted `~/.codex` cache, because Codex may refresh auth or session files
  there

### D1. Reviewer gets full repo read access

The reviewer should be able to inspect the entire repo, not only a generated
diff packet. Diff-only review misses architectural context, missing test
coverage, and integration bugs. Full read access is the better quality gate.

The reviewer must still be prohibited from modifying the repo. First enforcement
is prompt-level, backed by a post-review guard that fails the workflow if the
reviewer creates commits or leaves uncommitted changes.

### D2. Implementer owns all mutations

The implementer is responsible for:

- code changes
- test changes
- documentation updates required by the task
- commits
- applying reviewer feedback
- posting reviewer-authored GitHub Issue comments
- closing the task after approval

The reviewer is responsible for:

- reading the task, branch diff, commits, tests, and relevant source
- producing structured review items
- producing a Markdown task comment body

The implementer is responsible for posting that comment body to the GitHub
Issue. The reviewer must not call `gh issue comment`.

### D2.1. Current prompt and scaffold facts

The current template and scaffold do not already satisfy this spec:

- `src/templates/sequential-reviewer/main.mts` runs Claude Code for both the
  implementer and reviewer.
- `src/templates/sequential-reviewer/implement-prompt.md` lets the implementer
  pick a task and close it. That does not fit the new process because task
  selection must happen before branch creation and closure must wait for review
  approval.
- `src/templates/sequential-reviewer/review-prompt.md` tells the reviewer to
  make code changes and commit them. That directly conflicts with the new
  reviewer role.
- `init` currently writes one selected agent's Dockerfile and `.env.example`
  block. A Claude Code scaffold installs Claude Code, but it does not install
  Codex.
- The Codex Dockerfile template in `InitService.ts` installs Codex with
  `npm install -g @openai/codex`, and its `.env.example` block currently uses
  `OPENAI_KEY=`.
- `AgentProvider.codex()` does not read `OPENAI_KEY` by name. It invokes the
  Codex CLI with the configured provider env.
- The implementation should not preserve `OPENAI_KEY` for this template.
  Instead, generated `main.mts` should mount host `~/.codex` into the sandbox
  for Codex reviewer auth.

Therefore the implementation must rewrite the sequential-reviewer prompts and
must generate a sandbox image that includes both Claude Code and Codex. The
existing Claude Code install remains necessary; the sequential-reviewer
template-owned Dockerfile/Containerfile must add Codex installation alongside
it. The Codex auth cache mount belongs in the generated sandbox provider
configuration.

### D3. Task selection should be explicit

The current template lets the implementer pick a task inside the implementation
prompt. That makes it hard for the script to know the task id, branch name, and
where review comments should go.

The new workflow should add a selector phase before branch creation. The
selector reads the ready task list and emits structured output:

```json
{
  "task": {
    "id": "123",
    "title": "Fix parser edge case",
    "branch": "sandcastle/issue-123"
  }
}
```

If no task is actionable, the selector emits:

```json
{
  "task": null
}
```

Branch names must be deterministic. For GitHub Issues, use:

```text
sandcastle/issue-{id}
```

### D4. The reviewer gate uses structured review items

The reviewer should not produce unstructured prose as the primary signal. It
should emit a structured object inside a caller-specified XML tag.

The gate passes only when every item is marked `approved`. An empty item list is
not approval. Empty output, malformed JSON, or schema failure is a hard workflow
failure.

### D5. Review comments are authored by the reviewer and posted by the implementer

The reviewer drafts a Markdown comment body. The implementer posts that body to
the GitHub Issue. This preserves reviewer authorship while keeping issue tracker
mutation authority away from the reviewer.

For GitHub Issues, the command should use a file path rather than inline shell
quoting:

```text
gh issue comment <ID> --body-file <FILE>
```

The command should be represented as an issue-tracker template argument so the
template stays issue-tracker aware rather than hard-coding GitHub in the prompt.
Add `COMMENT_TASK_COMMAND` as an optional field on `IssueTrackerEntry`
`templateArgs`, not as a required field shared by all registry entries. In the
first implementation, only the GitHub Issues entry must define it. Beads and
custom trackers may omit it because this template rejects non-GitHub trackers
before scaffold substitution needs the value.

The reviewer must never execute this command. The command is used only by an
implementer prompt.

### D6. Prompt variables are resolved by Sandcastle, not by Codex

Codex does not resolve `{{BRANCH}}`, `{{TASK_ID}}`, `{{TARGET_BRANCH}}`, or
shell expressions in prompt files. Sandcastle resolves the prompt before it
invokes the agent:

1. `init` substitutes scaffold template arguments such as
   `{{LIST_TASKS_COMMAND}}`, `{{VIEW_TASK_COMMAND}}`, `{{COMMENT_TASK_COMMAND}}`,
   and `{{CLOSE_TASK_COMMAND}}`.
2. At runtime, `sandbox.run()` substitutes prompt arguments such as `TASK_ID`,
   `ISSUE_TITLE`, `BRANCH`, `REVIEW_ROUND`, and `REVIEW_FINDINGS`.
3. Sandcastle injects built-in prompt arguments such as `TARGET_BRANCH` and
   `SOURCE_BRANCH`. Callers must not pass these manually.
4. Sandcastle expands shell expressions such as
   `` !`git diff {{TARGET_BRANCH}}...{{BRANCH}}` `` inside the sandbox before
   passing the final prompt to the agent.

If a prompt contains a non-built-in `{{KEY}}` placeholder and the caller does
not provide that key in `promptArgs`, prompt resolution fails before Codex
starts. The implementation must include tests that review prompts are invoked
with all required runtime prompt arguments.

## 5. Proposed Workflow

The template should use an outer loop over tasks and an inner loop over review
rounds.

Suggested configuration constants in the scaffolded `main.mts`:

```ts
const MAX_TASKS = 10;
const MAX_REVIEW_ROUNDS = 3;
const IMPLEMENTER_MODEL = "claude-sonnet-4-6";
const REVIEWER_MODEL = "gpt-5.4";

const implementerAgent = sandcastle.claudeCode(IMPLEMENTER_MODEL);
const reviewerAgent = sandcastle.codex(REVIEWER_MODEL);
```

The model values and agent factories are the role-configuration surface in the
first implementation. If a user changes either role, they must also ensure the
scaffolded Dockerfile/Containerfile installs that agent CLI and the sandbox
configuration provides the required authentication mechanism.

The generated task sandbox should mount the host Codex cache:

```ts
const codexAuthMount = { hostPath: "~/.codex", sandboxPath: "~/.codex" };

const sandbox = await sandcastle.createSandbox({
  branch,
  sandbox: docker({ mounts: [codexAuthMount] }),
  hooks,
  copyToWorktree,
});
```

If the user chose Podman during init, use the same mount entry with `podman()`.

### 5.1 Outer task loop

For each task slot from 1 to `MAX_TASKS`:

1. Run the selector.
2. If no task is returned, print a message and exit.
3. Create or reuse a deterministic task branch.
4. Create one sandbox for that branch.
5. Run implementation.
6. Run review.
7. Ask the implementer to post the reviewer-authored GitHub Issue comment.
8. If review passes, ask the implementer to close the task.
9. Close the sandbox.
10. Move to the next task.

### 5.2 Selector phase

The selector runs before the task branch exists. It should use a short-lived
selector sandbox on a reserved branch such as:

```text
sandcastle/sequential-reviewer/selector-{timestamp}
```

The selector branch is separate from task branches. The selector must not make
commits. If it does, the workflow should fail before creating a task sandbox.
This avoids running the selector in `head` mode, where an accidental write would
touch the host working directory directly.

This deliberately pays one short-lived sandbox spin-up per task slot. That is
slower than letting the implementer select a task inside the task sandbox, but
it gives the script the task id and deterministic branch before any
implementation work begins.

The selector should:

- read the ready task list using `{{LIST_TASKS_COMMAND}}`
- select exactly one highest-priority unblocked task
- emit structured output inside `<task-selection>` tags
- not edit files
- not close or comment on tasks

The selector can use the implementer agent by default to avoid introducing a
third role, but it must run with `maxIterations: 1`.

Schema:

```ts
const taskSelectionSchema = z.object({
  task: z
    .object({
      id: z.string().min(1),
      title: z.string().min(1),
      branch: z.string().min(1),
    })
    .nullable(),
});
```

Recommended prompt file:

```text
.sandcastle/select-task-prompt.md
```

### 5.3 Sandbox creation

After selection, create a sandbox on the selected branch:

```ts
const sandbox = await sandcastle.createSandbox({
  branch: selection.task.branch,
  sandbox: docker({ mounts: [codexAuthMount] }),
  hooks,
  copyToWorktree,
});
```

The branch should be reused across review rounds for the same task. A later run
that selects the same task should reuse the deterministic branch and continue
from existing progress.

### 5.4 Implementation phase

The implementer prompt receives:

- `TASK_ID`
- `ISSUE_TITLE`
- `BRANCH`
- `VIEW_TASK_COMMAND`
- optionally prior review findings for fix rounds

Initial implementation prompt:

- view the selected task
- read relevant code and tests
- implement only that task
- use RGR where applicable
- run `npm run typecheck`
- run `npm run test`
- commit changes
- do not close the task yet
- emit `<promise>COMPLETE</promise>`

Fix-round prompt:

- receive structured reviewer items
- fix only items with `status: "changes_requested"`
- rerun `npm run typecheck`
- rerun `npm run test`
- commit fixes
- do not close the task yet
- emit `<promise>COMPLETE</promise>`

Fix rounds should run as fresh implementer calls with `REVIEW_FINDINGS`
injected through `promptArgs`, not as `.resume()` continuations of the original
implementer session. Fresh calls make each fix round depend on explicit
structured review findings plus the current worktree state, which is simpler to
reason about and test.

The implementer should not select a new task during fix rounds.

### 5.5 Review phase

The reviewer prompt receives:

- task id and title
- branch name
- branch diff against `{{TARGET_BRANCH}}`
- commits on the branch
- current git status
- typecheck and test output, if the script captures it
- review round number
- prior review history, if any
- project coding standards

The reviewer must:

- inspect the full repo as needed
- not edit files
- not run commands that write files
- not commit
- not close, comment on, or label the task
- return structured review output
- include a Markdown issue comment body

Recommended prompt file:

```text
.sandcastle/review-prompt.md
```

The prompt should include the expected tag and a schema example so the
structured-output entry validation succeeds.

Review output tag:

```text
<review>
```

Schema:

```ts
const reviewSchema = z.object({
  taskId: z.string().min(1),
  verdict: z.enum(["approved", "changes_requested"]),
  items: z.array(
    z.object({
      status: z.enum(["approved", "changes_requested"]),
      severity: z.enum(["blocking", "non_blocking"]),
      category: z.enum([
        "correctness",
        "tests",
        "security",
        "maintainability",
        "docs",
        "product",
      ]),
      file: z.string().optional(),
      line: z.number().int().positive().optional(),
      summary: z.string().min(1),
      rationale: z.string().min(1),
      suggestedFix: z.string().min(1).optional(),
    }),
  ),
  issueCommentMarkdown: z.string().min(1),
});
```

Gate rule:

```ts
const approved =
  review.output.items.length > 0 &&
  review.output.items.every((item) => item.status === "approved");
```

The `verdict` must agree with the item list:

- if every item is `approved`, `verdict` must be `approved`
- if any item is `changes_requested`, `verdict` must be `changes_requested`

The script should validate this invariant after schema validation.

### 5.6 Review comment posting

The strengthened `sequential-reviewer` assumes GitHub Issues in the first
implementation. After each review round, the implementer should post the
reviewer's `issueCommentMarkdown` to the selected GitHub Issue.

Add a new scaffold template argument:

```ts
COMMENT_TASK_COMMAND;
```

For GitHub Issues:

```text
gh issue comment <ID> --body-file <FILE>
```

The workflow should write `issueCommentMarkdown` to a deterministic temporary
file inside the task worktree, then run an implementer comment prompt.

Recommended path:

```text
.sandcastle/logs/review-comments/issue-<TASK_ID>-round-<REVIEW_ROUND>.md
```

The generated `.sandcastle/.gitignore` already ignores `logs/`, so this path is
kept out of implementer commits and reviewer non-mutation checks. The script
should create the parent directory when needed. The implementer prompt uses the
comment command with `<ID>` and `<FILE>` substituted, then deletes the temporary
file.

The reviewer must not directly run `gh issue comment`.

If a user selects a non-GitHub issue tracker with this template before a
non-GitHub comment command is designed, init should fail with a clear
unsupported-combination error. Do not silently skip review comments in this
workflow.

Recommended prompt file:

```text
.sandcastle/comment-prompt.md
```

### 5.7 Close phase

Only the implementer may close the task.

After review approval, run an implementer close prompt that:

- receives the approved review output
- receives the task id
- uses `{{CLOSE_TASK_COMMAND}}`
- closes only the current task
- emits `<promise>COMPLETE</promise>`

The close prompt should not ask the implementer to do additional code work.

Recommended prompt file:

```text
.sandcastle/close-prompt.md
```

## 6. Required Public API Work

### 6.1 Add structured output support to `sandbox.run()`

Top-level `run()` supports `output: Output.object(...)` and
`Output.string(...)`. The reusable `sandbox.run()` path does not currently
accept an `output` option.

This template wants to keep one warm sandbox per task branch while extracting
structured selector and reviewer payloads. The clean implementation is to add
`output?: OutputDefinition` to `SandboxRunOptions` and return typed output from
`SandboxRunResult`.

Expected behavior should match top-level `run()`:

- `output` requires `maxIterations === 1`
- resolved prompt must contain the opening XML tag
- extraction happens after the iteration completes
- missing tag, malformed JSON, or schema failure throws `StructuredOutputError`
- `output.maxRetries` requires a resumable provider
- output overloads narrow the return type

This should be implemented before the template rewrite. Manual parsing in the
template is possible, but it would duplicate public behavior and make the
template less useful as an example.

### 6.2 Consider `sandbox.exec()` helper usage for guards

The template can use `sandbox.exec()` for guard checks:

```text
git status --porcelain
git rev-parse HEAD
git log {{TARGET_BRANCH}}..{{BRANCH}} --oneline
```

No new public API is required for these checks.

## 7. Required Init and Scaffold Work

The template uses fixed default agent providers in the first implementation:

- implementer: Claude Code
- reviewer: Codex, defaulting to `gpt-5.4`

Current `init` scaffolds one agent's Dockerfile and `.env.example` block. That
is not enough for a Claude Code implementer plus Codex reviewer.

Implementation requirements:

1. For `sequential-reviewer`, do not use `--agent` as the source of truth for
   role selection. Scaffold Claude Code as implementer and Codex as reviewer.
   If `--agent` is provided, ignore it and print the fixed-role note described
   in D0.
2. Use a template-owned, pre-baked scaffold for this template. Add a contained
   branch in `scaffold()` selected by template metadata, for example
   `scaffoldStrategy: "fixed-role"`. Keep this branch local to init rather than
   refactoring `AgentEntry` into composable Dockerfile blocks in the first
   implementation.
3. Ship `Dockerfile` and `Containerfile` under
   `src/templates/sequential-reviewer/`. Both files must install:
   - Claude Code with `curl -fsSL https://claude.ai/install.sh | bash`
   - Codex with `npm install -g @openai/codex`
   - issue tracker tools via `{{ISSUE_TRACKER_TOOLS}}`
   - the same `ARG AGENT_UID` / `ARG AGENT_GID` user-alignment section used by
     the current agent Dockerfile templates
4. During scaffold, copy the selected provider file to
   `.sandcastle/<Dockerfile|Containerfile>` based on
   `sandboxProvider.containerfileName`. Do not write
   `agent.dockerfileTemplate` from `AGENT_REGISTRY` for this template.
5. Generate `.env.example` from Claude Code authentication guidance plus issue
   tracker authentication guidance only. This may reuse the Claude Code
   registry env block, but must not use the selected `--agent` env block. Do not
   add `OPENAI_KEY`, `CODEX_API_KEY`, or `CODEX_ACCESS_TOKEN`; Codex reviewer
   auth comes from the host `~/.codex` cache mount.
6. Copy `main.mts` with fixed Claude/Codex role factories and fixed default
   model strings. Do not run the `rewriteMainTs` agent factory/model rewrite for
   this template. Apply only the sandbox-provider substitution that changes
   `docker` to the selected provider name, and keep the existing main-filename
   adaptation if init needs to generate `main.ts` instead of `main.mts`.
7. Generate `main.mts` with the selected bind-mount sandbox provider configured
   to mount host `~/.codex` to sandbox `~/.codex`, writable.
8. Ensure init communicates the fixed role behavior and the host Codex cache
   precondition clearly in next steps.
9. For the first implementation, reject non-GitHub issue tracker selections for
   this template before template argument substitution. The workflow depends on
   GitHub Issue comments as review audit history.

Required scaffold verification:

- generated `.sandcastle/Dockerfile` contains both the Claude Code install step
  and the Codex install step
- generated `.sandcastle/Dockerfile` or `.sandcastle/Containerfile` comes from
  the `sequential-reviewer` template directory, not `AGENT_REGISTRY`
- generated `.sandcastle/.env.example` contains Claude Code auth guidance and
  issue tracker auth guidance, but no Codex API-key placeholder
- generated `.sandcastle/main.mts` imports or references both `claudeCode` and
  `codex`
- generated `.sandcastle/main.mts` uses Claude Code for implementer calls and
  Codex for reviewer calls
- generated `.sandcastle/main.mts` configures the selected sandbox provider with
  `{ hostPath: "~/.codex", sandboxPath: "~/.codex" }`
- generated `.sandcastle/main.mts` is not rewritten to the selected `--agent`
  factory or model

## 8. Template File Changes

Expected new or changed files under `src/templates/sequential-reviewer/`:

- `Dockerfile`
- `Containerfile`
- `main.mts`
- `select-task-prompt.md`
- `implement-prompt.md`
- `review-prompt.md`
- `comment-prompt.md`
- `fix-prompt.md`
- `close-prompt.md`
- `CODING_STANDARDS.md`
- `template.json`

The template may choose to fold `fix-prompt.md` into `implement-prompt.md` with
a `REVIEW_FINDINGS` prompt argument, but a separate file is clearer.

The template-owned Dockerfile/Containerfile are part of the template contract.
They should not be generated by composing `AgentEntry` blocks in the first
implementation.

### 8.1 `main.mts`

Responsibilities:

- define role agents
- define Zod schemas
- select one task at a time
- create deterministic branch sandbox
- run implementer
- run review loop
- guard reviewer non-mutation
- ask the implementer to post review comments
- ask implementer to close approved task
- stop after `MAX_TASKS` or no task
- preserve task branch on failure

Important constants:

```ts
const MAX_TASKS = 10;
const MAX_REVIEW_ROUNDS = 3;
const copyToWorktree = ["node_modules"];
const hooks = {
  sandbox: { onSandboxReady: [{ command: "npm install" }] },
};
```

### 8.2 `select-task-prompt.md`

Responsibilities:

- read ready task list
- select one highest-priority unblocked task
- emit `<task-selection>` structured output
- never edit files
- never close or comment on tasks

### 8.3 `implement-prompt.md`

Responsibilities:

- implement exactly one selected task
- commit changes
- do not close task
- do not pick another task

### 8.4 `fix-prompt.md`

Responsibilities:

- receive structured findings
- fix only requested changes
- commit fixes
- do not close task
- do not pick another task

### 8.5 `review-prompt.md`

Responsibilities:

- review full repo and branch diff
- produce structured review output
- author issue comment body
- never modify code or issue state
- never run `gh issue comment`

### 8.6 `comment-prompt.md`

Responsibilities:

- receive the reviewer-authored `issueCommentMarkdown`
- post that exact body to the current GitHub Issue using
  `{{COMMENT_TASK_COMMAND}}`
- do not modify code
- do not close the task
- emit `<promise>COMPLETE</promise>`

### 8.7 `close-prompt.md`

Responsibilities:

- close the approved task using `{{CLOSE_TASK_COMMAND}}`
- do no additional code work

## 9. Reviewer Non-mutation Guard

Prompt enforcement is necessary but not sufficient.

Before review:

```text
git rev-parse HEAD
git status --porcelain
```

After review:

```text
git rev-parse HEAD
git status --porcelain
```

Fail the workflow if:

- `review.commits.length > 0`
- HEAD changed
- `git status --porcelain` changed
- the post-review status is non-empty when it was empty before

Failure behavior:

- print a clear error that the reviewer modified the branch
- do not ask the implementer to close the task
- preserve the branch for human inspection
- close the sandbox normally if possible

The guard should be strict even if the reviewer says the gate passed.

## 10. Failure Handling

### 10.1 Selector returns no task

Exit the outer loop successfully.

### 10.2 Selector output malformed

Fail loudly. This is a template or model compliance problem.

### 10.3 Implementer makes no commits

Treat as no actionable progress. The workflow should stop rather than sending
an empty branch to review.

### 10.4 Review output malformed

Fail loudly and preserve the branch. Do not close the task.

### 10.5 Review requests changes after max rounds

Stop the workflow and preserve the branch. Optionally post a final comment
stating that review did not pass within `MAX_REVIEW_ROUNDS`.

### 10.6 Review passes but close fails

Fail loudly and preserve the branch. Do not move to the next task, because the
current task is still open.

### 10.7 Comment posting fails

Recommended first behavior: fail loudly. The user explicitly wants review
comments as audit history, so losing them silently is not acceptable.

If this proves too brittle, a later option can make comment posting best-effort
behind a config flag.

## 11. Tests

### 11.1 Public API tests

Add tests for `sandbox.run({ output })`:

- returns typed object output
- returns string output
- rejects `output` with `maxIterations > 1`
- rejects missing opening tag in the resolved prompt
- throws `StructuredOutputError` on malformed JSON
- supports `output.maxRetries` for resumable providers
- rejects `output.maxRetries` for non-resumable providers
- works inside a reusable sandbox without recreating the sandbox

### 11.2 Init scaffolding tests

Add or update `InitService` tests:

- `sequential-reviewer` scaffolds new prompt files
- `sequential-reviewer` scaffolds `comment-prompt.md`
- `sequential-reviewer` main imports or references both Claude Code and Codex
- `sequential-reviewer` ignores explicit `--agent` for role selection and emits
  a fixed-role note
- generated Dockerfile/Containerfile is copied from
  `src/templates/sequential-reviewer/`, not from `AGENT_REGISTRY`
- generated `.env.example` includes Claude Code auth guidance and does not
  include a Codex API-key placeholder
- generated `.env.example` does not include `OPENAI_KEY`, `CODEX_API_KEY`, or
  `CODEX_ACCESS_TOKEN`
- generated `.sandcastle/main.mts` mounts host `~/.codex` to sandbox
  `~/.codex`
- generated init next steps tell the user to run or verify host Codex login so
  `~/.codex` exists before running the template
- generated Dockerfile/Containerfile installs both Claude Code and Codex
- GitHub issue tracker substitutes `COMMENT_TASK_COMMAND`
- `COMMENT_TASK_COMMAND` is optional for non-GitHub registry entries
- non-GitHub tracker selections are rejected for this template
- no unresolved `{{...}}` template arguments remain after scaffold
- review prompts invoked by `main.mts` receive all required non-built-in
  `promptArgs`

### 11.3 Template behavior tests

Use fake agent providers and fake sandbox providers where possible:

- selector returns a task and branch
- no task exits cleanly
- selector uses a separate short-lived sandbox and does not commit
- implementer commits, reviewer approves, implementer closes task
- reviewer requests changes, implementer fixes, reviewer approves
- fix rounds pass `REVIEW_FINDINGS` into a fresh implementer run rather than
  resuming the original implementer session
- workflow stops after max review rounds
- reviewer commit causes guard failure
- reviewer dirty worktree causes guard failure
- malformed review output fails
- empty review item list fails
- implementer posts the reviewer-authored GitHub Issue comment before closure
- review comment temp files are written under
  `.sandcastle/logs/review-comments/`
- closure is never attempted before approval
- reviewer is never asked to close the task
- reviewer is never asked to run `gh issue comment`

### 11.4 Documentation and snapshot tests

- Update prompt snapshots if existing tests assert exact scaffolded content.
- Update README template table only if the public description changes.
- Add a changeset because this changes scaffolded public-facing template
  behavior.

## 12. Documentation Requirements

Update README if the template description or documented behavior changes. The
current table says:

```text
sequential-reviewer: Implements issues one by one, with a code review step after each
```

Recommended new wording:

```text
Implements issues one by one with a structured reviewer gate before closure
```

If `sandbox.run({ output })` becomes public API, update README sections for:

- `createSandbox()`
- `SandboxRunOptions`
- structured output

Add a changeset:

- package: `@ai-hero/sandcastle`
- type: `minor`
- reason: this is public-facing template behavior and a public API addition

## 13. Acceptance Criteria

The implementation is complete when:

1. `sequential-reviewer` selects a task before branch creation.
2. Task branches are deterministic.
3. The scaffold uses Claude Code as implementer and Codex as reviewer.
4. Role factories and model strings are visible as template-local
   configuration in `main.mts`.
5. Explicit `--agent` selections are ignored for this template with a printed
   fixed-role note.
6. The scaffolded sandbox image comes from the `sequential-reviewer`
   template-owned Dockerfile/Containerfile and supports both Claude Code and
   Codex CLIs.
7. Generated `main.mts` is not rewritten to the selected `--agent` factory or
   model.
8. Generated `main.mts` injects host `~/.codex` into the sandbox as writable
   sandbox `~/.codex` for Codex reviewer auth.
9. Generated `.env.example` does not ask for a Codex API key.
10. `COMMENT_TASK_COMMAND` is available for GitHub Issues and non-GitHub issue
    trackers are rejected for this template.
11. The reviewer has full repo access but is instructed not to modify code.
12. The workflow fails if the reviewer modifies code anyway.
13. Reviewer output is schema-validated structured output.
14. Review findings are passed back to the implementer for fresh fix rounds.
15. The current task closes only after every review item is approved.
16. Only the implementer posts GitHub Issue comments and closes tasks.
17. GitHub Issue review comments are posted from reviewer-authored Markdown.
18. The workflow does not select the next task until the current task is
    approved and closed.
19. Tests cover the API, scaffold, and workflow behavior.
20. README and changeset are updated as required.
21. `npm run typecheck` and `npm test` pass.

## 14. Suggested Implementation Slices

### Slice 1: `sandbox.run({ output })`

Add structured output support to reusable sandbox runs and cover it with tests.

### Slice 2: issue comment template argument

Add optional `COMMENT_TASK_COMMAND` support for GitHub Issues and reject
non-GitHub issue trackers as unsupported for this template before scaffold
substitution.

### Slice 3: fixed-role sequential reviewer scaffold

Teach init to use the template-owned fixed-role scaffold for
`sequential-reviewer`: pre-baked Dockerfile/Containerfile, fixed Claude/Codex
`main.mts`, ignored `--agent` with a note, Claude Code env guidance, no Codex
API-key placeholder, and host `~/.codex` sandbox mount.

### Slice 4: template prompt and main rewrite

Rewrite `sequential-reviewer` prompts and orchestration around selector,
implementation, structured review, implementer-posted comments, fix rounds, and
closure.

### Slice 5: docs, changeset, full validation

Update README, add a changeset, run typecheck and tests.

## 15. Open Follow-ups

These are not blockers for the first implementation:

- Add a true read-only reviewer sandbox mode.
- Add a first-class task comment command abstraction for all issue trackers.
- Allow users to choose implementer and reviewer providers/models
  interactively during init.
- Add an explicit alternate Codex auth mode for environments that cannot mount
  a host `~/.codex` cache.
- Add role-scoped or run-scoped sandbox mounts so only Codex reviewer runs can
  see the Codex auth cache.
- Add a provider-agnostic review dashboard from accumulated structured review
  output.
