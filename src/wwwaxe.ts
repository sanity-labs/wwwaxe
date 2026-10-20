import { parseDocument } from 'htmlparser2'
import { Element, Text, Comment, Node, Document, type ChildNode, isTag, isText, hasChildren } from 'domhandler'
import render from 'dom-serializer'
import { removeElement, textContent, getChildren } from 'domutils'

export interface WwwaxeOptions {
  /** Keep data-* attributes (default: false) */
  keepDataAttributes?: boolean
  /** Keep id attributes (default: true) */
  keepIds?: boolean
  /** Keep class attributes (default: false) */
  keepClasses?: boolean
  /** Keep aria-hidden elements (default: false) */
  keepAriaHidden?: boolean
  /** Convert HTML tags to markdown syntax for token efficiency (default: true) */
  markdown?: boolean
  /** Strip chrome (header, nav, footer, aside, dialog) and isolate core content (default: false) */
  core?: boolean
}

/** Tags to remove entirely (tag + all children) */
const REMOVE_TAGS = new Set([
  'script', 'style', 'noscript', 'svg', 'link', 'iframe',
  // Common non-content elements
  'template',
])

/** Tags that are purely presentational wrappers — unwrap children, discard tag */
const UNWRAP_TAGS = new Set([
  'span', 'div', 'font', 'center', 'b', 'i', 'u', 'em', 'strong', 'small',
  'big', 'mark', 'sub', 'sup', 'abbr', 'cite', 'code', 'kbd', 'samp', 'var',
  'del', 'ins', 's', 'strike', 'wbr', 'bdi', 'bdo',
])

/** Tags that should NOT be unwrapped when markdown mode is enabled (they survive for markdown rewriting) */
const MARKDOWN_PRESERVE_TAGS = new Set([
  'strong', 'b', 'em', 'i', 'code', 'del', 's', 'strike',
])

/** Structural tags we always keep */
const KEEP_TAGS = new Set([
  // Document
  'html', 'head', 'body',
  // Meta
  'title', 'meta', 'base',
  // Sectioning
  'header', 'footer', 'main', 'nav', 'article', 'section', 'aside',
  'hgroup', 'search', 'address',
  // Headings
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // Content
  'p', 'blockquote', 'pre', 'figure', 'figcaption', 'hr', 'br',
  // Lists
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'menu',
  // Tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  // Forms
  'form', 'fieldset', 'legend', 'label', 'input', 'textarea', 'select',
  'option', 'optgroup', 'button', 'output', 'datalist',
  // Media
  'img', 'picture', 'source', 'video', 'audio', 'track',
  // Links
  'a',
  // Other semantic
  'details', 'summary', 'dialog', 'time',
])

/** Attributes to keep — everything else is stripped */
const CONTENT_ATTRIBUTES = new Set([
  // Links & media
  'href', 'src', 'srcset', 'alt', 'poster',
  // Semantics
  'role', 'aria-label', 'aria-labelledby', 'aria-describedby',
  'title', 'lang', 'dir', 'translate',
  // Form semantics
  'type', 'name', 'value', 'placeholder', 'for', 'action', 'method',
  'required', 'disabled', 'checked', 'selected', 'readonly',
  'min', 'max', 'step', 'pattern', 'maxlength', 'minlength',
  'multiple', 'rows', 'cols',
  // Table semantics
  'colspan', 'rowspan', 'scope', 'headers',
  // Meta
  'content', 'property', 'charset', 'http-equiv',
  // Media
  'width', 'height', 'controls', 'autoplay', 'loop', 'muted',
  // Time
  'datetime',
  // Details
  'open',
  // Lists
  'start', 'reversed',
])

/** Chrome tags to strip in core mode */
const CHROME_TAGS = new Set([
  'nav', 'footer', 'aside', 'dialog',
])

/** Sectioning elements whose child <header> is content, not chrome */
const SECTIONING_TAGS = new Set([
  'section', 'article', 'main', 'aside',
])

