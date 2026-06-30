// Sequential Reviewer — structured quality gate
//
// A fixed two-role workflow, one task at a time:
//   Selector  (Claude Code): picks one ready task and a deterministic branch.
//   Implement (Claude Code): implements the task on that branch and commits.
//   Review    (Codex, read-only): emits a structured <review> verdict.
//   Close     (Claude Code): closes the task once the review approves.
//
// Roles are fixed in this first version: Claude Code implements, Codex reviews.
// The reviewer is read-only by instruction; it reports findings rather than
// editing code. Codex authenticates from the host ~/.codex cache, bind-mounted
// into the sandbox at runtime (see codexAuthMount) — no API key is needed.
//
// Usage:
//   npx tsx .sandcastle/main.mts
// Or add to package.json:
//   "scripts": { "sandcastle": "npx tsx .sandcastle/main.mts" }

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Role configuration (the configuration seam for this first version)
// ---------------------------------------------------------------------------

const MAX_TASKS = 10;
const MAX_REVIEW_ROUNDS = 3;

const IMPLEMENTER_MODEL = "claude-sonnet-4-6";
const REVIEWER_MODEL = "gpt-5.4";

const implementerAgent = sandcastle.claudeCode(IMPLEMENTER_MODEL);
const reviewerAgent = sandcastle.codex(REVIEWER_MODEL);

// Codex (reviewer) auth comes from the host ~/.codex cache, mounted writable so
// Codex can refresh its tokens during a run. Trusted-local workflow only — this
// mount exposes Codex credentials to processes in the sandbox.
const codexAuthMount = { hostPath: "~/.codex", sandboxPath: "~/.codex" };

const hooks = {
  sandbox: { onSandboxReady: [{ command: "npm install" }] },
};
const copyToWorktree = ["node_modules"];

// An immutable commit SHA for the host's HEAD at startup — the fork point the
// task branches inherit and the base the reviewer diffs against. A SHA, NOT a
// branch name: a name resolves to a moving target if the host branch gains
// commits during a long run, which would desync the reviewer's diff from the
// commits the gate counted. Captured once so a fix round that adds no new
// commits to a reused branch still reviews the work already on it.
const baseRef = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

// baseRef is interpolated into the reviewer prompt's shell blocks (git
// diff/log), which run through `sh -c`. A commit SHA is plain hex and so always
// shell-safe; assert the shape rather than trust rev-parse blindly.
if (!/^[0-9a-f]{7,40}$/.test(baseRef)) {
  throw new Error(
    `Refusing to run: "git rev-parse HEAD" returned "${baseRef}", which is not a ` +
      "commit SHA.",
  );
}

// ---------------------------------------------------------------------------
// Structured-output schemas
// ---------------------------------------------------------------------------

const taskSelectionSchema = z.object({
  task: z
    .object({
      // A GitHub issue number. Constrained to digits so the derived branch
      // (`sandcastle/issue-<id>`) and the review prompt's shell blocks that
      // interpolate it can never carry shell metacharacters. This template is
      // GitHub-only (enforced at scaffold), so ids are always numeric.
      id: z.string().regex(/^\d+$/, "task id must be a GitHub issue number"),
      title: z.string().min(1),
      branch: z.string().min(1),
    })
    .nullable(),
});

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

// ---------------------------------------------------------------------------
// Outer task loop — one task per slot, next task only after the current closes.
//
// Failure handling:
//   - Selector returns no task        → exit the loop cleanly.
//   - Selector / review output invalid → Output.object throws; the run fails
//                                        loudly (and the sandbox is closed,
//                                        preserving the branch).
//   - Implementer makes no commits     → stop; never send an empty branch to review.
//   - Reviewer mutates the branch      → throw (see the non-mutation guard).
//   - Review never approves in N rounds→ stop and preserve the branch.
//   - Comment post / close fails        → the agent run throws; fail loudly and
//                                        leave the task open (never advance).
// ---------------------------------------------------------------------------

