---
"@ai-hero/sandcastle": patch
---

Add interactive arg collection for missing prompt arguments. When `interactive()` encounters `{{KEY}}` placeholders with no matching prompt argument, it prompts the user at the terminal via `@clack/prompts` text input. Built-in args (`SOURCE_BRANCH`, `TARGET_BRANCH`) are excluded from prompting. `run()` behavior is unchanged.
