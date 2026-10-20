# wwwaxe 🪓

Strip HTML down to clean, token-efficient content for AI agents.

Modern web pages are bloated with scripts, styles, tracking pixels, and presentational markup that waste tokens when fed to LLMs. **wwwaxe** strips all of that away and outputs clean markdown-flavored text with YAML frontmatter — ready for an agent to read.

## Why not just convert to markdown?

Generic HTML-to-markdown converters work on the full page — nav, footer, cookie banners, sidebar ads, and all. wwwaxe understands page structure. With `core: true` it isolates the main content using ARIA landmarks and semantic heuristics before converting, so you get the article, not the chrome.

Page structure also carries meaning that flat markdown loses — table relationships, form layouts, semantic groupings. wwwaxe keeps the structural skeleton while eliminating the noise.

## Install

```bash
npm install @sanity-labs/wwwaxe
# or: pnpm add @sanity-labs/wwwaxe / yarn add @sanity-labs/wwwaxe
```

Requires Node 20 or newer. The package ships both ESM and CommonJS builds with type declarations.

## Usage

```typescript
import { wwwaxe } from '@sanity-labs/wwwaxe'

// Default: strips noise, converts to markdown, keeps ids
const result = wwwaxe(rawHtml)

// Core mode: also strips nav/header/footer, isolates main content
const coreResult = wwwaxe(rawHtml, { core: true })
```

From CommonJS:

```javascript
const { wwwaxe } = require('@sanity-labs/wwwaxe')

const result = wwwaxe(rawHtml, { core: true })
```

`wwwaxe(html, options?)` takes an HTML string and returns a string; it is synchronous and does no I/O.

### Example output

Given this page:

```html
<html lang="en">
<head>
  <title>Hello World</title>
  <meta name="description" content="A great article about things">
  <link rel="canonical" href="https://example.com/blog/hello-world">
  <meta property="og:image" content="https://example.com/og/hello-world.jpg">
  <style>.prose { color: #333 }</style>
  <script>window.dataLayer = []</script>
</head>
<body class="antialiased">
  <nav class="navbar"><a href="/">Home</a> <a href="/blog">Blog</a></nav>
  <main>
    <article class="prose lg:prose-xl">
      <h1 class="text-4xl font-bold">Hello World</h1>
      <p class="text-gray-700" data-testid="intro">This is my <a href="/post" class="underline">blog post</a>.</p>
      <img src="/photo.jpg" alt="A photo" class="rounded-lg" onclick="zoom(this)">
      <ul class="list-disc"><li>First item</li><li>Second item</li><li>Third item</li></ul>
    </article>
  </main>
  <footer>© 2026 Example</footer>
</body>
</html>
```

`wwwaxe(html, { core: true })` returns:

```text
---
title: Hello World
description: A great article about things
url: https://example.com/blog/hello-world
image: https://example.com/og/hello-world.jpg
---
<main> <article>
# Hello World
 <p>This is my [blog post](/post).</p> ![A photo](/photo.jpg) - First item
- Second item
- Third item
 </article> </main>
```

No `<script>` or `<style>`, no `class="text-gray-700"`, no `data-*` or `onclick` noise, and no `<nav>` or `<footer>` in core mode. Headings, links and lists become markdown; structural elements such as `<main>` and `<article>` stay as clean HTML, and the head becomes YAML frontmatter.

## What it does

**Removes entirely:**