for (let taskSlot = 1; taskSlot <= MAX_TASKS; taskSlot++) {
  console.log(`\n=== Task slot ${taskSlot}/${MAX_TASKS} ===\n`);

  // --- Select ------------------------------------------------------------
  // The selector runs before the task branch exists, on a throwaway branch so
  // an accidental write never lands on the host's working directory.
  const selectorBranch = `sandcastle/sequential-reviewer/selector-${Date.now()}`;
  const selection = await sandcastle.run({
    name: "selector",
    agent: implementerAgent,
    sandbox: docker({ mounts: [codexAuthMount] }),
    branchStrategy: { type: "branch", branch: selectorBranch },
    promptFile: "./.sandcastle/select-task-prompt.md",
    maxIterations: 1,
    hooks,
    copyToWorktree,
    output: sandcastle.Output.object({
      tag: "task-selection",
      schema: taskSelectionSchema,
    }),
  });

  // The selector must not commit. A commit means it did real work it shouldn't.
  if (selection.commits.length > 0) {
    throw new Error(
      `Selector made ${selection.commits.length} commit(s) on ${selectorBranch}; ` +
        "the selector must be read-only. Aborting.",
    );
  }

  const task = selection.output.task;
  if (!task) {
    console.log("No actionable task. Exiting.");
    break;
  }

  // Derive the deterministic branch ourselves — never trust the selector's
  // value for sandbox creation. A malformed selector output must not run the
  // task on an arbitrary branch. Validate the selector agreed so drift surfaces.
  const branch = `sandcastle/issue-${task.id}`;
  if (task.branch !== branch) {
    throw new Error(
      `Selector returned branch "${task.branch}" for task ${task.id}, but the ` +
        `deterministic name must be "${branch}". Aborting.`,
    );
  }

  console.log(`Selected task ${task.id}: ${task.title} -> ${branch}`);

  // Implementer and reviewer share one sandbox on the deterministic task branch.
  const sandbox = await sandcastle.createSandbox({
    branch,
    // Fork new task branches from the frozen SHA, not a live ref, so the fork
    // point matches the base the reviewer diffs and the gate counts against.
    // (Ignored when the deterministic branch already exists from a prior run.)
    baseBranch: baseRef,
    sandbox: docker({ mounts: [codexAuthMount] }),
    hooks,
    copyToWorktree,
  });

  try {
    // Snapshot the task worktree's git state (HEAD + working tree). Used to
    // enforce that the read-only reviewer never mutates the branch. Checks the
    // worktree only — the mounted ~/.codex cache lives outside it, so Codex
    // refreshing its auth there cannot trip the guard.
    const captureGitState = async () => {
      const head = await sandbox.exec("git rev-parse HEAD");
      if (head.exitCode !== 0) {
        throw new Error(`git rev-parse HEAD failed: ${head.stderr.trim()}`);
      }
      const status = await sandbox.exec("git status --porcelain");
      return { head: head.stdout.trim(), status: status.stdout };
    };

    // Run a non-code phase (comment, close) and fail if it mutated the branch.
    // These agents are prompt-constrained not to touch code, but prompts are not
    // a guarantee — enforce it so an approved task can never close with
    // unreviewed changes slipped in after the review gate. On a violation the
    // branch is preserved (named branch + sandbox.close in finally).
    const runGuarded = async (
      label: string,
      runFn: () => Promise<{ commits: unknown[] }>,
    ) => {
      const before = await captureGitState();
      const result = await runFn();
      const after = await captureGitState();
      if (
        result.commits.length > 0 ||
        after.head !== before.head ||
        after.status !== before.status
      ) {
        throw new Error(
          `The ${label} run modified branch ${branch}, but this phase must not ` +
            "change code. Refusing to proceed; the branch is preserved for inspection.",
        );
      }
      return result;
    };

    // --- Implement -------------------------------------------------------
    await sandbox.run({
      name: "implementer",
      agent: implementerAgent,
      maxIterations: 1,
      promptFile: "./.sandcastle/implement-prompt.md",
      promptArgs: {
        TASK_ID: task.id,
        ISSUE_TITLE: task.title,
        BRANCH: branch,
      },
    });

    // Is there anything to review? Count commits the branch carries ahead of
    // the frozen base SHA — NOT just commits from this implement round. A reused
    // deterministic branch may already hold work from a prior run, so an
    // implement round that adds none does not mean there is nothing to review.
    const ahead = await sandbox.exec(
      `git rev-list --count ${baseRef}..HEAD`,
    );
    const reviewableCommits =
      ahead.exitCode === 0 ? Number.parseInt(ahead.stdout.trim(), 10) || 0 : 0;
    if (reviewableCommits === 0) {
      // Empty branch — nothing for the reviewer to look at. Stop.
      console.log(
        `No reviewable commits on ${branch} for task ${task.id}. Stopping.`,
      );
      break;
    }

    // --- Review + fix loop ----------------------------------------------
    // The reviewer (read-only Codex) emits a structured verdict. On
    // changes_requested, a FRESH implementer fix round addresses the requested
    // findings (no session resume — each round depends only on the findings and
    // the current worktree), then the reviewer re-checks. Repeat up to
    // MAX_REVIEW_ROUNDS; on non-convergence, stop and preserve the branch.
    let approved = false;
    for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
      // Non-mutation guard: snapshot before, run the reviewer, snapshot after.
      const beforeReview = await captureGitState();
      const review = await sandbox.run({
        name: `reviewer-r${round}`,
        agent: reviewerAgent,
        maxIterations: 1,
        promptFile: "./.sandcastle/review-prompt.md",
        promptArgs: {
          TASK_ID: task.id,
          ISSUE_TITLE: task.title,
          BRANCH: branch,
          REVIEW_ROUND: String(round),
          // Pin the diff base to the immutable SHA captured once on the host at
          // startup — NOT the built-in {{TARGET_BRANCH}}, which createSandbox
          // recomputes from the host's current branch on every run() and so can
          // drift mid-run. The SHA keeps the reviewer's diff aligned with the
          // gate's reviewability count.
          BASE_REF: baseRef,
        },
        output: sandcastle.Output.object({
          tag: "review",
          schema: reviewSchema,
        }),
      });
      const afterReview = await captureGitState();

      // The reviewer is read-only. If it committed, moved HEAD, or changed the
      // working tree, fail hard — even if it claimed approval. The branch is
      // preserved (named branch + sandbox.close in finally) for inspection and
      // the task is never closed.
      if (
        review.commits.length > 0 ||
        afterReview.head !== beforeReview.head ||
        afterReview.status !== beforeReview.status
      ) {
        throw new Error(
          `The reviewer modified branch ${branch} on round ${round}, but the ` +
            "reviewer must be read-only. Refusing to close the task; the branch is " +
            "preserved for inspection.",
        );
      }

      // The verdict must be about the task we actually selected. A stale or
      // mismatched structured review must never approve or close another task —
      // check before posting any comment or closing.
      if (review.output.taskId !== task.id) {
        throw new Error(
          `Review on round ${round} reported taskId "${review.output.taskId}" but the ` +
            `selected task is "${task.id}". Refusing to act on a mismatched review.`,
        );
      }

      // The gate passes only when the reviewer raised at least one item and
      // every item is approved. The verdict must agree with the item list.
      const items = review.output.items;
      approved =
        items.length > 0 && items.every((item) => item.status === "approved");

      if (approved !== (review.output.verdict === "approved")) {
        throw new Error(
          `Review for task ${task.id} is inconsistent: verdict="${review.output.verdict}" ` +
            `but ${items.length} item(s) imply approved=${approved}.`,
        );
      }

      // Post the reviewer-authored comment to the issue thread (audit trail).
      // The reviewer never touches the tracker — the implementer posts it. The
      // body lives under .sandcastle/logs/, which the scaffolded .gitignore
      // ignores, so it never lands in a commit or trips the non-mutation guard.
      const commentRel = `.sandcastle/logs/review-comments/issue-${task.id}-round-${round}.md`;
      const commentHostPath = join(sandbox.worktreePath, commentRel);
      await mkdir(dirname(commentHostPath), { recursive: true });
      await writeFile(commentHostPath, review.output.issueCommentMarkdown);
      await runGuarded(`commenter-r${round}`, () =>
        sandbox.run({
          name: `commenter-r${round}`,
          agent: implementerAgent,
          maxIterations: 1,
          promptFile: "./.sandcastle/comment-prompt.md",
          promptArgs: { TASK_ID: task.id, COMMENT_FILE: commentRel },
        }),
      );

      if (approved) {
        console.log(`Review approved task ${task.id} on round ${round}.`);
        break;
      }

      console.log(
        `Review round ${round}/${MAX_REVIEW_ROUNDS} requested changes for task ${task.id}.`,
      );

      // Out of rounds — leave the loop with approved=false (handled below).
      if (round === MAX_REVIEW_ROUNDS) break;

      // Fresh implementer fix round — address only the requested findings.
      const findings = items.filter(
        (item) => item.status === "changes_requested",
      );
      const fix = await sandbox.run({
        name: `fixer-r${round}`,
        agent: implementerAgent,
        maxIterations: 1,
        promptFile: "./.sandcastle/fix-prompt.md",
        promptArgs: {
          TASK_ID: task.id,
          BRANCH: branch,
          REVIEW_ROUND: String(round),
          REVIEW_FINDINGS: JSON.stringify(findings, null, 2),
        },
      });

      if (fix.commits.length === 0) {
        console.log(
          `Fix round ${round} for task ${task.id} produced no commits; ` +
            "stopping to avoid a no-op loop.",
        );
        break;
      }
    }

    if (!approved) {
      // Non-convergence: stop the workflow and preserve the branch for a human.
      console.log(
        `Task ${task.id} did not pass review within ${MAX_REVIEW_ROUNDS} round(s). ` +
          `Preserving branch ${branch} for review and stopping.`,
      );
      break;
    }

    // --- Close (implementer only) ---------------------------------------
    // If closing fails, the agent run throws — the task stays open, the branch
    // is preserved (finally), and the workflow stops rather than advancing to
    // the next task with the current one unfinished.
    try {
      await runGuarded("closer", () =>
        sandbox.run({
          name: "closer",
          agent: implementerAgent,
          maxIterations: 1,
          promptFile: "./.sandcastle/close-prompt.md",
          promptArgs: { TASK_ID: task.id },
        }),
      );
    } catch (cause) {
      throw new Error(
        `Task ${task.id} passed review but closing it failed. The branch ` +
          `${branch} is preserved and the task is still open.`,
        { cause },
      );
    }

    console.log(`Task ${task.id} approved and closed.`);
  } finally {
    await sandbox.close();
  }
}

console.log("\nAll done.");
