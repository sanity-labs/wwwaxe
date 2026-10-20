import { parseDocument } from 'htmlparser2'
import {
  Element,
  Text,
  Comment,
  Node,
  Document,
  type ChildNode,
  type ParentNode,
  cloneNode,
  isTag,
  isText,
  hasChildren,
} from 'domhandler'
import render from 'dom-serializer'
import { removeElement, textContent, getChildren } from 'domutils'

export interface WwwaxeOptions {
  /** Keep data-* attributes (default: false) */
  keepDataAttributes?: boolean
  /** Keep id attributes (default: true). When false, ids still guide core mode's choice of content element. */
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
  'script',
  'style',
  'noscript',
  'svg',
  'link',
  'iframe',
  // Common non-content elements
  'template',
])

/** Tags that are purely presentational wrappers — unwrap children, discard tag */
const UNWRAP_TAGS = new Set([
  'span',
  'div',
  'font',
  'center',
  'b',
  'i',
  'u',
  'em',
  'strong',
  'small',
  'big',
  'mark',
  'sub',
  'sup',
  'abbr',
  'cite',
  'code',
  'kbd',
  'samp',
  'var',
  'del',
  'ins',
  's',
  'strike',
  'wbr',
  'bdi',
  'bdo',
])

/** Tags that should NOT be unwrapped when markdown mode is enabled (they survive for markdown rewriting) */
const MARKDOWN_PRESERVE_TAGS = new Set(['strong', 'b', 'em', 'i', 'code', 'del', 's', 'strike'])

/** Structural tags we always keep */
const KEEP_TAGS = new Set([
  // Document
  'html',
  'head',
  'body',
  // Meta
  'title',
  'meta',
  'base',
  // Sectioning
  'header',
  'footer',
  'main',
  'nav',
  'article',
  'section',
  'aside',
  'hgroup',
  'search',
  'address',
  // Headings
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  // Content
  'p',
  'blockquote',
  'pre',
  'figure',
  'figcaption',
  'hr',
  'br',
  // Lists
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'menu',
  // Tables
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  // Forms
  'form',
  'fieldset',
  'legend',
  'label',
  'input',
  'textarea',
  'select',
  'option',
  'optgroup',
  'button',
  'output',
  'datalist',
  // Media
  'img',
  'picture',
  'source',
  'video',
  'audio',
  'track',
  // Links
  'a',
  // Other semantic
  'details',
  'summary',
  'dialog',
  'time',
])

/** Attributes to keep — everything else is stripped */
const CONTENT_ATTRIBUTES = new Set([
  // Links & media
  'href',
  'src',
  'srcset',
  'alt',
  'poster',
  // Semantics
  'role',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'title',
  'lang',
  'dir',
  'translate',
  // Form semantics
  'type',
  'name',
  'value',
  'placeholder',
  'for',
  'action',
  'method',
  'required',
  'disabled',
  'checked',
  'selected',
  'readonly',
  'min',
  'max',
  'step',
  'pattern',
  'maxlength',
  'minlength',
  'multiple',
  'rows',
  'cols',
  // Table semantics
  'colspan',
  'rowspan',
  'scope',
  'headers',
  // Meta
  'content',
  'property',
  'charset',
  'http-equiv',
  // Media
  'width',
  'height',
  'controls',
  'autoplay',
  'loop',
  'muted',
  // Time
  'datetime',
  // Details
  'open',
  // Lists
  'start',
  'reversed',
])

/** Chrome tags to strip in core mode */
const CHROME_TAGS = new Set(['nav', 'footer', 'aside', 'dialog'])

/** Sectioning elements whose child <header> is content, not chrome */
const SECTIONING_TAGS = new Set(['section', 'article', 'main', 'aside'])

/** Chrome roles to strip in core mode */
const CHROME_ROLES = new Set(['banner', 'navigation', 'complementary', 'contentinfo', 'search'])

