---
"@ai-hero/sandcastle": minor
---

Add a `cursor()` agent provider. Cursor is selectable during `sandcastle init` (with a provider-specific Dockerfile and `CURSOR_API_KEY` env scaffold) and importable directly as `cursor(model, options?)`. Print mode runs the Cursor Agent CLI with `--output-format stream-json`, passing the prompt as a positional argument (guarded against the argv size limit) and parsing Cursor's top-level `tool_call` events. Cursor is non-resumable (no filesystem-backed session storage), consistent with ADR 0012/0016.
