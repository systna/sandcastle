---
"@ai-hero/sandcastle": patch
---

Add `signal?: AbortSignal` to `Sandbox.run()` and `Sandbox.interactive()` options. Aborting cancels the in-flight operation but leaves the `Sandbox` handle usable — call `.run()` again with a fresh signal, or `.close()` to tear down normally.