/** Well-known IDs for main content fallback */
const WELL_KNOWN_CONTENT_IDS = ['main-content', 'content', 'main', 'page-content', 'site-content']

/** Depth beyond which a page that overflowed the stack is flattened on the second attempt */
const MAX_DEPTH = 512

const VOID_ELEMENTS = new Set([
  'br',
  'hr',
  'img',
  'input',
  'meta',
  'source',
  'track',
  'col',
  'base',
])
const HEAD_ELEMENTS = new Set(['head', 'html', 'body', 'title'])

/** Options used while processing: the caller's options plus the ids that control disclosure panels */
interface ProcessingOptions extends WwwaxeOptions {
  controlledIds: Set<string>
}

// ─── Single-pass tree edits and the deep-nesting fallback ────────────────────────

/**
 * Replace a node's child list and relink parent, prev and next in one pass.
 * Rebuilding once per parent keeps wide flat pages from going quadratic.
 */
function setChildren(parent: ParentNode, children: ChildNode[]): void {
  parent.children = children
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!
    child.parent = parent
    child.prev = i > 0 ? children[i - 1]! : null
    child.next = i < children.length - 1 ? children[i + 1]! : null
  }
}

/** Whether processing would drop this element anyway, so flattening must not keep its text */
function isHiddenSubtree(el: Element): boolean {
  if (REMOVE_TAGS.has(el.tagName.toLowerCase())) return true
  if (el.attribs.hidden !== undefined || el.attribs['aria-hidden'] === 'true') return true
  const style = el.attribs.style || ''
  return (
    style.includes('display:none') ||
    style.includes('display: none') ||
    style.includes('visibility:hidden') ||
    style.includes('visibility: hidden')
  )
}

function isStackOverflow(error: unknown): boolean {
  return error instanceof RangeError && /call stack/i.test(error.message)
}

/**
 * Run a conversion normally first. Only if it overflows the stack (a PDF served as
 * text/html parses into tens of thousands of unclosed tags) run it again with deep
 * nesting flattened.
 */
function convertWithDepthFallback(convert: (limitNesting: boolean) => string): string {
  try {
    return convert(false)
  } catch (error) {
    if (!isStackOverflow(error)) throw error
    return convert(true)
  }
}

/** Flatten anything nested deeper than MAX_DEPTH into its ancestor at that depth */
function limitDepth(doc: Document): void {
  const stack: Array<[Node, number]> = [[doc, 0]]
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!
    if (!hasChildren(node)) continue
    if (depth >= MAX_DEPTH) {
      flattenSubtree(node)
      continue
    }
    for (const child of node.children) stack.push([child, depth + 1])
  }
}

const BLOCK_END = Symbol('block end')

function isInlineTag(node: Element): boolean {
  const tag = node.tagName.toLowerCase()
  return tag === 'a' || (UNWRAP_TAGS.has(tag) && tag !== 'div' && tag !== 'center')
}

/**
 * Lift every descendant of `el` into `el`, in document order, with a space where a
 * block element starts or ends. Subtrees that would be removed anyway are dropped.
 */
