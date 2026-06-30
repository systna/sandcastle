# Task

Post the reviewer's comment for task {{TASK_ID}} to its issue thread, then clean
up. The reviewer authored the comment; you are only posting it.

The comment body has been written to `{{COMMENT_FILE}}`.

Run this command, substituting `<ID>` with {{TASK_ID}} and `<FILE>` with
`{{COMMENT_FILE}}`:

`{{COMMENT_TASK_COMMAND}}`

After the comment posts successfully, delete the file `{{COMMENT_FILE}}`.

# Rules

- Post the comment body exactly as written — do not edit it.
- Do NOT modify any code.
- Do NOT close the task.
- Do NOT pick up another task.

Once the comment is posted and the file removed, output
<promise>COMPLETE</promise>.
