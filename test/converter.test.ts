import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { wwwaxe, wwwaxeFullAndCore, type WwwaxeOptions } from '../src/index.ts'
import { fullAndCoreInWorker, wwwaxeInWorker } from './helpers/worker.ts'

const END = 'the closing sentence of the page'
const FIXTURES = new URL('./fixtures/', import.meta.url)

/** Core mode with ids dropped: the leanest output, and the one that leans on core mode's fallback. */
const CORE_MODE: WwwaxeOptions = { core: true, keepIds: false }

/** Every real-page fixture: the collapsed-answer pages and the trimmed pages in fixtures/real-pages. */
const PAGES = ['collapsed-answers', 'real-pages'].flatMap((dir) =>
  readdirSync(new URL(dir, FIXTURES))
    .filter((file) => file.endsWith('.html'))
    .map((file) => `${dir}/${file}`),
)
const page = (path: string) => readFileSync(new URL(path, FIXTURES), 'utf8')
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** The words of a text, without markup: what keepIds may never change. */
const words = (text: string) =>
  text
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

describe('real pages with the default options', () => {
  const recorded: { outputs: Record<string, { core: string; full: string }> } = JSON.parse(
    readFileSync(new URL('real-pages/baseline-output.json', FIXTURES), 'utf8'),
  )

  it('covers every fixture', () => {
    expect(Object.keys(recorded.outputs).sort()).toEqual([...PAGES].sort())
  })

  // Linear edits and the depth limit must not change a normal page's text.
  for (const path of PAGES) {
    it(`${path}: the same text as the recorded baseline, byte for byte`, () => {
      const html = page(path)
      expect(sha256(wwwaxe(html, { core: true }))).toBe(recorded.outputs[path]!.core)
      expect(sha256(wwwaxe(html, {}))).toBe(recorded.outputs[path]!.full)
    })
  }
})

