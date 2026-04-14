---
"@ai-hero/sandcastle": patch
---

Add interactiveExec to Podman sandbox provider, enabling interactive agent sessions via `podman exec -it`. Near-identical to the Docker implementation — detects TTY from stdin and allocates a pseudo-terminal accordingly.