/** Chrome roles to strip in core mode */
const CHROME_ROLES = new Set([
  'banner', 'navigation', 'complementary', 'contentinfo', 'search',
])

/** Well-known IDs for main content fallback */
const WELL_KNOWN_CONTENT_IDS = [
  'main-content', 'content', 'main', 'page-content', 'site-content',
]

function isEventAttribute(name: string): boolean {
  return name.startsWith('on') && name.length > 2
}

function isDataAttribute(name: string): boolean {
  return name.startsWith('data-')
}

/**
 * Get the effective UNWRAP_TAGS set based on markdown option
 */
function getUnwrapTags(options: WwwaxeOptions): Set<string> {
  const markdown = options.markdown !== false
  if (!markdown) return UNWRAP_TAGS
  // When markdown is enabled, don't unwrap tags that the markdown rewriter needs
  const tags = new Set(UNWRAP_TAGS)
  for (const tag of MARKDOWN_PRESERVE_TAGS) {
    tags.delete(tag)
  }
  return tags
}

// ─── Tree helpers ───────────────────────────────────────────────────────────

/**
 * Find the first element matching a tag name (depth-first)
 */
function findElement(node: Node, tagName: string): Element | null {
  if (isTag(node) && node.tagName.toLowerCase() === tagName) {
    return node
  }
  if (hasChildren(node)) {
    for (const child of getChildren(node)) {
      const found = findElement(child, tagName)
      if (found) return found
    }
  }
  return null
}

/**
 * Find all elements matching a predicate (depth-first)
 */
function findElements(node: Node, predicate: (el: Element) => boolean): Element[] {
  const results: Element[] = []
  if (isTag(node) && predicate(node)) {
    results.push(node)
  }
  if (hasChildren(node)) {
    for (const child of getChildren(node)) {
      results.push(...findElements(child, predicate))
    }
  }
  return results
}

/**
 * Find an element by id (depth-first)
 */
function findById(node: Node, id: string): Element | null {
  if (isTag(node) && node.attribs.id === id) {
    return node
  }
  if (hasChildren(node)) {
    for (const child of getChildren(node)) {
      const found = findById(child, id)
      if (found) return found
    }
  }
  return null
}

// ─── Frontmatter ────────────────────────────────────────────────────────────

interface FrontmatterData {
  title?: string
  description?: string
  url?: string
  image?: string
}

/**
 * Extract frontmatter metadata from <head>.
 * Must be called BEFORE processNode since processNode strips attributes like rel.
 */
function extractFrontmatter(doc: Document): FrontmatterData {
  const data: FrontmatterData = {}

  const head = findElement(doc, 'head')
  if (!head) return data

  // Title from <title> tag
  const titleEl = findElement(head, 'title')
  if (titleEl) {
    const text = textContent(titleEl).trim()
    if (text) data.title = text
  }

  // Walk head children for meta and link tags
  const metas = findElements(head, (el) => el.tagName.toLowerCase() === 'meta')
  const links = findElements(head, (el) => el.tagName.toLowerCase() === 'link')

  // Description from <meta name="description">
  for (const meta of metas) {
    const name = (meta.attribs.name || '').toLowerCase()
    if (name === 'description' && meta.attribs.content) {
      data.description = meta.attribs.content.trim()
      break
    }
  }

  // URL: canonical link takes priority
  for (const link of links) {
    const rel = (link.attribs.rel || '').toLowerCase()
    if (rel === 'canonical' && link.attribs.href) {
      data.url = link.attribs.href.trim()
      break
    }
  }

  // URL fallback: og:url
  if (!data.url) {
    for (const meta of metas) {
      const property = (meta.attribs.property || '').toLowerCase()
      if (property === 'og:url' && meta.attribs.content) {
        data.url = meta.attribs.content.trim()
        break
      }
    }
  }

  // Image from og:image
  for (const meta of metas) {
    const property = (meta.attribs.property || '').toLowerCase()
    if (property === 'og:image' && meta.attribs.content) {
      const imgContent = meta.attribs.content.trim()
      // Skip data URIs in og:image — they can be huge
      if (!imgContent.startsWith('data:')) data.image = imgContent
      break
    }
  }

  return data
}

