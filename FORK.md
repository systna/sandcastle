# Fork maintenance (private)

This is a **private** fork of
[`mattpocock/sandcastle`](https://github.com/mattpocock/sandcastle) (published
upstream as `@ai-hero/sandcastle`). It carries local customizations and is
**never published to a public registry** — `"private": true` in `package.json`
enforces that (`npm publish` / `changeset publish` hard-error). Projects consume
it directly over git.

## Remotes

- `origin` → `git@github.com:systna/sandcastle.git` (this private fork)
- `upstream` → `https://github.com/mattpocock/sandcastle.git` (source)

## Consuming the fork in a project

Install a pinned tag (see the convention below):

```bash
npm i -D "git+ssh://git@github.com/systna/sandcastle.git#v0.12.0-pro.1"
npx sandcastle init
```

The `prepare` script builds `dist/` on install, so no separate build step is
needed. Scaffolded templates import `@ai-hero/sandcastle`, which resolves to the
installed fork — no edits required. Always pin to a **tag**, never a moving
branch, so an upstream merge can't silently change a project's behavior.

## Tagging convention

```
v<upstream-base>-pro.<n>
```

- `<upstream-base>` — the upstream `@ai-hero/sandcastle` version this build
  merges from (e.g. `0.12.0`).
- `-pro.<n>` — fork iteration on that base, starting at `1`. Bump it for each
  fork release, even when the upstream base has not changed.

Examples:

- `v0.12.0-pro.1` — first fork build on upstream 0.12.0.
- `v0.12.0-pro.2` — another fork change, same upstream base.
- `v0.13.0-pro.1` — after merging upstream 0.13.0.

The suffix is valid semver, so tags sort correctly.

**Do not** bump `package.json#version` to the fork version — leaving it aligned
with upstream avoids merge conflicts on upstream's version bumps. The git tag is
the source of truth for fork releases.

Cut a release:

```bash
git tag -a v0.12.0-pro.1 -m "Fork build on upstream 0.12.0: <summary>"
git push origin v0.12.0-pro.1
```

## Merging a new upstream release

```bash
git fetch upstream
git merge upstream/main        # resolve conflicts — limited to real fork changes
npm install && npm run typecheck && npm test
git tag -a v<new-base>-pro.1 -m "Merge upstream <new-base>: <summary>"
git push origin sandcastle-pro --follow-tags
```
