---
"@ai-hero/sandcastle": patch
---

Rename workspace terminology back to worktree across the codebase. All public API types and functions renamed from `Workspace*` to `Worktree*` (e.g. `createWorktree()`, `Worktree`, `WorktreeBranchStrategy`). `copyToWorkspace` renamed to `copyToWorktree`. `sandboxWorkspacePath` renamed to `sandboxRepoPath` and `SANDBOX_WORKSPACE_DIR` to `SANDBOX_REPO_DIR` for sandbox-internal paths. Source files renamed accordingly (`WorktreeManager.ts`, `CopyToWorktree.ts`, `createWorktree.ts`).
