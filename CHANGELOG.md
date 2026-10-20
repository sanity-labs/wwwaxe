# @sanity-labs/wwwaxe

## 0.4.0

### Minor Changes

- 375a0c2: Keep collapsed answers, and make conversion fast and safe on very large pages.

  - **Collapsed disclosure panels are kept.** Accordion and tab panels were dropped whenever they were marked `aria-hidden="true"` (server-rendered FAQ pages) or had an inline `display:none` (JS-rendered pages), which removed the answers. The text of a disclosure panel is now kept: an element controlled by a non-menu control through `aria-controls`, an element with `role="tabpanel"` or `role="region"`, or anything inside `<details>`. Dialogs, menus, menubars, listboxes, tooltips, modals, menu flyouts and search suggestions, nav-only drawers and consent banners are still dropped, and `hidden` and `visibility:hidden` always drop.
  - **Much faster on large flat pages.** Unwrapping, markdown rewriting and chrome removal rebuilt a parent's child list once per edit, so a page with thousands of sibling elements took seconds to minutes. Each parent is now rebuilt once: 16,000 sibling links went from about 10 s to under 0.1 s. Core mode's skip-link lookups and very deep nesting still scale worse than linearly.
  - **Deeply nested input no longer throws.** When a conversion overflows the stack (for example a PDF served as `text/html`, which parses into tens of thousands of unclosed tags), it is retried with everything nested deeper than 512 levels flattened into its ancestor at that depth. Pages that converted before give the same output, except right at the stack limit, where overflowing depends on how warmed up the process is.
  - **`keepIds: false` keeps core mode's content fallback.** Core mode still uses skip-link targets and the well-known content ids to pick its element before the ids are dropped, and unwrapping an id-only `div` or `center` no longer runs the surrounding words together.
  - **New `wwwaxeFullAndCore(html, options, coreOptions)`** returns the full and core output of a page from one parse, identical to two `wwwaxe()` calls.

## 0.3.2

### Patch Changes

- 951ad12: Tooling only, no change to the converter's output. Moves the repo to pnpm, TypeScript 7, vitest 4, oxlint and oxfmt, with `engines.node >=20` (CI runs Node 24). Adds lint, format and a package smoke test (CommonJS `require`, ESM `import` and types) to CI, builds `dist/` with tsdown (replacing the unmaintained tsup) on publish, and adds a `./package.json` export.