/**
 * Escape a YAML value if it contains special characters
 */
function yamlEscape(value: string): string {
  // Wrap in double quotes if contains special YAML chars
  if (
    value.includes(': ') ||
    value.includes('\n') ||
    value.includes('"') ||
    value.includes("'") ||
    value.includes('[') ||
    value.includes(']') ||
    value.includes('{') ||
    value.includes('}') ||
    value.includes('#') ||
    value.includes('&') ||
    value.includes('*') ||
    value.includes('!') ||
    value.includes('|') ||
    value.includes('>') ||
    value.includes('%') ||
    value.includes('@') ||
    value.includes('`')
  ) {
    // Escape internal double quotes
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return '"' + escaped + '"'
  }
  return value
}

/**
 * Build YAML frontmatter string from extracted data
 */
function buildFrontmatter(data: FrontmatterData): string {
  const lines: string[] = []

  if (data.title) lines.push('title: ' + yamlEscape(data.title))
  if (data.description) lines.push('description: ' + yamlEscape(data.description))
  if (data.url) lines.push('url: ' + yamlEscape(data.url))
  if (data.image) lines.push('image: ' + yamlEscape(data.image))

  if (lines.length === 0) return ''

  return '---\n' + lines.join('\n') + '\n---'
}

// ─── Document wrapper removal ───────────────────────────────────────────────

/**
 * Remove <html>, <head>, <body> wrappers from the document.
 * Unwraps body children to document level, removes head entirely.
 */
function removeDocumentWrappers(doc: Document): void {
  // Find html element
  const htmlEl = findElement(doc, 'html')
  if (!htmlEl) return

  const bodyEl = findElement(htmlEl, 'body')
  const headEl = findElement(htmlEl, 'head')

  // Remove head entirely
  if (headEl) {
    removeElement(headEl)
  }

  // Unwrap body — move its children up
  if (bodyEl) {
    unwrapElement(bodyEl)
  }

  // Unwrap html — move its children up
  // Re-find since tree changed
  const htmlEl2 = findElement(doc, 'html')
  if (htmlEl2) {
    unwrapElement(htmlEl2)
  }
}

// ─── RSC Streaming Reassembly ───────────────────────────────────────────────

/**
 * Reassemble React Server Components streaming payloads.
 *
 * RSC streaming pages render Suspense boundaries as `<template id="B:N">`
 * placeholders inside `<main>`, with the actual content in hidden
 * `<div hidden id="S:N">` elements later in the document. React's client JS
 * moves S:N content into B:N slots. This function performs that reassembly
 * so wwwaxe can see the real content before processNode strips hidden
 * elements and templates.
 *
 * For each B:N / S:N pair:
 * 1. Insert the hidden div's children where the template was
 * 2. Remove the surrounding `<!--$?-->` and `<!--/$-->` comment markers
 * 3. Remove the template element
 * 4. Remove the hidden div
 */
