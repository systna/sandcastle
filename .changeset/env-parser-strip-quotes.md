---
"@ai-hero/sandcastle": patch
---

Strip matching surrounding quotes from .env file values so that `KEY="value"` and `KEY='value'` are parsed as `value` instead of including literal quote characters
