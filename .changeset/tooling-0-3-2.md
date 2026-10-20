---
'@sanity-labs/wwwaxe': patch
---

Tooling only, no change to the converter's output. Moves the repo to pnpm, TypeScript 7, vitest 4, oxlint and oxfmt, with `engines.node >=20` (CI runs Node 24). Adds lint, format and a package smoke test (CommonJS `require`, ESM `import` and types) to CI, builds `dist/` with tsdown (replacing the unmaintained tsup) on publish, and adds a `./package.json` export.