function reassembleRSCPayloads(doc: Document): void {
  // Find all <template> elements whose id matches B:N (N = one or more digits)
  const templates = findElements(doc, (el) => {
    if (el.tagName.toLowerCase() !== 'template') return false
    const id = el.attribs.id || ''
    return /^B:\d+$/.test(id)
  })

  if (templates.length === 0) return

  for (const tmpl of templates) {
    const boundaryId = tmpl.attribs.id ?? '' // e.g. "B:0"
    const slotNum = boundaryId.slice(2)  // e.g. "0"
    const slotId = 'S:' + slotNum        // e.g. "S:0"

    // Find the corresponding hidden div
    const hiddenDiv = findById(doc, slotId)
    if (!hiddenDiv) continue

    const parent = tmpl.parentNode
    if (!parent || !hasChildren(parent)) continue

    // --- Remove surrounding Suspense boundary comment nodes ---
    // <!--$?--> immediately before the template
    const prevNode = (tmpl as any).prev as Node | null
    if (prevNode && prevNode.type === 'comment' && (prevNode as Comment).data === '$?') {
      removeElement(prevNode as ChildNode)
    }
    // <!--/$--> immediately after the template
    const nextNode = (tmpl as any).next as Node | null
    if (nextNode && nextNode.type === 'comment' && (nextNode as Comment).data === '/$') {
      removeElement(nextNode as ChildNode)
    }

    // --- Move hidden div's children to where the template is ---
    const slotChildren = [...getChildren(hiddenDiv)]
    if (slotChildren.length > 0) {
      const parentChildren = getChildren(parent)
      const tmplIndex = parentChildren.indexOf(tmpl)
      if (tmplIndex === -1) continue

      // Re-parent slot children
      for (const child of slotChildren) {
        child.parent = parent
      }

      // Splice: insert slot children in place of the template
      const mutableParent = parent as any
      mutableParent.children = [
        ...parentChildren.slice(0, tmplIndex),
        ...slotChildren,
        ...parentChildren.slice(tmplIndex + 1),
      ]

      // Fix prev/next sibling links
      const allChildren = getChildren(parent)
      for (let i = 0; i < allChildren.length; i++) {
        const child = allChildren[i] as any
        child.prev = i > 0 ? allChildren[i - 1] : null
        child.next = i < allChildren.length - 1 ? allChildren[i + 1] : null
      }
    } else {
      // No children in slot — just remove the template
      removeElement(tmpl)
    }

    // --- Remove the hidden div entirely ---
    removeElement(hiddenDiv)
  }
}

// ─── Core content / chrome stripping ────────────────────────────────────────

/**
 * Recursively remove chrome elements from a node
 */
function removeChromeElements(node: Node): void {
  if (!hasChildren(node)) return

  // Copy children since we modify during iteration
  const children = [...getChildren(node)]
  for (const child of children) {
    if (isTag(child)) {
      const tag = child.tagName.toLowerCase()
      const role = (child.attribs.role || '').toLowerCase()

      if (CHROME_TAGS.has(tag) || CHROME_ROLES.has(role)) {
        removeElement(child)
        continue
      }

      // <header> is chrome only when it's page-level (not inside a sectioning element).
      // HTML5 allows <header> inside <section>/<article>/<main> as a section header.
      if (tag === 'header') {
        const isInsideSectioning = node && isTag(node) &&
          SECTIONING_TAGS.has((node as Element).tagName.toLowerCase())
        if (!isInsideSectioning) {
          removeElement(child)
          continue
        }
      }
    }
    // Recurse into remaining children
    removeChromeElements(child)
  }
}

/**
 * Find core content when no <main> or role="main" exists.
 * Returns the element to use as the content root, or null.
 */
function findCoreContent(doc: Document): Element | null {
  // 1. Try <article>
  const article = findElement(doc, 'article')
  if (article) return article

  // 2. Try skip-to-content link target
  const skipLinks = findElements(doc, (el) => {
    if (el.tagName.toLowerCase() !== 'a') return false
    const href = el.attribs.href || ''
    if (!href.startsWith('#')) return false
    const text = textContent(el).toLowerCase()
    return text.includes('skip')
  })
  for (const link of skipLinks) {
    const targetId = (link.attribs.href || '').slice(1)
    if (targetId) {
      const target = findById(doc, targetId)
      if (target) return target
    }
  }

  // 3. Try well-known IDs
  for (const id of WELL_KNOWN_CONTENT_IDS) {
    const el = findById(doc, id)
    if (el) return el
  }

  return null
}

/**
 * Strip chrome elements in core mode.
 * If no <main> exists, try to identify core content via fallbacks.
 */
