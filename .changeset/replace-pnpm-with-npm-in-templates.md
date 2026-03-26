---
"@ai-hero/sandcastle": patch
---

Replace pnpm with npm in scaffold templates. All generated prompt files and main.ts hooks now use `npm install` and `npm run` instead of pnpm, consistent with the project's migration to npm.
