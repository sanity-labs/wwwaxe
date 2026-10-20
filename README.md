# wwwaxe 🪓

Strip HTML down to clean, token-efficient content for AI agents.

Modern web pages are bloated with scripts, styles, tracking pixels, and presentational markup that waste tokens when fed to LLMs. **wwwaxe** strips all of that away and outputs clean markdown-flavored text with YAML frontmatter — ready for an agent to read.

## Why not just convert to markdown?

Generic HTML-to-markdown converters work on the full page — nav, footer, cookie banners, sidebar ads, and all. wwwaxe understands page structure. With `core: true` it isolates the main content using ARIA landmarks and semantic heuristics before converting, so you get the article, not the chrome.

Page structure also carries meaning that flat markdown loses — table relationships, form layouts, semantic groupings. wwwaxe keeps the structural skeleton while eliminating the noise.

## Install

```bash
npm install @sanity-labs/wwwaxe
```

## Usage

```typescript
import { wwwaxe } from '@sanity-labs/wwwaxe'

// Default: strips noise, converts to markdown, keeps ids
const result = wwwaxe(rawHtml)

// Core mode: also strips nav/header/footer, isolates main content
const result = wwwaxe(rawHtml, { core: true })
```

### Example output

Given a typical blog page, wwwaxe produces:

```
---
title: "Hello World"
description: "A great article about things"
url: "https://example.com/blog/hello-world"
image: "https://example.com/og/hello-world.jpg"
---

## Hello World

This is my [blog post](/post).

![A photo](/photo.jpg)

- First item
- Second item
- Third item
```

No `<script>`, no `class="text-gray-700 leading-relaxed"`, no `data-*` noise. Just content.

## What it does

**Removes entirely:**
- `<script>`, `<style>`, `<noscript>`, `<svg>`, `<link>`, `<iframe>`, `<template>` tags and their contents
- All `class`, `style`, `data-*`, and event handler attributes (`onclick`, `onload`, etc.)
- Hidden elements (`hidden`, `aria-hidden="true"`)
- HTML comments
- Empty elements with no text content or meaningful children
- Excessive whitespace

**Keeps and converts:**
- `<head>` → YAML frontmatter with `title`, `description`, `url` (canonical), and `og:image`
- Headings → `## Heading` markdown syntax
- Links → `[text](href)` markdown syntax
- Images → `![alt](src)` markdown syntax
- Lists → `- item` / `1. item` markdown syntax
- Bold/italic/code → `**bold**`, `*italic*`, `` `code` `` markdown syntax
- Tables, forms, and other structural elements — kept as clean HTML with only semantic attributes
- `id` attributes — preserved (useful for anchor links and agent navigation)
- Semantic attributes — `role`, `aria-label`, `alt`, `title`, `lang`, `dir`

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `markdown` | `boolean` | `true` | Convert headings, links, images, lists, bold, italic, code to markdown syntax |
| `core` | `boolean` | `false` | Strip chrome (header, nav, footer, aside, dialog) and isolate main content |
| `keepIds` | `boolean` | `true` | Keep `id` attributes |
| `keepClasses` | `boolean` | `false` | Keep `class` attributes |
| `keepDataAttributes` | `boolean` | `false` | Keep `data-*` attributes |
| `keepAriaHidden` | `boolean` | `false` | Keep `aria-hidden="true"` elements |

## Core mode

With `core: true`, wwwaxe strips page chrome and isolates the main content before processing. The content identification chain:

1. **ARIA landmarks** — looks for `<main>`, or elements with `role="main"`
2. **Empty main fallback** — if `<main>` exists but has less than 50 characters of text content, falls through to the next step (handles skeleton-rendered pages)
3. **`<article>`** — first article element
4. **Skip link target** — follows `href` of a "skip to content" link to find the target element
5. **Well-known IDs** — looks for `#main-content`, `#content`, `#main`, `#page-content`, `#site-content`

Chrome elements removed in core mode: `<header>`, `<nav>`, `<footer>`, `<aside>`, `<dialog>`.

**Note:** `<header>` elements *inside* a `<section>` or `<article>` are preserved — they're content headers, not page chrome.

## RSC streaming reassembly

React Server Components pages often stream content as a series of `<div hidden id="S:N">` elements that are injected into the DOM by a small inline script. When the page is fetched as static HTML (before JavaScript runs), the visible `<main>` is empty and all the real content sits in those hidden divs.

wwwaxe automatically detects this pattern and reassembles the streamed fragments into `<main>` before processing. No configuration needed — if the page looks like an RSC streaming page, it's handled transparently.

## Releasing

Releases are published from CI via npm trusted publishing, with provenance. Add a changeset to any PR that should ship (`npx changeset`). On merge to `master`, the release workflow opens a "Version Packages" PR; merging that PR publishes to npm.

## License

MIT