function stripChrome(doc: Document): void {
  // First, strip all chrome elements recursively
  removeChromeElements(doc)

  // Check if <main> or role="main" exists
  const mainEl = findElement(doc, 'main') ||
    findElements(doc, (el) => (el.attribs.role || '').toLowerCase() === 'main')[0] || null

  if (mainEl) {
    // main exists — but check if it has meaningful text content
    // RSC streaming pages and SPAs may have an empty <main> shell
    const mainText = textContent(mainEl).trim()
    if (mainText.length > 50) {
      // main has real content — chrome is already stripped, we're good
      return
    }
    // main is empty or near-empty — fall through to findCoreContent()
  }

  // No main — try fallback content identification
  const coreContent = findCoreContent(doc)
  if (coreContent) {
    // Replace document children with just the core content
    const mutableDoc = doc as any
    coreContent.parent = doc
    mutableDoc.children = [coreContent]
    // Fix prev/next
    ;(coreContent as any).prev = null
    ;(coreContent as any).next = null
  }
}

// ─── Existing v1 helpers ────────────────────────────────────────────────────

/**
 * Check if a meta tag contains useful content information
 */
function isUsefulMeta(el: Element): boolean {
  const name = (el.attribs.name || '').toLowerCase()
  const property = (el.attribs.property || '').toLowerCase()
  const httpEquiv = (el.attribs['http-equiv'] || '').toLowerCase()

  // Useful meta names
  if (['description', 'author', 'keywords', 'robots', 'viewport'].includes(name)) return true
  // Open Graph
  if (property.startsWith('og:')) return true
  // Twitter cards
  if (name.startsWith('twitter:')) return true
  // Charset
  if (el.attribs.charset) return true
  // Content-Type
  if (httpEquiv === 'content-type') return true

  return false
}

/**
 * Check if a link tag should be kept (only canonical and alternate)
 */
function isUsefulLink(el: Element): boolean {
  const rel = (el.attribs.rel || '').toLowerCase()
  return rel === 'canonical' || rel === 'alternate'
}

/**
 * Strip attributes from an element, keeping only content-relevant ones
 */
function stripAttributes(el: Element, options: WwwaxeOptions): void {
  const newAttribs: Record<string, string> = {}

  for (const [key, value] of Object.entries(el.attribs)) {
    const lowerKey = key.toLowerCase()

    // Always skip event handlers
    if (isEventAttribute(lowerKey)) continue

    // Always skip style
    if (lowerKey === 'style') continue

    // Conditionally skip or keep
    if (lowerKey === 'class') {
      if (options.keepClasses) { newAttribs[key] = value }
      continue
    }
    if (lowerKey === 'id') {
      if (options.keepIds !== false) { newAttribs[key] = value }
      continue
    }
    if (isDataAttribute(lowerKey)) {
      if (options.keepDataAttributes) { newAttribs[key] = value }
      continue
    }

    // Keep if in allowlist
    if (CONTENT_ATTRIBUTES.has(lowerKey)) {
      // Strip data URIs from src-like attributes — they can be 250KB+ of base64
      if ((lowerKey === 'src' || lowerKey === 'poster') && value.trimStart().startsWith('data:')) {
        continue
      }
      if (lowerKey === 'srcset') {
        // srcset can have multiple entries — strip any that are data URIs
        const cleaned = value.split(',')
          .map(s => s.trim())
          .filter(s => !s.startsWith('data:'))
          .join(', ')
        if (cleaned) {
          newAttribs[key] = cleaned
        }
        continue
      }
      newAttribs[key] = value
    }
  }

  el.attribs = newAttribs
}

/**
 * Check if an element is hidden
 */
function isHidden(el: Element, options: WwwaxeOptions): boolean {
  if (el.attribs.hidden !== undefined) return true
  if (!options.keepAriaHidden && el.attribs['aria-hidden'] === 'true') return true
  // Check for display:none or visibility:hidden in inline styles
  const style = el.attribs.style || ''
  if (style.includes('display:none') || style.includes('display: none')) return true
  if (style.includes('visibility:hidden') || style.includes('visibility: hidden')) return true
  return false
}

/**
 * Check if a node has any meaningful text content
 */