describe('large flat pages', () => {
  // 16,000 sibling links (344 KB) took about 10 s when every unwrap and
  // markdown rewrite rebuilt the parent's child list: the parked-domain hang.
  // These are ordinary links; a page of 16,000 skip links is another (upstream) case.
  const links = page('real-pages/skip-link-content.html')
    .match(/<a [^>]*>[^<]+<\/a>/g)!
    .filter((link) => !link.includes('href="#'))
  const farm = `<html><body><div>${Array.from({ length: 16_000 }, (_, i) => links[i % links.length]).join(' ')}<p>${END}</p></div></body></html>`

  it('converts 16,000 sibling links from a real page well inside the timeout', () => {
    const started = performance.now()
    const text = wwwaxe(farm, { core: true })
    expect(performance.now() - started).toBeLessThan(3_000)
    expect(text).toContain(END)
    expect(text.match(/\]\(/g)).toHaveLength(16_000)
  })

  it('keeps every bold run on a page of 16,000 of them, quickly', () => {
    const html = `<p>${'<b>w</b> '.repeat(16_000)}</p>`
    const started = performance.now()
    expect(wwwaxe(html).match(/\*\*w\*\*/g)).toHaveLength(16_000)
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  it('removes 16,000 chrome siblings and unwraps 16,000 spans quickly in core mode', () => {
    const html = `<body>${'<nav>menu</nav>'.repeat(16_000)}<main>${'<span>word </span>'.repeat(16_000)}<p>${END}</p></main></body>`
    const started = performance.now()
    const text = wwwaxe(html, { core: true })
    expect(performance.now() - started).toBeLessThan(3_000)
    expect(text).not.toContain('menu')
    expect(text).toContain(END)
  })

  it('removes empty elements around many siblings without losing the text between them', () => {
    const html = `<div>${'<p>keep</p><div></div><span></span>'.repeat(5_000)}</div>`
    const text = wwwaxe(html)
    expect(text.match(/<p>keep<\/p>/g)).toHaveLength(5_000)
    expect(text).not.toContain('<div')
  })
})

describe('deeply nested input', () => {
  // A PDF served as text/html: each hex string (<FEFF0048>) in an uncompressed
  // content stream opens a tag that never closes. No real PDF we fetched has
  // enough of them, so this repeats the pattern.
  const pdf = `%PDF-1.4\n1 0 obj << /Type /Page >> stream\nBT /F1 12 Tf ${'<FEFF0048>Tj '.repeat(30_000)}ET ${END}\nendstream`

  it(
    'converts a PDF-shaped body instead of overflowing the stack',
    { timeout: 20_000 },
    async () => {
      await expect(wwwaxeInWorker(pdf, { core: true })).resolves.toContain(END)
    },
  )

  // Before the depth fallback these converted in a worker (conversion overflowed the stack
  // somewhere past 13,000 levels for unclosed <b>, 27,000 for nested blocks); hashes of that output.
  const DEEP_BUT_FINE = {
    'nested blocks, 10,000 levels': {
      html: `<body>${'<div><p>level</p>'.repeat(10_000)}${'</div>'.repeat(10_000)}</body>`,
      sha: 'b6be4a907bc0c2a688603081d799295b8ce9af81535fd29638d03cdadacab5b0',
    },
    'unclosed <font>, 10,000 levels': {
      html: `<body>${'<font>x '.repeat(10_000)}end</body>`,
      sha: '1378cb082f5f047d066166d125536ee34abcbf54bbb2d5cafc2bde852bbc9435',
    },
  }
  for (const [name, { html, sha }] of Object.entries(DEEP_BUT_FINE)) {
    it(
      `${name}: the same text as before the depth fallback, in a worker`,
      { timeout: 20_000 },
      async () => {
        for (const options of [{ core: true }, {}]) {
          expect(sha256(await wwwaxeInWorker(html, options))).toBe(sha)
        }
      },
    )
  }

  it(
    'flattens only after an overflow, without leaking hidden or script text',
    { timeout: 20_000 },
    async () => {
      const html = `<html><body>${'<div><p>level</p>'.repeat(40_000)}<div aria-hidden="true">hidden words</div><script>var leaked = 1</script><p>one</p>tail <b>foo<i>bar</i>baz</b><p>${END}</p></body></html>`
      const text = await wwwaxeInWorker(html, { core: true })
      expect(text).toContain(END)
      expect(text).toContain('level level')
      expect(text).not.toContain('levellevel')
      expect(text).toContain('one tail')
      expect(text).toContain('foobarbaz')
      expect(text).not.toContain('hidden words')
      expect(text).not.toContain('leaked')
    },
  )

  it(
    'drops hidden subtrees and disclosure panels past the depth limit instead of flattening them',
    { timeout: 20_000 },
    async () => {
      const deep = '<div><p>level</p>'.repeat(40_000)
      const html = `<body><button aria-controls="deep-panel">Question</button>${deep}<div id="deep-panel" aria-hidden="true">panel words</div><p hidden>hidden attribute words</p><p style="display:none">display words</p><p style="visibility: hidden">visibility words</p><!-- comment words --><style>.x{color:red}</style><p>${END}</p></body>`
      const text = await wwwaxeInWorker(html)
      expect(text).toContain(END)
      expect(text).toContain('level level')
      for (const gone of [
        'panel words',
        'hidden attribute words',
        'display words',
        'visibility words',
        'comment words',
        'color:red',
      ]) {
        expect(text).not.toContain(gone)
      }
    },
  )

  it(
    'puts a space where a block starts or ends when flattening, and none around inline elements',
    { timeout: 20_000 },
    async () => {
      const html = `<body>${'<div><p>level</p>'.repeat(40_000)}<p>alpha</p>beta<div>gamma</div>del<a href="/x">ta</a>eps<b>il</b>on</body>`
      const text = await wwwaxeInWorker(html)
      expect(text).toContain('level level')
      expect(text).toContain('alpha beta gamma deltaepsilon')
    },
  )

  it('leaves pages under the depth limit as they were', () => {
    const html = `<html><body>${'<section>'.repeat(400)}<p>${END}</p>${'</section>'.repeat(400)}</body></html>`
    expect(wwwaxe(html)).toBe(`${'<section>'.repeat(400)}<p>${END}</p>${'</section>'.repeat(400)}`)
  })

  it('rethrows errors that are not stack overflows', () => {
    const failing = {
      get core(): boolean {
        throw new Error('not a stack overflow')
      },
    }
    expect(() => wwwaxe('<p>x</p>', failing)).toThrow('not a stack overflow')
  })
})

describe('keepIds: false', () => {
  for (const path of PAGES) {
    it(`${path}: drops ids and id-only wrappers in core mode, never words`, () => {
      const html = page(path)
      const text = wwwaxe(html, CORE_MODE)
      expect(text).not.toMatch(/<[a-z][^>]* id=/)
      expect(words(text)).toEqual(words(wwwaxe(html, { core: true })))
    })
  }

  it('drops every id outside core mode too', () => {
    const text = wwwaxe('<main><section id="a"><p id="b">Copy</p></section></main>', {
      keepIds: false,
    })
    expect(text).not.toContain('id=')
    expect(text).toContain('Copy')
  })

  it('unwraps a site builder’s comp- wrappers', () => {
    const html = page('real-pages/site-builder-plans.html')
    expect(wwwaxe(html, { core: true }).match(/<div id="comp-/g)!.length).toBeGreaterThan(50)
    const text = wwwaxe(html, CORE_MODE)
    expect(text).not.toContain('comp-')
    expect(Buffer.byteLength(text)).toBeLessThan(
      0.7 * Buffer.byteLength(wwwaxe(html, { core: true })),
    )
  })

  // Core mode picks its element after removing chrome, so an <article> in an
  // aside or a <main> holding only a nav doesn't count; ids must still be there.
  const FALLBACK_CASES = {
    'an article inside an aside': `<html><body><div id="promo"><p>Promo text that leads the page</p></div>
      <aside><article><p>An article in the sidebar.</p></article></aside>
      <div id="content"><p>The real content of the page is right here.</p></div></body></html>`,
    'a main that holds only a nav': `<html><body><main><nav><a href="/a">Sixty characters of navigation links in the main element</a></nav></main>
      <div id="banner-x"><p>Banner text that leads the page</p></div>
      <a href="#main-content">Skip to content</a>
      <div id="main-content"><p>The real content of the page is right here.</p></div></body></html>`,
  }
  for (const [name, html] of Object.entries(FALLBACK_CASES)) {
    it(`picks the same content element as with ids: ${name}`, () => {
      const text = wwwaxe(html, CORE_MODE)
      expect(text).toBe('<p>The real content of the page is right here.</p>')
      expect(words(text)).toEqual(words(wwwaxe(html, { core: true })))
    })
  }

  it('keeps words apart when it unwraps adjacent id-only divs', () => {
    const html =
      '<main><div id="q1">How much is Pro?</div><div id="a1">Pro costs $29 a month.</div>tail</main>'
    expect(wwwaxe(html, CORE_MODE)).toBe(
      '<main>How much is Pro? Pro costs $29 a month. tail</main>',
    )
  })

  it('adds no space around id-only inline wrappers, and none where text already has one', () => {
    expect(wwwaxe('<main>foo<span id="x">bar</span>baz</main>', { keepIds: false })).toBe(
      '<main>foobarbaz</main>',
    )
    expect(wwwaxe('<main>foo <div id="x">bar</div> baz</main>', { keepIds: false })).toBe(
      '<main>foo bar baz</main>',
    )
  })

  it('keeps a wrapper that carries other content attributes besides its id', () => {
    const text = wwwaxe('<main><div id="x" title="Tip"><p>Copy</p></div></main>', {
      keepIds: false,
    })
    expect(text).toContain('<div title="Tip">')
  })

  it('can keep text that keeping the wrapper loses', () => {
    // Keeping the id leaves the li outside the list rewrite and the header
    // outside its section, so both are dropped; unwrapping keeps them.
    const list =
      '<main><ul><li>One</li><div id="x"><li>Two</li></div></ul><p>' +
      'x'.repeat(60) +
      '</p></main>'
    expect(wwwaxe(list, { core: true })).not.toContain('Two')
    expect(wwwaxe(list, CORE_MODE)).toContain('- Two')
    const header =
      '<main><section><div id="x"><header><h2>Section title</h2></header></div><p>' +
      'x'.repeat(60) +
      '</p></section></main>'
    expect(wwwaxe(header, { core: true })).not.toContain('Section title')
    expect(wwwaxe(header, CORE_MODE)).toContain('Section title')
  })

  it('still finds the content element on a page with no main or article', () => {
    // The skip-link-content fixture has this shape, but its #main-content already holds
    // everything except chrome; here a sidebar sits outside it.
    const html = `<html><body><a href="#main-content">Skip to content</a>
      <div id="sidebar"><p>Related posts and other sidebar links</p></div>
      <div id="main-content"><p>The article itself is here.</p></div></body></html>`
    const text = wwwaxe(html, CORE_MODE)
    expect(text).toContain('The article itself is here.')
    expect(text).not.toContain('sidebar')
    expect(text).not.toContain('id=')
  })

  it('finds the content element through a skip link with any target id', () => {
    const html = `<html><body><a href="#start-here">Skip navigation</a>
      <div id="sidebar"><p>Sidebar links</p></div>
      <div id="start-here"><p>Target of the skip link.</p></div></body></html>`
    expect(wwwaxe(html, CORE_MODE)).toBe('<p>Target of the skip link.</p>')
  })
})

describe('hidden content that is not an answer', () => {
  it('keeps a hidden menu overlay out, so the heading stays near the top', () => {
    const html = page('real-pages/hidden-menu-overlay.html')
    const text = wwwaxe(html, CORE_MODE)
    expect(text).not.toContain('Back to Menu')
    expect(text.search(/^# /m)).toBeLessThan(4_000)
    // The broad alternative (keep every aria-hidden block) lets it in.
    expect(wwwaxe(html, { core: true, keepAriaHidden: true }).search(/^# /m)).toBeGreaterThan(
      15_000,
    )
  })

  it('drops the consent banner of a JS-rendered pricing page, and keeps the answers', () => {
    for (const options of [CORE_MODE, { core: true }]) {
      const text = wwwaxe(
        page('collapsed-answers/accordion-pricing-rendered-consent.html'),
        options,
      )
      expect(text).not.toContain('you agree to the storing and use of cookies')
      expect(text).toContain('limited to up to 250 active profiles')
      expect(text).toContain('the free plan is available at no monthly cost')
    }
  })
})

describe('one conversion for the full and the core text', () => {
  it('wwwaxeFullAndCore matches two separate conversions on every fixture', () => {
    for (const path of PAGES) {
      const html = page(path)
      expect(wwwaxeFullAndCore(html, {}, { keepIds: false })).toEqual({
        full: wwwaxe(html, {}),
        core: wwwaxe(html, CORE_MODE),
      })
    }
  })

  it('applies the shared options to both outputs and coreOptions to the core one', () => {
    const html = page('real-pages/skip-link-content.html')
    for (const options of [{ markdown: false }, { keepClasses: true }, { keepIds: false }]) {
      expect(wwwaxeFullAndCore(html, options)).toEqual({
        full: wwwaxe(html, { ...options, core: false }),
        core: wwwaxe(html, { ...options, core: true }),
      })
    }
  })

  it('ignores core in the options: full is never core, core is always core', () => {
    const html = page('collapsed-answers/accordion-pricing.html')
    expect(wwwaxeFullAndCore(html, { core: true })).toEqual(
      wwwaxeFullAndCore(html, { core: false }),
    )
  })

  it('does not let the core conversion change the full text', () => {
    const html = page('collapsed-answers/accordion-pricing.html')
    expect(wwwaxeFullAndCore(html).full).toBe(wwwaxe(html))
  })

  // Copying the page for core mode recurses deeper than one conversion. The
  // round-1 build flattened this page in the paired call on every attempt
  // (nested sections at 8,000 to 10,000 levels did too, but take seconds to
  // convert in upstream code); now the pair falls back to two calls.
  const PAIRED_DEEP = {
    'unclosed <b>, 11,000 levels': {
      html: `<body>${'<b>x '.repeat(11_000)}end</body>`,
      full: 'c1f4057d2b58a1194b4b6fbbeae684ecbfbcc50bc4659833a781777405a57b3c',
    },
  }
  for (const [name, { html, full }] of Object.entries(PAIRED_DEEP)) {
    it(
      `${name}: the paired call gives the same full text as before the depth fallback and the single core text`,
      { timeout: 20_000 },
      async () => {
        const pair = await fullAndCoreInWorker(html)
        expect(sha256(pair.full)).toBe(full)
        expect(pair.core).toBe(await wwwaxeInWorker(html, { core: true }))
      },
    )
  }

  it('refuses core options other than keepIds', () => {
    expect(() =>
      Reflect.apply(wwwaxeFullAndCore, undefined, ['<p>x</p>', {}, { markdown: false }]),
    ).toThrow('coreOptions may only set keepIds')
  })
})
