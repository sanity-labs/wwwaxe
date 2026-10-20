import { describe, it, expect } from 'vitest'
import { wwwaxe } from '../src/wwwaxe'

describe('wwwaxe', () => {
  describe('script and style removal', () => {
    it('removes script tags and contents', () => {
      const html = '<div><p>Hello</p><script>alert("xss")</script></div>'
      const result = wwwaxe(html)
      expect(result).not.toContain('script')
      expect(result).not.toContain('alert')
      expect(result).toContain('Hello')
    })

    it('removes style tags and contents', () => {
      const html = '<div><p>Hello</p><style>.foo { color: red; }</style></div>'
      const result = wwwaxe(html)
      expect(result).not.toContain('style')
      expect(result).not.toContain('color')
      expect(result).toContain('Hello')
    })

    it('removes noscript tags', () => {
      const html = '<div><p>Hello</p><noscript>Enable JS</noscript></div>'
      const result = wwwaxe(html)
      expect(result).not.toContain('noscript')
      expect(result).not.toContain('Enable JS')
    })

    it('removes inline SVGs', () => {
      const html =
        '<div><p>Hello</p><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"/></svg></div>'
      const result = wwwaxe(html)
      expect(result).not.toContain('svg')
      expect(result).not.toContain('circle')
    })
  })

  describe('attribute stripping', () => {
    it('removes class attributes', () => {
      const html = '<p class="text-lg font-bold text-gray-700">Hello</p>'
      const result = wwwaxe(html)
      expect(result).not.toContain('class')
      expect(result).toContain('<p>Hello</p>')
    })

    it('removes style attributes', () => {
      const html = '<p style="color: red; font-size: 16px;">Hello</p>'
      const result = wwwaxe(html)
      expect(result).not.toContain('style')
    })

    it('removes data-* attributes', () => {
      const html = '<div data-testid="foo" data-tracking="bar"><p>Hello</p></div>'
      const result = wwwaxe(html)
      expect(result).not.toContain('data-')
    })

    it('removes event handlers', () => {
      const html = '<button onclick="doStuff()" onmouseover="highlight()">Click</button>'
      const result = wwwaxe(html)
      expect(result).not.toContain('onclick')
      expect(result).not.toContain('onmouseover')
      expect(result).toContain('Click')
    })

    it('keeps id attributes by default (v2 change)', () => {
      const html = '<div id="main-content"><p>Hello</p></div>'
      const result = wwwaxe(html)
      expect(result).toContain('id="main-content"')
    })

    it('removes id attributes when keepIds is false', () => {
      const html = '<div id="main-content"><p>Hello</p></div>'
      const result = wwwaxe(html, { keepIds: false })
      expect(result).not.toContain('id=')
    })

    it('keeps href on links', () => {
      const html = '<a href="/about" class="nav-link text-blue-500">About</a>'
      const result = wwwaxe(html, { markdown: false })
      expect(result).toContain('href="/about"')
      expect(result).not.toContain('class')
    })

    it('keeps src and alt on images', () => {
      const html =
        '<img src="/photo.jpg" alt="A photo" class="rounded-lg" loading="lazy" width="800" height="600">'
      const result = wwwaxe(html, { markdown: false })
      expect(result).toContain('src="/photo.jpg"')
      expect(result).toContain('alt="A photo"')
      expect(result).not.toContain('class')
      expect(result).not.toContain('loading')
    })

    it('keeps form-relevant attributes', () => {
      const html =
        '<input type="email" name="email" placeholder="Enter email" class="input-field" data-validate="true">'
      const result = wwwaxe(html)
      expect(result).toContain('type="email"')
      expect(result).toContain('name="email"')
      expect(result).toContain('placeholder="Enter email"')
      expect(result).not.toContain('class')
      expect(result).not.toContain('data-')
    })

    it('keeps role and aria-label', () => {
      const html =
        '<div role="navigation" aria-label="Main menu" class="nav-wrapper"><a href="/">Home</a></div>'
      const result = wwwaxe(html)
      expect(result).toContain('role="navigation"')
      expect(result).toContain('aria-label="Main menu"')
    })
  })

  describe('hidden element removal', () => {
    it('removes elements with hidden attribute', () => {
      const html = '<div><p>Visible</p><p hidden>Hidden</p></div>'
      const result = wwwaxe(html)
      expect(result).toContain('Visible')
      expect(result).not.toContain('Hidden')
    })

    it('removes aria-hidden elements by default', () => {
      const html = '<div><p>Visible</p><span aria-hidden="true">Icon</span></div>'
      const result = wwwaxe(html)
      expect(result).not.toContain('Icon')
    })

    it('removes display:none elements', () => {
      const html = '<div><p>Visible</p><p style="display:none">Hidden</p></div>'
      const result = wwwaxe(html)
      expect(result).toContain('Visible')
      expect(result).not.toContain('Hidden')
    })
  })

  describe('structural preservation', () => {
    it('preserves semantic structure', () => {
      const html = `
        <html>
        <body>
          <header><nav><a href="/">Home</a></nav></header>
          <main>
            <article>
              <h1>Title</h1>
              <p>Content</p>
            </article>
          </main>
          <footer><p>Footer</p></footer>
        </body>
        </html>
      `
      const result = wwwaxe(html, { markdown: false })
      expect(result).toContain('<header>')
      expect(result).toContain('<nav>')
      expect(result).toContain('<main>')
      expect(result).toContain('<article>')
      expect(result).toContain('<h1>')
      expect(result).toContain('<footer>')
    })

    it('preserves table structure', () => {
      const html = `
        <table class="data-table striped">
          <thead><tr><th>Name</th><th>Age</th></tr></thead>
          <tbody><tr><td>Alice</td><td>30</td></tr></tbody>
        </table>
      `
      const result = wwwaxe(html)
      expect(result).toContain('<table>')
      expect(result).toContain('<thead>')
      expect(result).toContain('<th>Name</th>')
      expect(result).toContain('<td>Alice</td>')
      expect(result).not.toContain('class')
    })

    it('preserves list structure', () => {
      const html = '<ul class="menu"><li class="item">One</li><li class="item">Two</li></ul>'
      const result = wwwaxe(html, { markdown: false })
      expect(result).toContain('<ul>')
      expect(result).toContain('<li>One</li>')
      expect(result).not.toContain('class')
    })
  })

  describe('presentational tag unwrapping', () => {
    it('unwraps span tags', () => {
      const html = '<p><span class="highlight">Important</span> text</p>'
      const result = wwwaxe(html)
      expect(result).not.toContain('span')
      expect(result).toContain('Important')
      expect(result).toContain('text')
    })

    it('unwraps nested presentational divs', () => {
      const html = '<main><div class="wrapper"><div class="inner"><p>Content</p></div></div></main>'
      const result = wwwaxe(html)
      expect(result).toContain('<main>')
      expect(result).toContain('<p>Content</p>')
      // divs should be unwrapped
      expect(result).not.toContain('<div')
    })
  })

  describe('meta information / frontmatter', () => {
    it('extracts title to YAML frontmatter', () => {
      const html = '<html><head><title>My Page</title></head><body><p>Hi</p></body></html>'
      const result = wwwaxe(html)
      expect(result).toContain('---')
      expect(result).toContain('title: My Page')
      expect(result).not.toContain('<title>')
      expect(result).not.toContain('<head>')
      expect(result).toContain('<p>Hi</p>')
    })

    it('extracts description to frontmatter', () => {
      const html =
        '<html><head><meta name="description" content="A great page"></head><body><p>Hi</p></body></html>'
      const result = wwwaxe(html)
      expect(result).toContain('description: A great page')
    })

    it('extracts og:image to frontmatter', () => {
      const html =
        '<html><head><meta property="og:image" content="https://example.com/img.png"><meta property="og:title" content="My Title"></head><body><p>Hi</p></body></html>'
      const result = wwwaxe(html)
      expect(result).toContain('image: https://example.com/img.png')
      // og:title is not extracted (we use <title> tag for title)
      expect(result).not.toContain('og:title')
    })

    it('extracts canonical URL to frontmatter', () => {
      const html =
        '<html><head><link rel="canonical" href="https://example.com/page"></head><body><p>Hi</p></body></html>'
      const result = wwwaxe(html)
      expect(result).toContain('url: https://example.com/page')
    })

    it('extracts og:url when no canonical link', () => {
      const html =
        '<html><head><meta property="og:url" content="https://example.com/page"></head><body><p>Hi</p></body></html>'
      const result = wwwaxe(html)
      expect(result).toContain('url: https://example.com/page')
    })

    it('canonical URL takes priority over og:url', () => {
      const html =
        '<html><head><link rel="canonical" href="https://example.com/canonical"><meta property="og:url" content="https://example.com/og"></head><body><p>Hi</p></body></html>'
      const result = wwwaxe(html)
      expect(result).toContain('url: https://example.com/canonical')
      expect(result).not.toContain('og')
    })

    it('removes non-useful meta tags', () => {
      const html =
        '<html><head><meta name="generator" content="WordPress"><meta name="description" content="Good"></head><body><p>Hi</p></body></html>'
      const result = wwwaxe(html)
      expect(result).not.toContain('generator')
      expect(result).toContain('description')
    })

    it('produces no frontmatter when head has no extractable data', () => {
      const html = '<html><head><meta charset="utf-8"></head><body><p>Hi</p></body></html>'
      const result = wwwaxe(html)
      expect(result).not.toContain('---')
      expect(result).toContain('<p>Hi</p>')
    })

    it('removes html/head/body wrappers from output', () => {
      const html = '<html><head><title>Test</title></head><body><p>Content</p></body></html>'
      const result = wwwaxe(html)
      expect(result).not.toContain('<html')
      expect(result).not.toContain('<head')
      expect(result).not.toContain('<body')
      expect(result).not.toContain('</html>')
      expect(result).not.toContain('</head>')
      expect(result).not.toContain('</body>')
    })

    it('YAML-escapes values with colons', () => {
      const html =
        '<html><head><title>Part 1: The Beginning</title></head><body><p>Hi</p></body></html>'
      const result = wwwaxe(html)
      expect(result).toContain('title: "Part 1: The Beginning"')
    })
  })

  describe('empty element removal', () => {
    it('removes empty paragraphs', () => {
      const html = '<div><p></p><p>Content</p><p>   </p></div>'
      const result = wwwaxe(html)
      expect(result).toContain('<p>Content</p>')
      // Empty p tags should be removed
      const pCount = (result.match(/<p>/g) || []).length
      expect(pCount).toBe(1)
    })

    it('keeps img even without children', () => {
      const html = '<p><img src="/photo.jpg" alt="Photo"></p>'
      const result = wwwaxe(html, { markdown: false })
      expect(result).toContain('<img')
    })
  })

  describe('whitespace handling', () => {
    it('collapses excessive whitespace', () => {
      const html = '<p>Hello     world\n\n\n\nfoo</p>'
      const result = wwwaxe(html)
      expect(result).not.toContain('     ')
      expect(result).toContain('Hello')
      expect(result).toContain('world')
    })
  })

  describe('options', () => {
    it('keepIds preserves id attributes', () => {
      const html = '<div id="main"><p>Hello</p></div>'
      const result = wwwaxe(html, { keepIds: true })
      expect(result).toContain('id="main"')
    })

    it('keepClasses preserves class attributes', () => {
      const html = '<p class="important">Hello</p>'
      const result = wwwaxe(html, { keepClasses: true })
      expect(result).toContain('class="important"')
    })

    it('keepDataAttributes preserves data-* attributes', () => {
      const html = '<div data-section="hero"><p>Hello</p></div>'
      const result = wwwaxe(html, { keepDataAttributes: true })
      expect(result).toContain('data-section="hero"')
    })

    it('keepAriaHidden preserves aria-hidden elements', () => {
      const html = '<div><p>Visible</p><span aria-hidden="true">Icon text</span></div>'
      const result = wwwaxe(html, { keepAriaHidden: true })
      expect(result).toContain('Icon text')
    })
  })

  describe('core mode', () => {
    it('strips header elements', () => {
      const html = '<header><nav><a href="/">Home</a></nav></header><main><p>Content</p></main>'
      const result = wwwaxe(html, { core: true })
      expect(result).not.toContain('<header')
      expect(result).not.toContain('<nav')
      expect(result).toContain('Content')
    })

    it('strips footer elements', () => {
      const html = '<main><p>Content</p></main><footer><p>Copyright</p></footer>'
      const result = wwwaxe(html, { core: true })
      expect(result).not.toContain('<footer')
      expect(result).not.toContain('Copyright')
      expect(result).toContain('Content')
    })

    it('strips aside elements', () => {
      const html = '<main><p>Content</p></main><aside><p>Sidebar</p></aside>'
      const result = wwwaxe(html, { core: true })
      expect(result).not.toContain('<aside')
      expect(result).not.toContain('Sidebar')
      expect(result).toContain('Content')
    })

    it('strips dialog elements', () => {
      const html = '<main><p>Content</p></main><dialog><p>Modal</p></dialog>'
      const result = wwwaxe(html, { core: true })
      expect(result).not.toContain('<dialog')
      expect(result).not.toContain('Modal')
      expect(result).toContain('Content')
    })

    it('strips elements with chrome roles', () => {
      const html =
        '<div role="banner"><p>Banner</p></div><div role="navigation"><a href="/">Nav</a></div><main><p>Content</p></main><div role="contentinfo"><p>Footer</p></div>'
      const result = wwwaxe(html, { core: true })
      expect(result).not.toContain('Banner')
      expect(result).not.toContain('role="navigation"')
      expect(result).not.toContain('Footer')
      expect(result).toContain('Content')
    })

    it('strips role="search" elements', () => {
      const html = '<div role="search"><input type="text"></div><main><p>Content</p></main>'
      const result = wwwaxe(html, { core: true })
      expect(result).not.toContain('role="search"')
      expect(result).toContain('Content')
    })

    it('strips role="complementary" elements', () => {
      const html = '<main><p>Content</p></main><div role="complementary"><p>Related</p></div>'
      const result = wwwaxe(html, { core: true })
      expect(result).not.toContain('Related')
      expect(result).toContain('Content')
    })

    it('preserves main content when chrome is stripped', () => {
      const html = `
        <header><nav><a href="/">Home</a></nav></header>
        <main>
          <article>
            <h1>Article Title</h1>
            <p>Article content here.</p>
          </article>
        </main>
        <aside><p>Sidebar</p></aside>
        <footer><p>Copyright</p></footer>
      `
      const result = wwwaxe(html, { core: true })
      expect(result).toContain('Article Title')
      expect(result).toContain('Article content here')
      expect(result).not.toContain('<header')
      expect(result).not.toContain('<nav')
      expect(result).not.toContain('<aside')
      expect(result).not.toContain('<footer')
      expect(result).not.toContain('Sidebar')
      expect(result).not.toContain('Copyright')
    })

    it('does not strip chrome when core is false', () => {
      const html =
        '<header><nav><a href="/">Home</a></nav></header><main><p>Content</p></main><footer><p>Footer</p></footer>'
      const result = wwwaxe(html, { core: false, markdown: false })
      expect(result).toContain('<header>')
      expect(result).toContain('<nav>')
      expect(result).toContain('<footer>')
    })

    it('strips nested nav inside non-chrome elements', () => {
      const html = '<main><p>Content</p><nav><a href="/other">Other</a></nav></main>'
      const result = wwwaxe(html, { core: true })
      expect(result).not.toContain('<nav')
      expect(result).toContain('Content')
    })
  })

  describe('markdown rewrites', () => {
    it('converts strong to **text**', () => {
      const result = wwwaxe('<p>some <strong>bold</strong> text</p>')
      expect(result).toContain('**bold**')
      expect(result).not.toContain('<strong>')
    })

    it('converts b to **text**', () => {
      const result = wwwaxe('<p>some <b>bold</b> text</p>')
      expect(result).toContain('**bold**')
      expect(result).not.toContain('<b>')
    })

    it('converts em to *text*', () => {
      const result = wwwaxe('<p>some <em>italic</em> text</p>')
      expect(result).toContain('*italic*')
      expect(result).not.toContain('<em>')
    })

    it('converts i to *text*', () => {
      const result = wwwaxe('<p>some <i>italic</i> text</p>')
      expect(result).toContain('*italic*')
      expect(result).not.toContain('<i>')
    })

    it('converts a to [text](href)', () => {
      const result = wwwaxe('<a href="/about">About</a>')
      expect(result).toBe('[About](/about)')
    })

    it('converts img to ![alt](src)', () => {
      const result = wwwaxe('<img src="/photo.jpg" alt="A photo">')
      expect(result).toBe('![A photo](/photo.jpg)')
    })

    it('converts img with no alt to ![](src)', () => {
      const result = wwwaxe('<img src="/photo.jpg">')
      expect(result).toBe('![](/photo.jpg)')
    })

    it('converts ul/li to - item', () => {
      const result = wwwaxe('<ul><li>First</li><li>Second</li><li>Third</li></ul>')
      expect(result).toContain('- First')
      expect(result).toContain('- Second')
      expect(result).toContain('- Third')
    })

    it('converts ol/li to numbered items', () => {
      const result = wwwaxe('<ol><li>First</li><li>Second</li><li>Third</li></ol>')
      expect(result).toContain('1. First')
      expect(result).toContain('2. Second')
      expect(result).toContain('3. Third')
    })

    it('converts h1 to # text', () => {
      const result = wwwaxe('<h1>Title</h1>')
      expect(result).toContain('# Title')
      expect(result).not.toContain('<h1>')
    })

    it('converts h2 to ## text', () => {
      const result = wwwaxe('<h2>Subtitle</h2>')
      expect(result).toContain('## Subtitle')
    })

    it('converts h3 through h6', () => {
      expect(wwwaxe('<h3>H3</h3>')).toContain('### H3')
      expect(wwwaxe('<h4>H4</h4>')).toContain('#### H4')
      expect(wwwaxe('<h5>H5</h5>')).toContain('##### H5')
      expect(wwwaxe('<h6>H6</h6>')).toContain('###### H6')
    })

    it('converts blockquote to > text', () => {
      const result = wwwaxe('<blockquote>quoted text</blockquote>')
      expect(result).toContain('> quoted text')
      expect(result).not.toContain('<blockquote>')
    })

    it('converts inline code to backtick-wrapped text', () => {
      const result = wwwaxe('<p>use <code>npm install</code> to install</p>')
      expect(result).toContain('`npm install`')
      expect(result).not.toContain('<code>')
    })

    it('converts pre/code to fenced code block', () => {
      const result = wwwaxe('<pre><code>const x = 1;</code></pre>')
      expect(result).toContain('```')
      expect(result).toContain('const x = 1;')
      expect(result).not.toContain('<pre>')
    })

    it('converts pre without code to fenced code block', () => {
      const result = wwwaxe('<pre>plain preformatted</pre>')
      expect(result).toContain('```')
      expect(result).toContain('plain preformatted')
    })

    it('converts hr to ---', () => {
      const result = wwwaxe('<p>above</p><hr><p>below</p>')
      expect(result).toContain('---')
      expect(result).not.toContain('<hr')
    })

    it('converts br to newline', () => {
      const result = wwwaxe('<p>Line1<br>Line2</p>')
      expect(result).toContain('Line1\nLine2')
      expect(result).not.toContain('<br')
    })

    it('converts del to ~~text~~', () => {
      const result = wwwaxe('<p>some <del>deleted</del> text</p>')
      expect(result).toContain('~~deleted~~')
    })

    it('converts s to ~~text~~', () => {
      const result = wwwaxe('<p>some <s>struck</s> text</p>')
      expect(result).toContain('~~struck~~')
    })

    it('converts strike to ~~text~~', () => {
      const result = wwwaxe('<p>some <strike>struck</strike> text</p>')
      expect(result).toContain('~~struck~~')
    })

    it('handles nested rewrites (bold link)', () => {
      const result = wwwaxe('<p><strong><a href="/x">bold link</a></strong></p>')
      expect(result).toContain('**[bold link](/x)**')
    })

    it('handles nested rewrites (italic in bold)', () => {
      const result = wwwaxe('<p><strong>bold and <em>italic</em></strong></p>')
      expect(result).toContain('**bold and *italic***')
    })

    it('markdown: false preserves HTML tags', () => {
      const result = wwwaxe('<p>some <strong>bold</strong> text</p>', { markdown: false })
      expect(result).not.toContain('**')
      // strong gets unwrapped in non-markdown mode
      expect(result).toContain('bold')
      expect(result).toContain('<p>')
    })

    it('markdown: false preserves link HTML', () => {
      const result = wwwaxe('<a href="/about">About</a>', { markdown: false })
      expect(result).toContain('href="/about"')
      expect(result).toContain('<a')
    })

    it('markdown: false preserves img HTML', () => {
      const result = wwwaxe('<img src="/photo.jpg" alt="Photo">', { markdown: false })
      expect(result).toContain('<img')
      expect(result).toContain('src="/photo.jpg"')
    })

    it('markdown: false preserves heading HTML', () => {
      const result = wwwaxe('<h1>Title</h1>', { markdown: false })
      expect(result).toContain('<h1>')
      expect(result).not.toContain('#')
    })

    it('markdown: false preserves list HTML', () => {
      const result = wwwaxe('<ul><li>One</li><li>Two</li></ul>', { markdown: false })
      expect(result).toContain('<ul>')
      expect(result).toContain('<li>')
    })
  })

  describe('real-world patterns', () => {
    it('handles a typical blog page', () => {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My Blog Post</title>
  <meta name="description" content="A great article about coding">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="Next.js">
  <link rel="stylesheet" href="/styles.css">
  <link rel="canonical" href="https://example.com/blog/post">
  <script src="/analytics.js"></script>
  <style>.hero { background: linear-gradient(blue, purple); }</style>
</head>
<body class="dark-theme antialiased" data-page="blog" onclick="trackPageView()">
  <div id="__next">
    <nav id="main-nav" class="sticky top-0 z-50 bg-white shadow-md px-4 py-2 flex items-center justify-between">
      <a href="/" class="logo text-xl font-bold text-gray-900">My Site</a>
      <div class="flex gap-4">
        <a href="/about" class="text-gray-600 hover:text-black transition-colors">About</a>
        <a href="/blog" class="text-gray-600 hover:text-black transition-colors">Blog</a>
        <a href="/contact" class="text-gray-600 hover:text-black transition-colors">Contact</a>
      </div>
    </nav>
    <main class="container mx-auto px-4 py-8 max-w-3xl">
      <article class="prose prose-lg prose-gray">
        <h1 class="text-4xl font-extrabold tracking-tight mb-4">Hello World</h1>
        <p class="text-gray-500 text-sm mb-8">Published on <time datetime="2024-01-15">January 15, 2024</time></p>
        <p class="text-gray-700 leading-relaxed">This is my <a href="/post" class="text-blue-500 underline hover:text-blue-700">blog post</a> about interesting things.</p>
        <img src="/photo.jpg" alt="A beautiful photo" class="rounded-lg shadow-xl my-8" loading="lazy" width="800" height="600" decoding="async">
        <h2 class="text-2xl font-bold mt-8 mb-4">Section Two</h2>
        <p class="text-gray-700 leading-relaxed">More content here with <strong>bold text</strong> and a list:</p>
        <ul class="list-disc pl-6 space-y-2">
          <li class="text-gray-700">First item</li>
          <li class="text-gray-700">Second item</li>
          <li class="text-gray-700">Third item</li>
        </ul>
      </article>
    </main>
    <footer class="bg-gray-100 py-8 mt-16">
      <div class="container mx-auto px-4 text-center text-gray-500 text-sm">
        <p>&copy; 2024 My Site. All rights reserved.</p>
      </div>
    </footer>
  </div>
  <script>
    window.__NEXT_DATA__ = {"props":{"pageProps":{}}};
    (function() { /* analytics */ })();
  </script>
  <noscript><img src="/pixel.gif" alt=""></noscript>
</body>
</html>`

      const result = wwwaxe(html)

      // Should have frontmatter
      expect(result).toMatch(/^---\n/)
      expect(result).toContain('title: My Blog Post')
      expect(result).toContain('description: A great article about coding')
      expect(result).toContain('url: https://example.com/blog/post')

      // Should NOT have html/head/body wrappers
      expect(result).not.toContain('<html')
      expect(result).not.toContain('<head')
      expect(result).not.toContain('<body')

      // Should keep structure (some tags preserved, some converted to markdown)
      expect(result).toContain('<nav')
      expect(result).toContain('<main>')
      expect(result).toContain('<article>')
      expect(result).toContain('<footer>')

      // Should keep content (with markdown formatting)
      expect(result).toContain('Hello World')
      expect(result).toContain('blog post')
      expect(result).toContain('Section Two')
      expect(result).toContain('First item')

      // Links should be markdown format
      expect(result).toContain('[About](/about)')
      expect(result).toContain('[blog post](/post)')

      // Images should be markdown format
      expect(result).toContain('![A beautiful photo](/photo.jpg)')

      // Should strip
      expect(result).not.toContain('<script')
      expect(result).not.toContain('style=')
      expect(result).not.toContain('class=')
      expect(result).not.toContain('analytics')
      expect(result).not.toContain('__NEXT_DATA__')
      expect(result).not.toContain('noscript')
      expect(result).not.toContain('onclick')
      expect(result).not.toContain('data-page')
      expect(result).not.toContain('generator')

      // Should be significantly smaller (markdown is even more compact)
      expect(result.length).toBeLessThan(html.length * 0.5)

      console.log('Input size:', html.length, 'bytes')
      console.log('Output size:', result.length, 'bytes')
      console.log('Reduction:', Math.round((1 - result.length / html.length) * 100) + '%')
    })

    it('handles a typical blog page with core mode', () => {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>My Blog Post</title>
  <meta name="description" content="A great article about coding">
  <link rel="canonical" href="https://example.com/blog/post">
</head>
<body>
  <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
  <main>
    <article>
      <h1>Hello World</h1>
      <p>This is my blog post.</p>
    </article>
  </main>
  <aside><p>Sidebar content</p></aside>
  <footer><p>Copyright 2024</p></footer>
</body>
</html>`

      const result = wwwaxe(html, { core: true })

      // Should have frontmatter
      expect(result).toContain('title: My Blog Post')

      // Should strip chrome
      expect(result).not.toContain('<header')
      expect(result).not.toContain('<nav')
      expect(result).not.toContain('<aside')
      expect(result).not.toContain('<footer')
      expect(result).not.toContain('Sidebar')
      expect(result).not.toContain('Copyright')

      // Should keep main content
      expect(result).toContain('Hello World')
      expect(result).toContain('blog post')
    })
  })

  describe('data URI stripping', () => {
    const bigDataUri = 'data:image/png;base64,' + 'A'.repeat(100000)
    const smallDataUri = 'data:image/svg+xml;base64,PHN2Zz4='

    it('strips data URI from img src in structural mode', () => {
      const html = '<html><body><img src="' + bigDataUri + '" alt="photo"></body></html>'
      const result = wwwaxe(html, { markdown: false })
      expect(result).not.toContain('data:image')
      expect(result).not.toContain('AAAA')
      // The img tag should be gone or have no src
      expect(result.length).toBeLessThan(500)
    })

    it('strips data URI from img src in markdown mode', () => {
      const html = '<html><body><img src="' + bigDataUri + '" alt="A cat"></body></html>'
      const result = wwwaxe(html)
      expect(result).not.toContain('data:image')
      expect(result).not.toContain('AAAA')
      // Should preserve alt text as fallback
      expect(result).toContain('A cat')
      expect(result.length).toBeLessThan(500)
    })

    it('strips small data URIs too (SVG placeholders)', () => {
      const html = '<html><body><img src="' + smallDataUri + '" alt="icon"></body></html>'
      const result = wwwaxe(html)
      expect(result).not.toContain('data:image')
      expect(result).toContain('icon')
    })

    it('preserves normal image URLs', () => {
      const html = '<html><body><img src="https://example.com/photo.jpg" alt="photo"></body></html>'
      const result = wwwaxe(html)
      expect(result).toContain('https://example.com/photo.jpg')
      expect(result).toContain('photo')
    })

    it('removes img with data URI and no alt text in markdown mode', () => {
      const html = '<html><body><p>Text</p><img src="' + bigDataUri + '"><p>More</p></body></html>'
      const result = wwwaxe(html)
      expect(result).not.toContain('data:image')
      expect(result).toContain('Text')
      expect(result).toContain('More')
    })

    it('strips data URIs from srcset', () => {
      const html =
        '<html><body><img srcset="' +
        smallDataUri +
        ' 1x, https://example.com/photo.jpg 2x" alt="photo"></body></html>'
      const result = wwwaxe(html, { markdown: false })
      expect(result).not.toContain('data:image')
      expect(result).toContain('https://example.com/photo.jpg')
    })

    it('strips data URIs from poster attribute', () => {
      const html =
        '<html><body><video poster="' +
        bigDataUri +
        '"><source src="video.mp4"></video></body></html>'
      const result = wwwaxe(html, { markdown: false })
      expect(result).not.toContain('data:image')
      expect(result).not.toContain('AAAA')
    })

    it('strips data URI from og:image in frontmatter', () => {
      const html =
        '<html><head><meta property="og:image" content="' +
        bigDataUri +
        '"><title>Test</title></head><body><p>Content</p></body></html>'
      const result = wwwaxe(html)
      expect(result).not.toContain('data:image')
      expect(result).toContain('title: Test')
      // Should NOT have image in frontmatter
      expect(result).not.toContain('image:')
    })

    it('preserves normal og:image URL in frontmatter', () => {
      const html =
        '<html><head><meta property="og:image" content="https://example.com/og.jpg"><title>Test</title></head><body><p>Content</p></body></html>'
      const result = wwwaxe(html)
      expect(result).toContain('image: https://example.com/og.jpg')
    })

    it('handles multiple images mixing data URIs and real URLs', () => {
      const html =
        '<html><body>' +
        '<img src="' +
        bigDataUri +
        '" alt="placeholder">' +
        '<img src="https://example.com/real.jpg" alt="real">' +
        '<img src="' +
        smallDataUri +
        '" alt="icon">' +
        '</body></html>'
      const result = wwwaxe(html)
      expect(result).not.toContain('data:image')
      expect(result).toContain('https://example.com/real.jpg')
      expect(result).toContain('placeholder')
      expect(result).toContain('real')
      expect(result).toContain('icon')
    })

    it('handles data URI with whitespace prefix', () => {
      const html = '<html><body><img src="  data:image/png;base64,AAAA" alt="test"></body></html>'
      const result = wwwaxe(html)
      expect(result).not.toContain('data:image')
      expect(result).toContain('test')
    })

    it('dramatically reduces output size when data URIs are present', () => {
      // Simulate a Google-like page with many inline base64 images
      const images = Array.from(
        { length: 10 },
        (_, i) => '<img src="data:image/png;base64,' + 'B'.repeat(50000) + '" alt="img' + i + '">',
      ).join('')
      const html =
        '<html><body><main><h1>Search Results</h1>' + images + '<p>Footer</p></main></body></html>'

      const inputSize = html.length
      const result = wwwaxe(html)
      const outputSize = result.length

      // Input is ~500KB, output should be tiny
      expect(inputSize).toBeGreaterThan(400000)
      expect(outputSize).toBeLessThan(1000)
      expect(result).toContain('Search Results')
      expect(result).not.toContain('BBBB')
    })
  })
})