function flattenSubtree(el: ParentNode): void {
  const flat: ChildNode[] = []
  const stack: Array<ChildNode | typeof BLOCK_END> = [...el.children].reverse()
  let boundary = false
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node === BLOCK_END) {
      boundary = true
      continue
    }
    if (node.type === 'comment') continue
    if (isTag(node) && isHiddenSubtree(node)) continue
    if (isTag(node)) {
      if (!isInlineTag(node)) boundary = true
    } else if (boundary) {
      flat.push(new Text(' '))
      boundary = false
    }
    flat.push(node)
    if (hasChildren(node)) {
      if (isTag(node) && !isInlineTag(node)) stack.push(BLOCK_END)
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!)
      setChildren(node, [])
    }
  }
  setChildren(el, flat)
}

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
    const slotNum = boundaryId.slice(2) // e.g. "0"
    const slotId = 'S:' + slotNum // e.g. "S:0"

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

  const kept: ChildNode[] = []
  for (const child of node.children) {
    if (isTag(child)) {
      const tag = child.tagName.toLowerCase()
      const role = (child.attribs.role || '').toLowerCase()

      if (CHROME_TAGS.has(tag) || CHROME_ROLES.has(role)) continue

      // <header> is chrome only when it's page-level (not inside a sectioning element).
      // HTML5 allows <header> inside <section>/<article>/<main> as a section header.
      if (tag === 'header') {
        const isInsideSectioning =
          node && isTag(node) && SECTIONING_TAGS.has((node as Element).tagName.toLowerCase())
        if (!isInsideSectioning) continue
      }
    }
    kept.push(child)
  }
  if (kept.length !== node.children.length) setChildren(node, kept)
  for (const child of kept) removeChromeElements(child)
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
  const mainEl =
    findElement(doc, 'main') ||
    findElements(doc, (el) => (el.attribs.role || '').toLowerCase() === 'main')[0] ||
    null

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
      if (options.keepClasses) {
        newAttribs[key] = value
      }
      continue
    }
    if (lowerKey === 'id') {
      if (options.keepIds !== false) {
        newAttribs[key] = value
      }
      continue
    }
    if (isDataAttribute(lowerKey)) {
      if (options.keepDataAttributes) {
        newAttribs[key] = value
      }
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
        const cleaned = value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => !s.startsWith('data:'))
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

// ─── Collapsed disclosure panels ────────────────────────────────────────────

function hasVisibleText(node: Node): boolean {
  if (isText(node)) return node.data.trim().length > 0
  if (isTag(node) && REMOVE_TAGS.has(node.tagName.toLowerCase())) return false
  return hasChildren(node) && getChildren(node).some((child) => hasVisibleText(child))
}

/** Chrome containers: a control inside one is a menu trigger, not an accordion toggle */
const CONTROL_CHROME_TAGS = new Set(['nav', 'header', 'footer', 'aside'])
const MENU_CONTROL_ROLES = new Set(['combobox', 'searchbox'])
const TEXT_INPUT_TYPES = new Set(['text', 'search'])
/** Roles of popups and overlays that are never an FAQ answer */
const NOT_DISCLOSURE_ROLES = new Set([
  'dialog',
  'alertdialog',
  'menu',
  'menubar',
  'listbox',
  'tooltip',
])

/** Whether an element with aria-controls opens a menu or search suggestions rather than a panel */
function isMenuControl(el: Element): boolean {
  const popup = el.attribs['aria-haspopup']
  if (popup !== undefined && popup !== 'false') return true
  if (
    el.tagName.toLowerCase() === 'input' &&
    TEXT_INPUT_TYPES.has((el.attribs.type || 'text').toLowerCase())
  ) {
    return true
  }
  if (el.attribs['aria-autocomplete'] !== undefined) return true
  if (MENU_CONTROL_ROLES.has((el.attribs.role || '').toLowerCase())) return true
  if (
    /\b(menu|navigation)\b/i.test(el.attribs['aria-label'] || '') &&
    textContent(el).trim() === ''
  ) {
    return true
  }
  for (let node: ParentNode | null = el.parent; node; node = node.parent) {
    if (isTag(node) && CONTROL_CHROME_TAGS.has(node.tagName.toLowerCase())) return true
  }
  return false
}

/** Ids listed in the aria-controls of controls that are not menu triggers */
function collectControlledIds(doc: Document): Set<string> {
  const ids = new Set<string>()
  for (const el of findElements(
    doc,
    (el) => el.attribs['aria-controls'] !== undefined && !isMenuControl(el),
  )) {
    for (const id of (el.attribs['aria-controls'] ?? '').split(/\s+/)) if (id) ids.add(id)
  }
  return ids
}