function hasMeaningfulContent(node: Node): boolean {
  if (isText(node)) {
    return node.data.trim().length > 0
  }
  if (isTag(node)) {
    // Self-closing content elements are meaningful
    const tag = node.tagName.toLowerCase()
    if (['img', 'input', 'br', 'hr', 'video', 'audio', 'source', 'track'].includes(tag)) {
      return true
    }
    // Check children
    if (hasChildren(node)) {
      return getChildren(node).some(child => hasMeaningfulContent(child))
    }
  }
  return false
}

/**
 * Check if an element has any content-relevant attributes worth preserving
 */
function hasContentAttributes(el: Element, options: WwwaxeOptions = {}): boolean {
  for (const key of Object.keys(el.attribs)) {
    const lowerKey = key.toLowerCase()
    if (CONTENT_ATTRIBUTES.has(lowerKey)) return true
    if (lowerKey === 'id' && options.keepIds !== false) return true
    if (lowerKey === 'class' && options.keepClasses) return true
    if (isDataAttribute(lowerKey) && options.keepDataAttributes) return true
  }
  return false
}

/**
 * Process the DOM tree, stripping non-content nodes
 */
function processNode(node: Node, options: WwwaxeOptions, unwrapTags: Set<string>): void {
  // Remove comments
  if (node.type === 'comment') {
    removeElement(node as ChildNode)
    return
  }

  if (!isTag(node)) return

  const tag = node.tagName.toLowerCase()

  // Remove entire tag + children for blacklisted tags
  if (REMOVE_TAGS.has(tag)) {
    // Exception: keep useful link tags
    if (tag === 'link' && isUsefulLink(node)) {
      stripAttributes(node, options)
      return
    }
    removeElement(node)
    return
  }

  // Remove hidden elements
  if (isHidden(node, options)) {
    removeElement(node)
    return
  }

  // Filter meta tags — only keep useful ones
  if (tag === 'meta' && !isUsefulMeta(node)) {
    removeElement(node)
    return
  }

  // Process children first (bottom-up)
  if (hasChildren(node)) {
    // Copy array since we may modify during iteration
    const children = [...getChildren(node)]
    for (const child of children) {
      processNode(child, options, unwrapTags)
    }
  }

  // Strip attributes on all kept elements
  stripAttributes(node, options)

  // For tags not in KEEP_TAGS and not in UNWRAP_TAGS, decide based on whether
  // they have meaningful content
  if (!KEEP_TAGS.has(tag)) {
    if (unwrapTags.has(tag) && !hasContentAttributes(node, options)) {
      // Unwrap: replace element with its children (only if no meaningful attributes)
      unwrapElement(node)
      return
    }
    // Unknown tag — keep if it has content, otherwise remove
    if (!hasMeaningfulContent(node)) {
      removeElement(node)
      return
    }
    // Keep unknown tags that have content (custom elements, etc.)
  }

  // Remove empty structural elements (except void elements and head-level)
  const voidElements = new Set(['br', 'hr', 'img', 'input', 'meta', 'source', 'track', 'col', 'base'])
  const headElements = new Set(['head', 'html', 'body', 'title'])
  if (!voidElements.has(tag) && !headElements.has(tag) && !hasMeaningfulContent(node)) {
    removeElement(node)
  }
}

/**
 * Replace an element with its children (unwrap)
 */
function unwrapElement(el: Element): void {
  const parent = el.parentNode
  if (!parent || !hasChildren(parent)) return

  const children = getChildren(el)
  if (children.length === 0) {
    removeElement(el)
    return
  }

  // Insert children before the element
  const parentChildren = getChildren(parent)
  const index = parentChildren.indexOf(el)
  if (index === -1) {
    removeElement(el)
    return
  }

  for (const child of children) {
    child.parent = parent
  }

  const mutableParent = parent as any
  mutableParent.children = [
    ...parentChildren.slice(0, index),
    ...children,
    ...parentChildren.slice(index + 1)
  ]

  // Fix prev/next links
  const allChildren = getChildren(parent)
  for (let i = 0; i < allChildren.length; i++) {
    const child = allChildren[i] as any
    child.prev = i > 0 ? allChildren[i - 1] : null
    child.next = i < allChildren.length - 1 ? allChildren[i + 1] : null
  }
}

