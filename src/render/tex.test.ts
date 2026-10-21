import { describe, expect, it } from 'vitest'
import { mathjax } from '@mathjax/src/js/mathjax.js'
import { texToSvg } from './mathjax'
import { hasTex, loadTex, splitTex, texHtml } from './tex'

describe('tex', () => {
  it('splits text and formulas', () => {
    expect(splitTex('rise $t_r$ = 5 ns')).toEqual([{ text: 'rise ' }, { tex: 't_r', display: false }, { text: ' = 5 ns' }])
    expect(splitTex('$$\\frac{1}{2}$$')).toEqual([{ tex: '\\frac{1}{2}', display: true }])
    expect(splitTex('$a$$b$')).toEqual([{ tex: 'a', display: false }, { tex: 'b', display: false }])
  })

  it('keeps plain dollars as text', () => {
    expect(splitTex('costs $5')).toEqual([{ text: 'costs $5' }])
    expect(splitTex('\\$5 and \\$6')).toEqual([{ text: '$5 and $6' }])
    expect(splitTex('empty $$ and $ $')).toEqual([{ text: 'empty $$ and $ $' }])
    expect(splitTex('no math')).toEqual([{ text: 'no math' }])
    expect(hasTex('price: $5\nline two')).toBe(false)
    expect(hasTex('note\n$\\Delta t$')).toBe(true)
  })

  it('does not close a formula at an escaped dollar', () => {
    expect(splitTex('$x = \\$5$ ok')).toEqual([{ tex: 'x = \\$5', display: false }, { text: ' ok' }])
  })

  it('renders TeX to self-contained SVG paths', async () => {
    const f = await texToSvg('\\frac{a}{b}', false)
    expect(f.body).toContain('<path')
    expect(f.body).not.toContain('<use')
    expect(f.width).toBeGreaterThan(0.3)
    expect(f.ascent).toBeGreaterThan(0.6)
    expect(f.descent).toBeGreaterThan(0.2)
    const x = await texToSvg('x', false)
    expect(x.ascent).toBeLessThan(0.6)
    expect((await texToSvg('\\frac{a}{b}', true)).ascent).toBeGreaterThan(f.ascent)
  })

  it('keeps an inline formula in one piece', async () => {
    // Split at "=", the first piece would be "V(t)", about 1.7 em wide
    const f = await texToSvg('V(t) = V_0\\,e^{-t/\\tau}', false)
    expect(f.width).toBeGreaterThan(5)
  })

  it('loads glyph ranges on demand', async () => {
    const loaded: string[] = []
    const load = mathjax.asyncLoad!
    mathjax.asyncLoad = (name: string) => (loaded.push(name), load(name))
    try {
      const f = await texToSvg('A \\twoheadrightarrow B \\mathfrak{g}', false)
      expect(f.body).toContain('<path')
    } finally {
      mathjax.asyncLoad = load
    }
    expect(loaded.length).toBeGreaterThan(0)
  })

  it('renders formulas into report HTML', async () => {
    await loadTex(['$x^2$ & \\$5'])
    const html = texHtml('$x^2$ & \\$5\n<b>')
    expect(html).toMatch(/^<svg [^>]*viewBox="[^"]+"[^>]*>.*<path/)
    expect(html).toContain(' &amp; $5<br>&lt;b&gt;')
    expect(texHtml('$\\nosuchmacro$')).toBe('$\\nosuchmacro$')
  })

  it('reports TeX errors', async () => {
    await expect(texToSvg('\\frac{a}', false)).rejects.toThrow()
    await expect(texToSvg('\\nosuchmacro', false)).rejects.toThrow()
  })
})