function isNotDisclosure(el: Element, role: string, controlledIds: Set<string>): boolean {
  if (NOT_DISCLOSURE_ROLES.has(role) || el.attribs['aria-modal'] === 'true') return true
  // A consent banner, unless a question button controls it (an FAQ answer about cookies)
  if (
    role === 'region' &&
    !controlledIds.has(el.attribs.id ?? '') &&
    /cookie|consent/i.test(el.attribs['aria-label'] || '')
  ) {
    return true
  }
  // A menu drawer: its only text is inside a nav
  return containsNav(el) && !hasTextOutsideNav(el)
}

function isNavElement(node: Element): boolean {
  return (
    node.tagName.toLowerCase() === 'nav' || (node.attribs.role || '').toLowerCase() === 'navigation'
  )
}

function containsNav(node: Node): boolean {
  if (isTag(node) && isNavElement(node)) return true
  return hasChildren(node) && getChildren(node).some((child) => containsNav(child))
}

function hasTextOutsideNav(node: Node): boolean {
  if (isText(node)) return node.data.trim().length > 0
  if (!isTag(node)) return false
  if (isNavElement(node) || REMOVE_TAGS.has(node.tagName.toLowerCase())) return false
  return hasChildren(node) && getChildren(node).some((child) => hasTextOutsideNav(child))
}

/** An element with text of its own that a page collapses: accordion and tab panels, details */
function isDisclosurePanel(el: Element, controlledIds: Set<string>): boolean {
  const role = (el.attribs.role || '').toLowerCase()
  if (isNotDisclosure(el, role, controlledIds)) return false
  if (controlledIds.has(el.attribs.id ?? '')) return true
  if (role === 'tabpanel' || role === 'region') return true
  for (let node: ParentNode | null = el.parent; node; node = node.parent) {
    if (isTag(node) && node.tagName.toLowerCase() === 'details') return true
  }
  return false
}

/** aria-hidden="true" hides an element unless it is a disclosure panel with text */
function isAriaHiddenNoise(el: Element, options: ProcessingOptions): boolean {
  if (options.keepAriaHidden || el.attribs['aria-hidden'] !== 'true') return false
  return !(isDisclosurePanel(el, options.controlledIds) && hasVisibleText(el))
}

/** Inline display:none on a disclosure panel with text: scripts collapse these after load */
function isScriptHiddenPanel(el: Element, options: ProcessingOptions): boolean {
  return isDisclosurePanel(el, options.controlledIds) && hasVisibleText(el)
}

/**
 * Check if an element is hidden
 */
