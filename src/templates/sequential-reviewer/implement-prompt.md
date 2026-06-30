# Task

Implement task {{TASK_ID}}: {{ISSUE_TITLE}}

View the task first: run `{{VIEW_TASK_COMMAND}}` with `<ID>` replaced by
{{TASK_ID}}. If it references a parent PRD or issue, read that too.

You are working on branch {{BRANCH}}. Work ONLY on this task.

# Context

## Recent commits

!`git log -n 10 --oneline`

# Execution

1. **Explore** — read the relevant source files and tests before writing code.
2. **Implement** — use RGR (Red → Green → Repeat → Refactor) where applicable:
   write a failing test, make it pass, repeat, then refactor.
3. **Verify** — run `npm run typecheck` and `npm run test`. Fix any failures
   before committing.
4. **Commit** — make a single git commit describing the change.

# Rules

- Keep the change as small as possible while fully addressing the task.
- Do NOT close the task — closure happens only after the reviewer approves.
- Do NOT pick or work on any other task.
- Do not leave commented-out code or TODO comments in committed code.

When the implementation is committed and tests pass, output
<promise>COMPLETE</promise>.
