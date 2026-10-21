/**
 * Colour helpers for the light (print) theme: WCAG contrast and darkening of trace colours
 * that are too pale on white, such as the yellow of CH1.
 */

/** sRGB channels 0…255 */
export type Rgb = [number, number, number]

/** Minimum contrast of traces against white in light exports (WCAG 2.1 non-text contrast) */
export const PRINT_CONTRAST = 3

/** Parses #rgb, #rrggbb and rgb()/rgba() (alpha is ignored); undefined for anything else */
export function parseColor(s: string): Rgb | undefined {
  const t = s.trim().toLowerCase()
  let m = /^#([0-9a-f]{3})$/.exec(t)
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16)) as Rgb
  m = /^#([0-9a-f]{6})$/.exec(t)
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as Rgb
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(t)
  if (m) return [m[1], m[2], m[3]].map((v) => Math.min(255, Number(v))) as Rgb
  return undefined
}

export function toHex(c: Rgb): string {
  return '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
}

const toLinear = (v: number) => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
const fromLinear = (l: number) => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)

/** WCAG relative luminance, 0 (black) … 1 (white) */
export function relativeLuminance(c: Rgb): number {
  return 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2])
}

/** WCAG contrast ratio of two colours, 1 … 21 */
export function contrastRatio(a: string, b: string): number {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return 1
  const la = relativeLuminance(ca)
  const lb = relativeLuminance(cb)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * The colour dimmed just enough to reach `min` contrast against white. All channels are scaled
 * by the same factor in linear light, so hue and saturation stay as they are and the trace keeps
 * its identity (yellow becomes a dark gold). Colours that already have the contrast, and
 * colours that cannot be parsed, are returned unchanged.
 */
export function printColor(color: string, min = PRINT_CONTRAST): string {
  const c = parseColor(color)
  if (!c) return color
  const lum = relativeLuminance(c)
  const target = 1.05 / min - 0.05
  if (lum <= target) return color
  // Rounding to 8 bit may land just above the target: then dim a little more
  for (let k = target / lum; ; k *= 0.995) {
    const out = c.map((v) => Math.round(fromLinear(toLinear(v) * k))) as Rgb
    if (relativeLuminance(out) <= target) return toHex(out)
  }
}

/** Black or white, whichever reads better on the given fill */
export function textOn(fill: string): string {
  return contrastRatio(fill, '#000') >= contrastRatio(fill, '#fff') ? '#000' : '#fff'
}
