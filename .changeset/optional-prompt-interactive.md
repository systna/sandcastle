---
"@ai-hero/sandcastle": patch
---

Make `prompt`/`promptFile` optional in `interactive()` — when neither is provided, the agent TUI launches with no initial prompt (the full prompt pipeline is skipped).
