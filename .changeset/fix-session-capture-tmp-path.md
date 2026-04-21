---
"@ai-hero/sandcastle": patch
---

Fix session capture failing with `invalid output path` when the sandbox projects directory does not exist on the host. Host-side temporary files used to stage session JSONLs during copy now live in the OS temp directory instead of a sandbox-only path.