/**
 * Replace an element with a text node in the DOM
 */
function replaceWithText(el: Element, text: string): void {
  const parent = el.parentNode
  if (!parent || !hasChildren(parent)) return

  const textNode = new Text(text)
  textNode.parent = parent

  const parentChildren = getChildren(parent)
  const index = parentChildren.indexOf(el)
  if (index === -1) return

  const mutableParent = parent as any
  mutableParent.children = [
    ...parentChildren.slice(0, index),
    textNode,
    ...parentChildren.slice(index + 1),
  ]

  // Fix prev/next links
  const allChildren = getChildren(parent)
  for (let i = 0; i < allChildren.length; i++) {
    const child = allChildren[i] as any
    child.prev = i > 0 ? allChildren[i - 1] : null
    child.next = i < allChildren.length - 1 ? allChildren[i + 1] : null
  }
}

/**
 * Get the text content of a node (recursively), preserving any already-rewritten markdown text
 */
function getMdTextContent(node: Node): string {
  if (isText(node)) return node.data
  if (hasChildren(node)) {
    return getChildren(node).map(getMdTextContent).join('')
  }
  return ''
}

/**
 * Rewrite HTML tags to markdown syntax (bottom-up DOM pass)
 */
function markdownRewrite(node: Node): void {
  if (!hasChildren(node) && !isTag(node)) return

  // Process children first (bottom-up) so nested rewrites work
  if (hasChildren(node)) {
    const children = [...getChildren(node)]
    for (const child of children) {
      markdownRewrite(child)
    }
  }

  if (!isTag(node)) return

  const el = node as Element
  const tag = el.tagName.toLowerCase()
  const BACKTICK = String.fromCharCode(96)
  const TRIPLE_BACKTICK = BACKTICK + BACKTICK + BACKTICK

  switch (tag) {
    case 'strong':
    case 'b': {
      const text = getMdTextContent(el)
      replaceWithText(el, '**' + text + '**')
      break
    }
    case 'em':
    case 'i': {
      const text = getMdTextContent(el)
      replaceWithText(el, '*' + text + '*')
      break
    }
    case 'del':
    case 's':
    case 'strike': {
      const text = getMdTextContent(el)
      replaceWithText(el, '~~' + text + '~~')
      break
    }
    case 'a': {
      const href = el.attribs.href || ''
      const text = getMdTextContent(el)
      replaceWithText(el, '[' + text + '](' + href + ')')
      break
    }
    case 'img': {
      const src = el.attribs.src || ''
      const alt = el.attribs.alt || ''
      // Skip images with data URIs — they can be 250KB+ of base64
      if (src.trimStart().startsWith('data:')) {
        if (alt) {
          replaceWithText(el, '[image: ' + alt + ']')
        } else {
          removeElement(el)
        }
      } else {
        replaceWithText(el, '![' + alt + '](' + src + ')')
      }
      break
    }
    case 'code': {
      // Check if parent is <pre> — if so, skip (handled by pre)
      const parent = el.parentNode
      if (parent && isTag(parent) && parent.tagName.toLowerCase() === 'pre') {
        break
      }
      const text = getMdTextContent(el)
      replaceWithText(el, BACKTICK + text + BACKTICK)
      break
    }
    case 'pre': {
      // Get content — might be <pre><code>text</code></pre> or <pre>text</pre>
      const children = getChildren(el)
      let text: string
      const only = children[0]
      if (children.length === 1 && only && isTag(only) && only.tagName.toLowerCase() === 'code') {
        text = getMdTextContent(only)
      } else {
        text = getMdTextContent(el)
      }
      replaceWithText(el, '\n' + TRIPLE_BACKTICK + '\n' + text + '\n' + TRIPLE_BACKTICK + '\n')
      break
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = parseInt(tag.charAt(1))
      const prefix = '#'.repeat(level)
      const text = getMdTextContent(el)
      replaceWithText(el, '\n' + prefix + ' ' + text + '\n')
      break
    }
    case 'blockquote': {
      const text = getMdTextContent(el).trim()
      const lines = text.split('\n')
      const quoted = lines.map((line: string) => '> ' + line).join('\n')
      replaceWithText(el, quoted)
      break
    }
    case 'ul': {
      const items = getChildren(el).filter((c: Node) => isTag(c) && (c as Element).tagName.toLowerCase() === 'li')
      const lines = items.map((item: Node) => '- ' + getMdTextContent(item).trim())
      replaceWithText(el, lines.join('\n') + '\n')
      break
    }
    case 'ol': {
      const items = getChildren(el).filter((c: Node) => isTag(c) && (c as Element).tagName.toLowerCase() === 'li')
      const lines = items.map((item: Node, i: number) => (i + 1) + '. ' + getMdTextContent(item).trim())
      replaceWithText(el, lines.join('\n') + '\n')
      break
    }
    case 'hr': {
      replaceWithText(el, '\n---\n')
      break
    }
    case 'br': {
      replaceWithText(el, '\n')
      break
    }
  }
}

