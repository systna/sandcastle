---
"@ai-hero/sandcastle": patch
---

Fix README incorrectly describing `.sandcastle/prompt.md` as a default for `promptFile`. Neither `prompt` nor `promptFile` has a default — omitting both causes an error. The `.sandcastle/prompt.md` path is a convention scaffolded by `sandcastle init`, not an automatic fallback.
