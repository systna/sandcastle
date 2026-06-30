# Task

The reviewer requested changes on task {{TASK_ID}} (branch {{BRANCH}}, after
review round {{REVIEW_ROUND}}). Apply the requested fixes — and only those.

# Requested changes

The reviewer's `changes_requested` findings, as JSON:

```json
{{REVIEW_FINDINGS}}
```

Each finding has a `file`, `line`, `summary`, `rationale`, and an optional
`suggestedFix`. Address every finding.

# Execution

1. Make the requested changes on branch {{BRANCH}}.
2. Run `npm run typecheck` and `npm run test`; fix any failures.
3. Commit the fixes with a message that references the review round.

# Rules

- Fix ONLY the requested findings. Do not refactor unrelated code or expand scope.
- Do NOT close the task — the reviewer must approve the fixes first.
- Do NOT pick up another task.

When the fixes are committed and tests pass, output <promise>COMPLETE</promise>.