/**
 * Collapse excessive whitespace in text nodes
 */
function collapseWhitespace(node: Node): void {
  if (isText(node)) {
    // Collapse runs of whitespace to single space
    node.data = node.data.replace(/[\t\n\r]+/g, ' ').replace(/ {2,}/g, ' ')
    return
  }
  if (hasChildren(node)) {
    for (const child of getChildren(node)) {
      collapseWhitespace(child)
    }
  }
}

/**
 * Remove empty text nodes and trim
 */
function cleanTextNodes(node: Node): void {
  if (!hasChildren(node)) return

  const children = [...getChildren(node)]
  for (const child of children) {
    if (isText(child)) {
      if (child.data.trim().length === 0 && child.data.length > 1) {
        // Replace large whitespace-only nodes with single space
        child.data = ' '
      }
    } else {
      cleanTextNodes(child)
    }
  }
}

/**
 * wwwaxe - Strip non-content data from HTML
 *
 * Takes raw HTML and returns condensed HTML retaining meaningful structure
 * and content while stripping scripts, styles, and presentational attributes.
 */
export function wwwaxe(html: string, options: WwwaxeOptions = {}): string {
  const markdown = options.markdown !== false
  const unwrapTags = getUnwrapTags(options)

  // 1. Parse HTML
  const doc = parseDocument(html, {
    decodeEntities: true,
  })

  // 2. Extract frontmatter from <head> (before processNode strips attributes)
  const frontmatterData = extractFrontmatter(doc)

  // 2.5. Reassemble RSC streaming payloads (before processNode strips hidden elements and templates)
  reassembleRSCPayloads(doc)

  // 3. Process all top-level nodes (existing cleanup)
  const children = [...getChildren(doc)]
  for (const child of children) {
    processNode(child, options, unwrapTags)
  }

  // 4. Remove document wrappers (html, head, body)
  removeDocumentWrappers(doc)

  // 5. If core: true, strip chrome
  if (options.core) {
    stripChrome(doc)
  }

  // 6. Collapse whitespace
  collapseWhitespace(doc)

  // 7. Clean text nodes
  cleanTextNodes(doc)

  // 8. Markdown rewrite (if enabled)
  if (markdown) {
    markdownRewrite(doc)
  }

  // 9. Serialize
  let result = render(doc, {
    encodeEntities: 'utf8',
    selfClosingTags: true,
  })

  // 10. Fix markdown blockquote encoding (dom-serializer encodes > in text nodes)
  if (markdown) {
    result = result.replace(/&gt; /g, '> ')
  }

  // 11. Strip DOCTYPE
  result = result.replace(/<!DOCTYPE[^>]*>/gi, '')

  // 12. Collapse multiple blank lines, trim
  result = result.replace(/\n{3,}/g, '\n').trim()

  // 13. Prepend frontmatter
  const frontmatter = buildFrontmatter(frontmatterData)
  if (frontmatter) {
    result = frontmatter + '\n' + result
  }

  return result
}