- `<script>`, `<style>`, `<noscript>`, `<svg>`, `<link>`, `<iframe>`, `<template>` tags and their contents
- All `class`, `style`, `data-*`, and event handler attributes (`onclick`, `onload`, etc.)
- Hidden elements (`hidden`, `visibility:hidden`, `display:none`, `aria-hidden="true"`), except [collapsed disclosure panels](#collapsed-disclosure-panels)
- HTML comments
- Empty elements with no text content or meaningful children
- Excessive whitespace

**Keeps and converts:**

- `<head>` → YAML frontmatter with `title`, `description`, `url` (canonical), and `og:image`
- Headings → `## Heading` markdown syntax
- Links → `[text](href)` markdown syntax
- Images → `![alt](src)` markdown syntax (`data:` URIs are dropped; an image with only a data URI becomes `[image: alt]` or nothing)
- Lists → `- item` / `1. item` markdown syntax
- Bold/italic/code → `**bold**`, `*italic*`, `` `code` `` markdown syntax
- Tables, forms, and other structural elements — kept as clean HTML with only semantic attributes
- `id` attributes — preserved (useful for anchor links and agent navigation)
- Semantic attributes — `role`, `aria-label`, `alt`, `title`, `lang`, `dir`

## Options

| Option               | Type      | Default | Description                                                                                                                                                |
| -------------------- | --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `markdown`           | `boolean` | `true`  | Convert headings, links, images, lists, bold, italic, code to markdown syntax                                                                              |
| `core`               | `boolean` | `false` | Strip chrome (header, nav, footer, aside, dialog) and isolate main content                                                                                 |
| `keepIds`            | `boolean` | `true`  | Keep `id` attributes. When `false`, ids are dropped and wrappers that only carried one are unwrapped; core mode still uses ids to pick its content element |
| `keepClasses`        | `boolean` | `false` | Keep `class` attributes                                                                                                                                    |
| `keepDataAttributes` | `boolean` | `false` | Keep `data-*` attributes                                                                                                                                   |
| `keepAriaHidden`     | `boolean` | `false` | Keep every `aria-hidden="true"` element, not only disclosure panels                                                                                        |

## Collapsed disclosure panels

FAQ accordions and tabs are often server-rendered with the collapsed answers marked `aria-hidden="true"`, and JS-rendered pages (HTML captured after the page's scripts ran) get an inline `display: none` on them instead. Dropping those hides the answers, so wwwaxe keeps the text of a _disclosure panel_: an element with text of its own that is one of

- an element whose `id` is listed in the `aria-controls` of a control that is not a menu trigger (accordion and tab panels);
- an element with `role="tabpanel"` or `role="region"`;
- an element inside a `<details>`.

A control is a menu trigger, and its panel is dropped, when it has `aria-haspopup`, sits inside `nav`, `header`, `footer` or `aside`, is a text or search `input` or has `aria-autocomplete` (search suggestions; checkbox and radio toggles are not menu triggers), has `role="combobox"` or `role="searchbox"`, or is an icon-only button whose `aria-label` says menu or navigation.

An element is never a disclosure panel when it has `role` `dialog`, `alertdialog`, `menu`, `menubar`, `listbox` or `tooltip`, has `aria-modal="true"`, has text only inside a `nav` or `role="navigation"` (a menu drawer; an answer with a related-links `nav` still counts), or is a `region` whose `aria-label` mentions cookies or consent and that no control points to (a consent banner).

Everything else that is `aria-hidden` or `display:none` is dropped as before. The `hidden` attribute and `visibility:hidden` always drop, and `keepAriaHidden: true` keeps every `aria-hidden` element.

## Core mode

With `core: true`, wwwaxe strips page chrome and isolates the main content before processing. The content identification chain:

1. **ARIA landmarks** — looks for `<main>`, or elements with `role="main"`
2. **Empty main fallback** — if `<main>` exists but has less than 50 characters of text content, falls through to the next step (handles skeleton-rendered pages)
3. **`<article>`** — first article element
4. **Skip link target** — follows `href` of a "skip to content" link to find the target element
5. **Well-known IDs** — looks for `#main-content`, `#content`, `#main`, `#page-content`, `#site-content`

Chrome elements removed in core mode: `<header>`, `<nav>`, `<footer>`, `<aside>`, `<dialog>`.

**Note:** `<header>` elements _inside_ a `<section>` or `<article>` are preserved — they're content headers, not page chrome.

## Large and deeply nested pages

Large flat pages convert quickly: each parent's child list is rebuilt once, so a page with tens of thousands of sibling elements converts in a fraction of a second, and doubling it roughly doubles the time. Some inputs still scale worse than that: core mode looks up the target of every skip link in the whole tree, nested disclosure panels each re-check their subtree, and parsing very deep nesting is quadratic inside `htmlparser2`. A page nested so deeply that conversion overflows the stack (a PDF served as `text/html` parses into tens of thousands of unclosed tags) is converted again with everything nested deeper than 512 levels flattened into its ancestor at that depth. Block elements get a space where they start or end and inline elements don't, so words stay whole; text that would have been removed anyway (scripts, styles, `hidden`, `aria-hidden`, `display:none`, `visibility:hidden`) is dropped rather than flattened. Pages that converted before give the same text, except near the stack limit (roughly 10,000 to 16,000 levels in a worker) where whether a page overflows depends on how warmed up the process is, so the same page can come out flattened on one conversion and not on the next.

Whether a page near the stack limit needs the fallback depends on the stack available, so run conversions of untrusted pages in a worker thread, as a crawler would.

## Full and core text from one parse

```typescript
import { wwwaxeFullAndCore } from '@sanity-labs/wwwaxe'

const { full, core } = wwwaxeFullAndCore(rawHtml, {}, { keepIds: false })
```

Returns the same strings as `wwwaxe(rawHtml, { ...options, core: false })` and `wwwaxe(rawHtml, { ...options, ...coreOptions, core: true })`, but parses the page once. `coreOptions` may only set `keepIds`.

## RSC streaming reassembly

React Server Components pages often stream content as a series of `<div hidden id="S:N">` elements that are injected into the DOM by a small inline script. When the page is fetched as static HTML (before JavaScript runs), the visible `<main>` is empty and all the real content sits in those hidden divs.

wwwaxe automatically detects this pattern and reassembles the streamed fragments into `<main>` before processing. No configuration needed — if the page looks like an RSC streaming page, it's handled transparently.

## Development

The package runs on Node 20+. Building it needs Node 22.18+ or 24.11+ (tsdown's requirement; CI runs Node 24) and pnpm (`corepack enable` picks up the pinned version).

```sh
pnpm install
pnpm build         # tsdown: dist/ with CommonJS, ESM and type declarations
pnpm typecheck     # tsc (TypeScript 7)
pnpm lint          # oxlint
pnpm format        # oxfmt --check (pnpm format:fix to write)
pnpm test          # vitest
pnpm test:package  # packs the build and loads it via require, import and types (CI also does this on Node 20)
```

`dist/` is built, never committed; `prepack` rebuilds it on publish.

### Tests

`pnpm test` runs the vitest suite once and `pnpm test:watch` reruns it on change. The tests are targeted unit tests of the converter against small HTML snippets and small real-page fixtures in `test/fixtures/`. The deep-nesting tests run the converter in a worker thread with a fixed 4 MB stack, which uses Node's built-in TypeScript support, so running the tests needs Node 22.18+ or 24.11+, like the build. The README's example output is checked by a test, so it can't drift. CI runs build, typecheck, lint, format check, the tests and `pnpm test:package` on every pull request and on pushes to `main`.

## Releasing

Releases use [changesets](https://github.com/changesets/changesets) and npm trusted publishing (OIDC, with provenance; no npm token is stored).

1. In any PR that should ship, run `pnpm exec changeset`, choose the bump (patch, minor or major) and write the entry. It becomes the changelog line, so describe what changed for users.
2. When the PR merges to `main`, the Release workflow opens (or updates) a "Version Packages" PR that bumps the version and writes `CHANGELOG.md`.
3. Merging the "Version Packages" PR publishes to npm and creates the tag.

## License

MIT