function isHidden(el: Element, options: ProcessingOptions): boolean {
  if (el.attribs.hidden !== undefined) return true
  if (isAriaHiddenNoise(el, options)) return true
  // Check for display:none or visibility:hidden in inline styles
  const style = el.attribs.style || ''
  if (
    (style.includes('display:none') || style.includes('display: none')) &&
    !isScriptHiddenPanel(el, options)
  ) {
    return true
  }
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
      return getChildren(node).some((child) => hasMeaningfulContent(child))
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
function processChildren(
  node: ParentNode,
  options: ProcessingOptions,
  unwrapTags: Set<string>,
): void {
  const children: ChildNode[] = []
  for (const child of node.children)
    collectProcessed(children, processNode(child, options, unwrapTags))
  setChildren(node, children)
}

function endsWithSpace(node: ChildNode): boolean {
  return node.type === 'text' && /\s$/.test((node as Text).data)
}

function startsWithSpace(node: ChildNode): boolean {
  return node.type === 'text' && /^\s/.test((node as Text).data)
}

/**
 * Process one node bottom-up. Returns the node to keep, its children to splice in
 * place of it (unwrapped), or null to drop it. The parent rebuilds its child list once.
 */
function processNode(
  node: ChildNode,
  options: ProcessingOptions,
  unwrapTags: Set<string>,
): ChildNode | ChildNode[] | null {
  // Remove comments
  if (node.type === 'comment') return null
  if (!isTag(node)) return node

  const early = enterNode(node, options)
  if (early !== undefined) return early

  const kids = node.children
  const children: ChildNode[] = []
  for (const kid of kids) collectProcessed(children, processNode(kid, options, unwrapTags))
  setChildren(node, children)

  return leaveNode(node, options, unwrapTags)
}

function collectProcessed(children: ChildNode[], result: ChildNode | ChildNode[] | null): void {
  if (result === null) return
  if (Array.isArray(result)) {
    for (const grandchild of result) children.push(grandchild)
  } else {
    children.push(result)
  }
}

/** Decide before descending: null drops the element, undefined means process its children */
function enterNode(node: Element, options: ProcessingOptions): Element | null | undefined {
  const tag = node.tagName.toLowerCase()

  // Remove entire tag + children for blacklisted tags
  if (REMOVE_TAGS.has(tag)) {
    // Exception: keep useful link tags
    if (tag === 'link' && isUsefulLink(node)) {
      stripAttributes(node, options)
      return node
    }
    return null
  }

  // Remove hidden elements
  if (isHidden(node, options)) return null

  // Filter meta tags — only keep useful ones
  if (tag === 'meta' && !isUsefulMeta(node)) return null

  return undefined
}

function leaveNode(
  node: Element,
  options: ProcessingOptions,
  unwrapTags: Set<string>,
): Element | ChildNode[] | null {
  const tag = node.tagName.toLowerCase()

  // Strip attributes on all kept elements
  stripAttributes(node, options)

  // For tags not in KEEP_TAGS and not in UNWRAP_TAGS, decide based on whether
  // they have meaningful content
  if (!KEEP_TAGS.has(tag)) {
    if (unwrapTags.has(tag) && !hasContentAttributes(node, options)) {
      // Unwrap: replace element with its children (only if no meaningful attributes)
      return node.children.length === 0 ? null : node.children
    }
    // Unknown tag — keep if it has content, otherwise remove
    if (!hasMeaningfulContent(node)) return null
    // Keep unknown tags that have content (custom elements, etc.)
  }

  // Remove empty structural elements (except void elements and head-level)
  if (!VOID_ELEMENTS.has(tag) && !HEAD_ELEMENTS.has(tag) && !hasMeaningfulContent(node)) return null
  return node
}

// ─── Dropping ids (keepIds: false) ──────────────────────────────────────────

/** Ids core mode's fallback looks for: skip-link targets and the well-known content ids */
function coreTargetIds(doc: Document): Set<string> {
  const ids = new Set<string>(WELL_KNOWN_CONTENT_IDS)
  for (const link of findElements(
    doc,
    (el) => el.tagName.toLowerCase() === 'a' && (el.attribs.href || '').startsWith('#'),
  )) {
    if (textContent(link).toLowerCase().includes('skip'))
      ids.add((link.attribs.href ?? '').slice(1))
  }
  return ids
}

const BLOCK_UNWRAP_TAGS = new Set(['div', 'center'])

/**
 * Drop every id except those in `keep`, unwrapping wrappers that only carried one.
 * Unwrapping a block wrapper puts a space between its text and its neighbours'.
 */
function dropIds(
  node: Node,
  unwrapTags: Set<string>,
  options: WwwaxeOptions,
  keep: Set<string>,
): void {
  if (!hasChildren(node)) return

  const children: ChildNode[] = []
  let separate = false
  const push = (child: ChildNode): void => {
    const last = children[children.length - 1]
    if (separate && last && !endsWithSpace(last) && !startsWithSpace(child)) {
      children.push(new Text(' '))
    }
    separate = false
    children.push(child)
  }

  for (const child of node.children) {
    if (isTag(child)) {
      dropIds(child, unwrapTags, options, keep)
      if (child.attribs.id !== undefined && keep.has(child.attribs.id)) {
        push(child)
        continue
      }
      delete child.attribs.id
      const tag = child.tagName.toLowerCase()
      if (!KEEP_TAGS.has(tag) && unwrapTags.has(tag) && !hasContentAttributes(child, options)) {
        const block = BLOCK_UNWRAP_TAGS.has(tag)
        if (block) separate = true
        for (const grandchild of child.children) push(grandchild)
        if (block) separate = true
        continue
      }
    }
    push(child)
  }
  setChildren(node, children)
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
 * Rewrite HTML tags to markdown syntax (bottom-up DOM pass). Returns the node to put
 * in this one's place, or null to drop it.
 */
function markdownRewrite(node: ChildNode): ChildNode | null {
  if (hasChildren(node)) rewriteChildren(node)
  return isTag(node) ? rewriteElement(node) : node
}

function rewriteChildren(node: ParentNode): void {
  const kids = node.children
  let changed = false
  const children: ChildNode[] = []
  for (const kid of kids) {
    const next = markdownRewrite(kid)
    if (next !== kid) changed = true
    if (next) children.push(next)
  }
  if (changed) setChildren(node, children)
}

function rewriteElement(el: Element): ChildNode | null {
  const tag = el.tagName.toLowerCase()
  const BACKTICK = String.fromCharCode(96)
  const TRIPLE_BACKTICK = BACKTICK + BACKTICK + BACKTICK

  switch (tag) {
    case 'strong':
    case 'b': {
      const text = getMdTextContent(el)
      return new Text('**' + text + '**')
    }
    case 'em':
    case 'i': {
      const text = getMdTextContent(el)
      return new Text('*' + text + '*')
    }
    case 'del':
    case 's':
    case 'strike': {
      const text = getMdTextContent(el)
      return new Text('~~' + text + '~~')
    }
    case 'a': {
      const href = el.attribs.href || ''
      const text = getMdTextContent(el)
      return new Text('[' + text + '](' + href + ')')
    }
    case 'img': {
      const src = el.attribs.src || ''
      const alt = el.attribs.alt || ''
      // Skip images with data URIs — they can be 250KB+ of base64
      if (src.trimStart().startsWith('data:')) {
        return alt ? new Text('[image: ' + alt + ']') : null
      }
      return new Text('![' + alt + '](' + src + ')')
    }
    case 'code': {
      // Check if parent is <pre> — if so, skip (handled by pre)
      const parent = el.parentNode
      if (parent && isTag(parent) && parent.tagName.toLowerCase() === 'pre') {
        return el
      }
      const text = getMdTextContent(el)
      return new Text(BACKTICK + text + BACKTICK)
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
      return new Text('\n' + TRIPLE_BACKTICK + '\n' + text + '\n' + TRIPLE_BACKTICK + '\n')
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
      return new Text('\n' + prefix + ' ' + text + '\n')
    }
    case 'blockquote': {
      const text = getMdTextContent(el).trim()
      const lines = text.split('\n')
      const quoted = lines.map((line: string) => '> ' + line).join('\n')
      return new Text(quoted)
    }
    case 'ul': {
      const items = getChildren(el).filter(
        (c: Node) => isTag(c) && (c as Element).tagName.toLowerCase() === 'li',
      )
      const lines = items.map((item: Node) => '- ' + getMdTextContent(item).trim())
      return new Text(lines.join('\n') + '\n')
    }
    case 'ol': {
      const items = getChildren(el).filter(
        (c: Node) => isTag(c) && (c as Element).tagName.toLowerCase() === 'li',
      )
      const lines = items.map(
        (item: Node, i: number) => i + 1 + '. ' + getMdTextContent(item).trim(),
      )
      return new Text(lines.join('\n') + '\n')
    }
    case 'hr': {
      return new Text('\n---\n')
    }
    case 'br': {
      return new Text('\n')
    }
  }
  return el
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

/** Parse and run the passes that don't depend on keepIds, core or markdown */
function prepareDocument(
  html: string,
  options: WwwaxeOptions,
  limitNesting: boolean,
): { doc: Document; frontmatter: string } {
  // 1. Parse HTML
  const doc = parseDocument(html, {
    decodeEntities: true,
  })
  if (limitNesting) limitDepth(doc)

  // ids stay while processing: id-only wrappers and disclosure panels are decided on them
  const processing: ProcessingOptions = {
    ...options,
    keepIds: true,
    controlledIds: collectControlledIds(doc),
  }

  // 2. Extract frontmatter from <head> (before processNode strips attributes)
  const frontmatter = buildFrontmatter(extractFrontmatter(doc))

  // 2.5. Reassemble RSC streaming payloads (before processNode strips hidden elements and templates)
  reassembleRSCPayloads(doc)

  // 3. Process all top-level nodes (existing cleanup)
  processChildren(doc, processing, getUnwrapTags(options))

  // 4. Remove document wrappers (html, head, body)
  removeDocumentWrappers(doc)

  return { doc, frontmatter }
}

/** The passes that depend on keepIds, core and markdown, ending in the serialized string */
function finishDocument(doc: Document, frontmatter: string, options: WwwaxeOptions): string {
  const markdown = options.markdown !== false
  const dropIdAttributes = options.keepIds === false

  // Core mode's fallback needs the ids; they are dropped once it has picked its element
  if (dropIdAttributes) {
    dropIds(doc, getUnwrapTags(options), options, options.core ? coreTargetIds(doc) : new Set())
  }

  // 5. If core: true, strip chrome
  if (options.core) {
    stripChrome(doc)
  }
  if (dropIdAttributes && options.core) {
    dropIds(doc, getUnwrapTags(options), options, new Set())
  }

  // 6. Collapse whitespace
  collapseWhitespace(doc)

  // 7. Clean text nodes
  cleanTextNodes(doc)

  // 8. Markdown rewrite (if enabled)
  if (markdown) {
    rewriteChildren(doc)
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
  if (frontmatter) {
    result = frontmatter + '\n' + result
  }

  return result
}

/**
 * wwwaxe - Strip non-content data from HTML
 *
 * Takes raw HTML and returns condensed HTML retaining meaningful structure
 * and content while stripping scripts, styles, and presentational attributes.
 */
export function wwwaxe(html: string, options: WwwaxeOptions = {}): string {
  return convertWithDepthFallback((limitNesting) => {
    const { doc, frontmatter } = prepareDocument(html, options, limitNesting)
    return finishDocument(doc, frontmatter, options)
  })
}

/**
 * Full and core output of one page from a single parse: the same strings as
 * `wwwaxe(html, options)` with `core: false` and with `{ ...options, ...coreOptions, core: true }`.
 * `coreOptions` may only set `keepIds`.
 */
export function wwwaxeFullAndCore(
  html: string,
  options: WwwaxeOptions = {},
  coreOptions: Pick<WwwaxeOptions, 'keepIds'> = {},
): { full: string; core: string } {
  for (const key of Object.keys(coreOptions)) {
    if (key !== 'keepIds') {
      throw new Error('wwwaxeFullAndCore: coreOptions may only set keepIds, got ' + key)
    }
  }
  const fullOptions = { ...options, core: false }
  const coreModeOptions = { ...options, ...coreOptions, core: true }
  try {
    const { doc, frontmatter } = prepareDocument(html, options, false)
    // Copying the parsed page recurses more deeply than one conversion
    const coreDoc = cloneNode(doc, true)
    return {
      full: finishDocument(doc, frontmatter, fullOptions),
      core: finishDocument(coreDoc, frontmatter, coreModeOptions),
    }
  } catch (error) {
    if (!isStackOverflow(error)) throw error
    return { full: wwwaxe(html, fullOptions), core: wwwaxe(html, coreModeOptions) }
  }
}
