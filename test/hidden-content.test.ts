import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { wwwaxe, type WwwaxeOptions } from '../src/index.ts'

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/collapsed-answers/${name}.html`, import.meta.url), 'utf8')
}

// These accordion pages are server-rendered with every FAQ answer inside a row marked
// aria-hidden="true" (the collapsed accordion state). Each answer below appears in the
// fixture's HTML only inside such a row, except where noted.
const PRICING_ANSWERS = [
  'limited to up to 250 active profiles',
  'the free plan is available at no monthly cost',
  'free plan includes $5 of mobile messages per month',
  'head to Account Settings → Billing',
]

const FAQ_ANSWERS: Record<string, string[]> = {
  'accordion-pricing': PRICING_ANSWERS,
  'accordion-privacy': [
    'compliance ultimately depends on how your business collects',
    'Acme stores customer data securely',
    'penalties up to €20 million',
  ],
  'accordion-segments': [
    'Segments are updated automatically in real-time',
    'go as far back in time as your data allows',
    'Because Acme stores event data at the profile level indefinitely',
  ],
  'accordion-portfolios': [
    'There is no additional fee; portfolio creation is included with all paid accounts',
    'An account owner or admin can create a portfolio',
  ],
}

describe('collapsed FAQ answers on real accordion pages', () => {
  for (const [page, answers] of Object.entries(FAQ_ANSWERS)) {
    for (const core of [true, false]) {
      it(`${page}: every answer reaches the text (${core ? 'core' : 'full'} mode)`, () => {
        const text = wwwaxe(fixture(page), { core, markdown: true })
        for (const answer of answers) expect(text).toContain(answer)
      })
    }
  }

  // A JS-rendered page is the HTML after the page's scripts ran, and the accordion script
  // adds an inline display: none to every collapsed row, on top of aria-hidden.
  for (const core of [true, false]) {
    it(`pricing page after JS rendering: every answer reaches the text (${core ? 'core' : 'full'} mode)`, () => {
      const text = wwwaxe(fixture('accordion-pricing-rendered'), { core, markdown: true })
      for (const answer of PRICING_ANSWERS) expect(text).toContain(answer)
      expect(text).not.toContain('M.88 0 4.5 3.101')
    })
  }

  it('details-faq: answers inside details elements are kept', () => {
    const text = wwwaxe(fixture('details-faq'), { core: true, markdown: true })
    expect(text).toContain('Studio FAQs')
    expect(text).toContain('Studio is your always-on AI marketing agent')
  })

  it('drops the decorative aria-hidden pieces of the same pages', () => {
    for (const page of Object.keys(FAQ_ANSWERS)) {
      const text = wwwaxe(fixture(page), { core: true, markdown: true })
      expect(text).not.toContain('M.88 0 4.5 3.101')
      expect(text).not.toContain('logo-a.svg')
      expect(text).not.toContain('logo-b.svg')
      expect(text).not.toContain('window.dataLayer')
      expect(text).not.toContain('accordion__panel{')
    }
  })
})

describe('hidden-content rules', () => {
  const convert = (body: string): string =>
    wwwaxe(`<html><body><main>${body}</main></body></html>`, { markdown: true })

  it('keeps aria-hidden disclosure panels: controlled by aria-controls, tab panels, regions, inside details', () => {
    const text = convert(
      `<button aria-expanded="false" aria-controls="p1 p2">Question one</button>
       <div id="p1" aria-hidden="true"><p>Answer one is real copy.</p></div>
       <div id="p2" aria-hidden="true"><p>Answer two is real copy.</p></div>
       <div role="tabpanel" aria-hidden="true"><p>Second tab body.</p></div>
       <div role="region" aria-hidden="true"><p>Region body.</p></div>
       <details><summary>More</summary><div aria-hidden="true"><p>Details body.</p></div></details>`,
    )
    for (const kept of [
      'Answer one is real copy.',
      'Answer two is real copy.',
      'Second tab body.',
      'Region body.',
      'Details body.',
    ])
      expect(text).toContain(kept)
  })

  it('drops aria-hidden blocks that are not disclosure panels, even with text', () => {
    const text = convert(
      `<h1>Article heading</h1>
       <div class="off-canvas-menu" aria-hidden="true"><a href="/a">Menu entry one</a><a href="/b">Menu entry two</a></div>
       <div class="carousel" aria-hidden="true"><p>Best of carousel slide</p></div>
       <div class="sticky-prices" aria-hidden="true"><p>Plan costs $10 per month</p></div>
       <span aria-hidden="true">Icon</span>`,
    )
    expect(text).toContain('Article heading')
    for (const gone of ['Menu entry', 'carousel slide', 'Plan costs', 'Icon'])
      expect(text).not.toContain(gone)
  })

  it('drops aria-controls menu flyouts: popup triggers and controls inside nav, header, footer, aside', () => {
    const text = convert(
      `<h1>Article heading</h1>
       <nav><button aria-expanded="false" aria-controls="flyout">Products</button>
         <div id="flyout" aria-hidden="true"><a href="/a">Flyout link one</a></div></nav>
       <button aria-haspopup="true" aria-controls="menu2">Account</button>
       <div id="menu2" aria-hidden="true"><a href="/b">Popup menu entry</a></div>
       <footer><button aria-controls="footer-list">Company</button>
         <div id="footer-list" aria-hidden="true"><a href="/c">Footer link</a></div></footer>
       <button aria-controls="faq1">Question</button>
       <div id="faq1" aria-hidden="true"><p>FAQ answer stays.</p></div>`,
    )
    expect(text).toContain('FAQ answer stays.')
    for (const gone of ['Flyout link', 'Popup menu entry', 'Footer link'])
      expect(text).not.toContain(gone)
  })

  it('keeps collapsed details content', () => {
    const text = convert('<details><summary>More</summary><p>Closed panel copy.</p></details>')
    expect(text).toContain('Closed panel copy.')
  })

  it('drops aria-hidden elements with no text: icons and decorative or duplicated images', () => {
    const text = convert(
      `<p>Visible copy</p>
       <span aria-hidden="true"><svg><title>Arrow</title><path d="M0 0"/></svg></span>
       <i aria-hidden="true"></i>
       <picture aria-hidden="true"><img src="https://example.com/decor.png" alt=""></picture>
       <img aria-hidden="true" src="https://example.com/duplicate.png" alt="logo">`,
    )
    expect(text).toContain('Visible copy')
    expect(text).not.toContain('Arrow')
    expect(text).not.toContain('decor.png')
    expect(text).not.toContain('duplicate.png')
  })

  it('keeps dropping scripts, styles, templates and noscript inside aria-hidden', () => {
    const text = convert(
      `<p>Visible copy</p>
       <div aria-hidden="true"><script>var secret = 1</script><style>.x{color:red}</style></div>
       <template><p>Template copy</p></template>
       <noscript>Enable JavaScript</noscript>`,
    )
    expect(text).toContain('Visible copy')
    for (const gone of ['secret', 'color:red', 'Template copy', 'Enable JavaScript'])
      expect(text).not.toContain(gone)
  })

  it('keeps disclosure panels that a script hid with display:none', () => {
    const text = convert(
      `<button aria-expanded="false" aria-controls="p1">Question one</button>
       <div id="p1" aria-hidden="true" style="max-height: 0px; overflow: hidden; display: none;"><p>Answer one is real copy.</p></div>
       <div role="tabpanel" style="display:none"><p>Second tab body.</p></div>
       <details><summary>More</summary><div style="display: none"><p>Details body.</p></div></details>`,
    )
    for (const kept of ['Answer one is real copy.', 'Second tab body.', 'Details body.'])
      expect(text).toContain(kept)
  })

  it('drops display:none that is not a disclosure panel or has no text', () => {
    const text = convert(
      `<h1>Article heading</h1>
       <div style="display:none"><p>Form success message</p></div>
       <nav><button aria-expanded="false" aria-controls="flyout">Products</button>
         <div id="flyout" style="display: none"><a href="/a">Flyout link one</a></div></nav>
       <button aria-haspopup="true" aria-controls="menu2">Account</button>
       <div id="menu2" style="display:none"><a href="/b">Popup menu entry</a></div>
       <button aria-controls="pic">Question</button>
       <div id="pic" style="display:none"><img src="https://example.com/hidden.png" alt=""></div>`,
    )
    expect(text).toContain('Article heading')
    for (const gone of ['Form success message', 'Flyout link', 'Popup menu entry', 'hidden.png'])
      expect(text).not.toContain(gone)
  })

  it('drops dialogs, menus, listboxes and modals even when a control points to them', () => {
    const text = convert(
      `<h1>Article heading</h1>
       <button aria-controls="modal">Book a demo</button>
       <div id="modal" role="dialog" style="display:none"><p>Demo dialog form copy</p></div>
       <button aria-controls="alert">Details</button>
       <div id="alert" role="alertdialog" aria-hidden="true"><p>Alert dialog copy</p></div>
       <button aria-controls="sheet">Share</button>
       <div id="sheet" aria-modal="true" style="display: none"><p>Modal sheet copy</p></div>
       <button aria-controls="menu3">More</button>
       <ul id="menu3" role="menu" style="display:none"><li>Menu role entry</li></ul>
       <button aria-controls="list1">Country</button>
       <ul id="list1" role="listbox" aria-hidden="true"><li>Listbox option</li></ul>
       <button aria-controls="tip">Info</button>
       <div id="tip" role="tooltip" style="display:none">Tooltip copy</div>`,
    )
    expect(text).toContain('Article heading')
    for (const gone of [
      'Demo dialog',
      'Alert dialog',
      'Modal sheet',
      'Menu role entry',
      'Listbox option',
      'Tooltip copy',
    ])
      expect(text).not.toContain(gone)
  })

  it('drops search suggestions, icon-only menu buttons, nav drawers, cookie regions and hidden details', () => {
    const text = convert(
      `<h1>Article heading</h1>
       <input type="search" aria-controls="suggest"><div id="suggest" style="display:none"><a href="/s">Popular search one</a></div>
       <div role="combobox" aria-controls="opts">Pick</div><div id="opts" aria-hidden="true"><p>Combobox option text</p></div>
       <div class="site-header"><button aria-controls="mobile" aria-label="Open menu"><svg><path d="M0 0"/></svg></button></div>
       <div id="mobile" style="display:none"><a href="/shop">Mobile menu link</a></div>
       <button aria-controls="drawer">Browse</button>
       <div id="drawer" aria-hidden="true"><nav><a href="/d">Drawer link</a></nav></div>
       <div role="region" aria-label="Cookie banner" style="display:none"><p>We use cookies to improve</p></div>
       <details style="display:none"><summary>Hidden summary</summary><p>Hidden details copy</p></details>
       <button aria-controls="q2">How do I edit the menu?</button>
       <div id="q2" style="display:none"><p>Menu editing answer stays.</p></div>`,
    )
    expect(text).toContain('Menu editing answer stays.')
    for (const gone of [
      'Popular search',
      'Combobox option',
      'Mobile menu link',
      'Drawer link',
      'We use cookies',
      'Hidden details copy',
    ])
      expect(text).not.toContain(gone)
  })

  for (const [path, hide] of [
    ['aria-hidden', 'aria-hidden="true"'],
    ['display:none', 'style="display:none"'],
  ]) {
    it(`keeps answers with a related-links nav, but not nav-only drawers (${path})`, () => {
      const text = convert(
        `<button aria-controls="a1">How do I export my data?</button>
         <div id="a1" ${hide}><p>Export answer with related links.</p><nav><a href="/r">Related article</a></nav></div>
         <button aria-controls="drawer2">Browse</button>
         <div id="drawer2" ${hide}><nav><a href="/d">Drawer only link</a></nav></div>`,
      )
      expect(text).toContain('Export answer with related links.')
      expect(text).not.toContain('Drawer only link')
    })

    it(`keeps FAQ answers about cookies and consent that a question controls (${path})`, () => {
      const text = convert(
        `<button aria-controls="faq-cookies">Do you use cookies?</button>
         <div id="faq-cookies" role="region" ${hide}><p>Cookie answer text.</p></div>
         <button aria-controls="consent-1">How do I withdraw consent?</button>
         <div id="consent-1" class="consent-faq" role="region" aria-label="Consent FAQ" ${hide}><p>Consent answer text.</p></div>
         <div role="region" aria-label="Cookie banner" ${hide}><p>We use cookies to improve</p></div>`,
      )
      expect(text).toContain('Cookie answer text.')
      expect(text).toContain('Consent answer text.')
      expect(text).not.toContain('We use cookies')
    })

    it(`keeps checkbox accordions while text and search inputs stay menu controls (${path})`, () => {
      const text = convert(
        `<input type="checkbox" id="t1" aria-controls="c1"><label for="t1">What is a segment?</label>
         <div id="c1" ${hide}><p>Checkbox accordion answer.</p></div>
         <input type="radio" name="tabs" aria-controls="c2"><div id="c2" ${hide}><p>Radio tab body.</p></div>
         <input aria-controls="typeahead"><div id="typeahead" ${hide}><a href="/t">Typeahead entry</a></div>`,
      )
      expect(text).toContain('Checkbox accordion answer.')
      expect(text).toContain('Radio tab body.')
      expect(text).not.toContain('Typeahead entry')
    })
  }

  it('still drops the hidden attribute and display:none', () => {
    const text = convert(
      `<p>Visible copy</p>
       <div hidden><p>Hidden attribute copy</p></div>
       <div style="display:none"><p>Inline hidden copy</p></div>`,
    )
    expect(text).toContain('Visible copy')
    expect(text).not.toContain('Hidden attribute copy')
    expect(text).not.toContain('Inline hidden copy')
  })

  it('keeps aria-hidden="false" untouched', () => {
    const text = convert('<div aria-hidden="false"><p>Open answer.</p></div>')
    expect(text).toContain('Open answer.')
  })
})

describe('hidden-content rules, one test per rule', () => {
  const convert = (body: string, options: WwwaxeOptions = {}): string =>
    wwwaxe(`<html><body><main>${body}</main></body></html>`, options)

  it('treats aria-haspopup="false" as no menu trigger, so the panel stays', () => {
    const text = convert(
      `<button aria-haspopup="false" aria-controls="p">Question</button>
       <div id="p" aria-hidden="true"><p>Panel behind a non-popup button.</p></div>`,
    )
    expect(text).toContain('Panel behind a non-popup button.')
  })

  for (const popup of ['true', 'menu', 'listbox', 'dialog']) {
    it(`treats aria-haspopup="${popup}" as a menu trigger`, () => {
      const text = convert(
        `<button aria-haspopup="${popup}" aria-controls="p">Open</button>
         <div id="p" aria-hidden="true"><p>Popup copy.</p></div>`,
      )
      expect(text).not.toContain('Popup copy.')
    })
  }

  it('treats a control with aria-autocomplete as a menu trigger', () => {
    const text = convert(
      `<div contenteditable aria-autocomplete="list" aria-controls="s">Search</div>
       <div id="s" aria-hidden="true"><p>Autocomplete suggestion.</p></div>`,
    )
    expect(text).not.toContain('Autocomplete suggestion.')
  })

  it('treats role searchbox and role combobox controls as menu triggers', () => {
    const text = convert(
      `<div role="searchbox" aria-controls="a">Find</div>
       <div id="a" aria-hidden="true"><p>Searchbox suggestion.</p></div>
       <div role="combobox" aria-controls="b">Pick</div>
       <div id="b" style="display:none"><p>Combobox option.</p></div>`,
    )
    expect(text).not.toContain('Searchbox suggestion.')
    expect(text).not.toContain('Combobox option.')
  })

  it('treats text and search inputs as menu triggers, but not checkboxes or radios', () => {
    const text = convert(
      `<input type="text" aria-controls="t"><div id="t" aria-hidden="true"><p>Text input flyout.</p></div>
       <input type="search" aria-controls="s"><div id="s" aria-hidden="true"><p>Search input flyout.</p></div>
       <input type="checkbox" aria-controls="c"><div id="c" aria-hidden="true"><p>Checkbox panel.</p></div>`,
    )
    expect(text).not.toContain('Text input flyout.')
    expect(text).not.toContain('Search input flyout.')
    expect(text).toContain('Checkbox panel.')
  })

  for (const label of ['Open menu', 'Toggle navigation', 'Main Menu']) {
    it(`treats an icon-only button labelled "${label}" as a menu trigger`, () => {
      const text = convert(
        `<button aria-label="${label}" aria-controls="p"><svg><path d="M0 0"/></svg></button>
         <div id="p" aria-hidden="true"><p>Drawer copy.</p></div>`,
      )
      expect(text).not.toContain('Drawer copy.')
    })
  }

  it('does not treat a button with text, or an unrelated label, as a menu trigger', () => {
    const text = convert(
      `<button aria-label="Open menu" aria-controls="a">How do I edit the menu?</button>
       <div id="a" aria-hidden="true"><p>Answer with a labelled question.</p></div>
       <button aria-label="Show answer" aria-controls="b"><svg><path d="M0 0"/></svg></button>
       <div id="b" aria-hidden="true"><p>Answer behind an icon button.</p></div>`,
    )
    expect(text).toContain('Answer with a labelled question.')
    expect(text).toContain('Answer behind an icon button.')
  })

  it('treats a control inside header, nav, footer or aside as a menu trigger', () => {
    for (const tag of ['header', 'nav', 'footer', 'aside']) {
      const text = wwwaxe(
        `<html><body><${tag}><button aria-controls="p">Open</button></${tag}>
         <main><div id="p" aria-hidden="true"><p>Chrome flyout copy.</p></div></main></body></html>`,
      )
      expect(text).not.toContain('Chrome flyout copy.')
    }
  })

  it('keeps a panel when any one of several controls is not a menu trigger', () => {
    const text = convert(
      `<nav><button aria-controls="p">Menu</button></nav>
       <button aria-controls="p">Question</button>
       <div id="p" aria-hidden="true"><p>Shared panel copy.</p></div>`,
    )
    expect(text).toContain('Shared panel copy.')
  })

  it('treats a menubar role as never a disclosure panel', () => {
    const text = convert(
      `<button aria-controls="bar">Bar</button>
       <ul id="bar" role="menubar" aria-hidden="true"><li>Menubar entry</li></ul>`,
    )
    expect(text).not.toContain('Menubar entry')
  })

  it('keeps tab panels and regions without a control, and drops other roles', () => {
    const text = convert(
      `<div role="tabpanel" aria-hidden="true"><p>Tab panel without a control.</p></div>
       <div role="region" aria-hidden="true"><p>Region without a control.</p></div>
       <div role="article" aria-hidden="true"><p>Article role is not a panel.</p></div>`,
    )
    expect(text).toContain('Tab panel without a control.')
    expect(text).toContain('Region without a control.')
    expect(text).not.toContain('Article role is not a panel.')
  })

  it('keeps a panel whose text sits next to a nav, and drops one that is only a nav', () => {
    const text = convert(
      `<div role="region" aria-hidden="true"><p>Region text beside a nav.</p><div role="navigation"><a href="/x">Linked</a></div></div>
       <div role="region" aria-hidden="true"><div role="navigation"><a href="/y">Nav only link</a></div></div>`,
    )
    expect(text).toContain('Region text beside a nav.')
    expect(text).not.toContain('Nav only link')
  })

  it('drops a region labelled cookies or consent unless something controls it', () => {
    const text = convert(
      `<div role="region" aria-label="Manage consent preferences" aria-hidden="true"><p>Consent region copy.</p></div>
       <div role="region" aria-label="Frequently asked questions" aria-hidden="true"><p>FAQ region copy.</p></div>`,
    )
    expect(text).not.toContain('Consent region copy.')
    expect(text).toContain('FAQ region copy.')
  })

  it('drops a disclosure panel with no visible text, such as only a script or an empty box', () => {
    const text = convert(
      `<button aria-controls="a">One</button><div id="a" aria-hidden="true"><script>var x = 1</script></div>
       <button aria-controls="b">Two</button><div id="b" aria-hidden="true">   </div>
       <button aria-controls="c">Three</button><div id="c" style="display:none"><style>.x{}</style></div>`,
    )
    expect(text).not.toContain('var x')
    expect(text).not.toContain('.x{}')
  })

  it('keeps dropping visibility:hidden and the hidden attribute, even on disclosure panels', () => {
    const text = convert(
      `<button aria-controls="a">One</button><div id="a" style="visibility:hidden"><p>Invisible panel copy.</p></div>
       <button aria-controls="b">Two</button><div id="b" style="visibility: hidden"><p>Spaced invisible copy.</p></div>
       <button aria-controls="c">Three</button><div id="c" hidden><p>Hidden attribute panel copy.</p></div>`,
    )
    for (const gone of ['Invisible panel', 'Spaced invisible', 'Hidden attribute panel']) {
      expect(text).not.toContain(gone)
    }
  })

  it('keeps every aria-hidden element with keepAriaHidden, as before', () => {
    const html = `<div class="menu" aria-hidden="true"><a href="/a">Menu entry one</a></div>`
    expect(convert(html)).not.toContain('Menu entry one')
    expect(convert(html, { keepAriaHidden: true })).toContain('Menu entry one')
  })

  it('applies the same rules in core mode', () => {
    const text = convert(
      `<button aria-controls="p">Question</button><div id="p" aria-hidden="true"><p>Core mode answer.</p></div>
       <div class="menu" aria-hidden="true"><a href="/a">Core mode menu entry</a></div>`,
      { core: true },
    )
    expect(text).toContain('Core mode answer.')
    expect(text).not.toContain('Core mode menu entry')
  })

  it('finds a controlled panel that is nested inside other hidden markup', () => {
    const text = convert(
      `<button aria-controls="inner">Question</button>
       <div><div><div id="inner" aria-hidden="true"><p>Nested panel copy.</p></div></div></div>`,
    )
    expect(text).toContain('Nested panel copy.')
  })
})
