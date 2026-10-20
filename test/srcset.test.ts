import { describe, expect, it } from 'vitest'
import { wwwaxe } from '../src/index.ts'

const dataUri = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

/** The srcset the converter leaves on the only <img> of a page, or undefined when it drops it. */
function srcsetOf(srcset: string): string | undefined {
  const html = `<html><body><p>Text</p><img srcset="${srcset}" alt="photo"></body></html>`
  return /<img[^>]* srcset="([^"]*)"/.exec(wwwaxe(html, { markdown: false }))?.[1]
}

describe('srcset', () => {
  describe('without a data: URI the attribute is left byte for byte', () => {
    const untouched = [
      'https://cdn.example.com/media/photo.jpg/v1/fill/w_500,h_272,al_c,q_80/photo.jpg 500w',
      'https://cdn.example.com/w_500,h_272,al_c/a.jpg 500w, https://cdn.example.com/w_1000,h_544,al_c/a.jpg 1000w',
      '/a.jpg 1x, /b.jpg 2x',
      '/a.jpg 1x,/b.jpg 2x',
      '/a.jpg,/b.jpg',
      '  /a.jpg   1x ,   /b.jpg   2x  ',
      '/only.jpg',
      '/a.jpg 500w,\n/b.jpg 1000w',
      '/a.jpg 1x , /b.jpg 2x , ',
    ]
    for (const value of untouched) {
      it(JSON.stringify(value), () => {
        expect(srcsetOf(value)).toBe(value)
      })
    }
  })

  it('does not rewrite the commas inside a CDN URL', () => {
    const value =
      'https://static.example.com/media/a~mv2.jpg/v1/fill/w_500,h_272,al_c,q_80/a.jpg 500w'
    expect(srcsetOf(value)).toBe(value)
    expect(srcsetOf(value)).not.toContain(', h_272')
  })

  describe('removes data: candidates', () => {
    it('keeps an https candidate that follows a data: one, with its descriptor', () => {
      expect(srcsetOf(`${dataUri} 1x, https://example.com/photo.jpg 2x`)).toBe(
        'https://example.com/photo.jpg 2x',
      )
    })

    it('keeps an https candidate that precedes a data: one', () => {
      expect(srcsetOf(`https://example.com/photo.jpg 1x, ${dataUri} 2x`)).toBe(
        'https://example.com/photo.jpg 1x',
      )
    })

    it('keeps a comma-containing CDN URL next to a data: candidate', () => {
      const cdn = 'https://cdn.example.com/w_500,h_272,al_c,q_80/a.jpg'
      expect(srcsetOf(`${dataUri} 500w, ${cdn} 1000w`)).toBe(`${cdn} 1000w`)
      expect(srcsetOf(`${cdn} 500w, ${dataUri} 1000w`)).toBe(`${cdn} 500w`)
    })

    it('removes the data: candidates between two https ones and joins the rest with ", "', () => {
      expect(srcsetOf(`/a.jpg 1x,${dataUri} 1.5x,/b.jpg 2x`)).toBe('/a.jpg 1x, /b.jpg 2x')
    })

    it('handles width and density descriptors and candidates without a descriptor', () => {
      expect(srcsetOf(`${dataUri} 500w, /a.jpg 1000w, /b.jpg`)).toBe('/a.jpg 1000w, /b.jpg')
      expect(srcsetOf(`/a.jpg 1x, ${dataUri} 2x, /c.jpg 3x`)).toBe('/a.jpg 1x, /c.jpg 3x')
    })

    it('treats a data: URI with a comma in it as one candidate', () => {
      expect(srcsetOf(`data:text/plain,a,b,c 1x, /a.jpg 2x`)).toBe('/a.jpg 2x')
    })

    it('drops the attribute when every candidate is a data: URI', () => {
      expect(srcsetOf(`${dataUri} 1x, ${dataUri} 2x`)).toBeUndefined()
      expect(srcsetOf(dataUri)).toBeUndefined()
    })

    it('keeps candidates whose URL merely contains "data:"', () => {
      const value = 'https://example.com/redirect?to=data:image 1x'
      expect(srcsetOf(value)).toBe(value)
    })
  })

  it('also cleans srcset on <source> elements inside <picture>', () => {
    const html = `<html><body><picture><source srcset="${dataUri} 1x, https://cdn.example.com/w_1,h_2/a.webp 2x" type="image/webp"><img src="/a.jpg" alt="x"></picture></body></html>`
    const text = wwwaxe(html, { markdown: false })
    expect(text).toContain('srcset="https://cdn.example.com/w_1,h_2/a.webp 2x"')
    expect(text).not.toContain('data:')
  })
})
