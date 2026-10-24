import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MONO, SANS } from './fonts'
import { PAGE_COLORS } from './pageColors'
import { DARK_THEME, LIGHT_THEME, type Appearance, type Theme } from './theme'

// The colours and fonts exist twice: as CSS tokens for the page and in TypeScript for the
// canvases, the exports and the installed app's title bar. They must not drift apart.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const css = read('../styles.css')
const html = read('../../index.html')

/** The custom properties of the first rule with this selector */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  const block = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

const SELECTOR: Record<Appearance, string> = { dark: ':root', light: ":root[data-theme='light']" }
const THEME: Record<Appearance, Theme> = { dark: DARK_THEME, light: LIGHT_THEME }

describe('theme tokens', () => {
  for (const a of ['dark', 'light'] as const) {
    it(`match between styles.css and the ${a} canvas theme`, () => {
      const t = tokens(SELECTOR[a])
      const theme = THEME[a]
      expect(t['--bg']).toBe(PAGE_COLORS[a].background)
      expect(t['--chrome']).toBe(PAGE_COLORS[a].chrome)
      expect(t['--plot-bg']).toBe(theme.bg)
      expect(t['--overview-bg']).toBe(theme.overviewBg)
      expect(t['--border']).toBe(theme.border)
      expect(t['--text']).toBe(theme.text)
      expect(t['--text-2']).toBe(theme.textDim)
      expect(t['--muted']).toBe(theme.muted)
      expect(t['--trigger']).toBe(theme.trigger)
      expect(t['--accent']).toBe(theme.windowBox)
      expect(t['--readout-bg']).toBe(theme.readoutBg)
      expect(t['--float-border']).toBe(theme.readoutBorder)
    })
  }

  it('match the page background set in index.html before the styles load', () => {
    expect(html).toContain(`html { background: ${PAGE_COLORS.dark.background}; }`)
    expect(html).toContain(`html[data-theme='light'] { background: ${PAGE_COLORS.light.background}; }`)
    expect(html).toContain(`<meta name="theme-color" content="${PAGE_COLORS.dark.chrome}" />`)
  })

  it('use the same fonts on the canvases as on the page', () => {
    expect(tokens(':root')['--mono']).toBe(MONO)
    expect(css).toContain(`font-family: ${SANS};`)
  })
})
