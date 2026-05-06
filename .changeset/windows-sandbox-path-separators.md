---
"@ai-hero/sandcastle": patch
---

Fix Windows hosts emitting backslash separators for in-container paths during session capture/resume and `copyPaths`. `sandboxSessionStore`, `defaultSessionPathsLayer`, and `startSandbox`'s `copyPaths` now use POSIX joins for paths that target the Linux container, so `docker cp` / `podman cp` no longer reject them on Windows.
