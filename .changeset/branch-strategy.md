---
"@ai-hero/sandcastle": minor
---

Replace `worktree` config with `branchStrategy` on the sandbox provider. Define `BranchStrategy` types (`head`, `merge-to-head`, `branch`) and wire them into bind-mount and isolated providers. `IsolatedSandboxProvider` exposes `branchStrategy` (defaulting to `{ type: "merge-to-head" }`), `testIsolated()` accepts a `branchStrategy` option, and TypeScript prevents `{ type: "head" }` on isolated providers at compile time. The deprecated `worktree` field on `RunOptions` and the `WorktreeMode` type have been removed. README documentation, code examples, the "How it works" section, and option tables have been updated to use `branchStrategy` terminology throughout.
