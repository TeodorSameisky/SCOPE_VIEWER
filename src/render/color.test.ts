import { describe, expect, it } from 'vitest'
import { CALLOUT_COLORS } from '../model/callouts'
import { MATH_COLORS } from '../model/math'
import { CHANNEL_COLORS } from '../parsers/session'
import { PRINT_CONTRAST, contrastRatio, parseColor, printColor, relativeLuminance, textOn } from './color'
import { DARK_THEME, LIGHT_THEME } from './theme'

/** Hue in degrees and HSV saturation of a colour */
function hueSat(color: string): [number, number] {
  const [r, g, b] = parseColor(color)!.map((v) => v / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return [0, 0]
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, d / max]
}

const palette = [...CHANNEL_COLORS, ...MATH_COLORS, ...CALLOUT_COLORS]

describe('color', () => {
  it('parses hex and rgb() colours', () => {
    expect(parseColor('#f2e32c')).toEqual([242, 227, 44])
    expect(parseColor('#FFF')).toEqual([255, 255, 255])
    expect(parseColor('rgba(255, 157, 46, 0.35)')).toEqual([255, 157, 46])
    expect(parseColor('tomato')).toBeUndefined()
  })

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#22c8e6', '#22c8e6')).toBe(1)
    // WCAG example: #777 on white is just below 4.5
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })

  it('darkens pale trace colours to readable contrast on white', () => {
    // The yellow of CH1 and the light cyan of CH2 are far too pale on paper
    expect(contrastRatio('#f2e32c', '#fff')).toBeLessThan(1.5)
    expect(contrastRatio('#22c8e6', '#fff')).toBeLessThan(2.2)
    for (const c of palette) {
      const p = printColor(c)
      expect(contrastRatio(p, '#fff'), `${c} → ${p}`).toBeGreaterThanOrEqual(PRINT_CONTRAST)
    }
  })

  it('darkens no more than needed', () => {
    for (const c of palette) {
      const p = printColor(c)
      if (p !== c) expect(contrastRatio(p, '#fff'), `${c} → ${p}`).toBeLessThan(PRINT_CONTRAST + 0.15)
    }
    expect(contrastRatio(printColor('#f2e32c', 4.5), '#fff')).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps hue and saturation, so traces keep their identity', () => {
    for (const c of palette) {
      const [h0, s0] = hueSat(c)
      const [h1, s1] = hueSat(printColor(c))
      const dh = Math.abs(((h1 - h0 + 540) % 360) - 180)
      expect(dh, c).toBeLessThan(4)
      expect(Math.abs(s1 - s0), c).toBeLessThan(0.08)
    }
  })

  it('leaves colours with enough contrast and unknown colours unchanged', () => {
    expect(printColor('#4a63ff')).toBe('#4a63ff')
    expect(printColor('#1d2430')).toBe('#1d2430')
    expect(printColor('tomato')).toBe('tomato')
    expect(relativeLuminance(parseColor(printColor('#ffffff'))!)).toBeGreaterThan(0)
  })

  it('picks black or white text for a fill', () => {
    expect(textOn('#f2e32c')).toBe('#000')
    expect(textOn('#1d2430')).toBe('#fff')
    for (const c of palette) expect(contrastRatio(textOn(printColor(c)), printColor(c))).toBeGreaterThanOrEqual(4.5)
  })

  it('maps colours only in the light theme', () => {
    expect(DARK_THEME.ink('#f2e32c')).toBe('#f2e32c')
    expect(DARK_THEME.onInk('#4a63ff')).toBe('#000')
    expect(LIGHT_THEME.ink('#f2e32c')).toBe(printColor('#f2e32c'))
    for (const k of ['axisText', 'cursor', 'trigger', 'text', 'muted', 'noteText'] as const) {
      expect(contrastRatio(LIGHT_THEME[k], LIGHT_THEME.bg), k).toBeGreaterThanOrEqual(PRINT_CONTRAST)
    }
  })
})
