/**
 * TeX math in callout text: `$…$` inline, `$$…$$` in display style, `\$` for a dollar sign.
 * MathJax (mathjax.ts) is loaded the first time a formula is needed; until a formula is
 * rendered, and when it has an error, its source is shown as text.
 */
import { useSyncExternalStore } from 'react'
import { escapeHtml } from '../util/html'

export type TextPart = { text: string } | { tex: string; display: boolean }

/** Size of formulas relative to the text, so their x-height matches system-ui text */
export const MATH_SCALE = 1.1

/** Rendered formula; sizes in em, `viewBox` in 1/1000 em with the baseline at y = 0 */
export interface TexSvg {
  viewBox: string
  /** Inner SVG markup (paths with fill="currentColor") */
  body: string
  width: number
  ascent: number
  descent: number
}

/** Splits one line of text into text and formulas; unpaired or empty delimiters stay text */
export function splitTex(line: string): TextPart[] {
  const parts: TextPart[] = []
  let text = ''
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (ch === '\\' && line[i + 1] === '$') {
      text += '$'
      i += 2
      continue
    }
    if (ch === '$') {
      const display = line[i + 1] === '$'
      const open = display ? 2 : 1
      const end = closingDelimiter(line, i + open, display)
      const tex = end < 0 ? '' : line.slice(i + open, end)
      if (tex.trim()) {
        if (text) parts.push({ text })
        text = ''
        parts.push({ tex, display })
        i = end + open
        continue
      }
      text += line.slice(i, i + open)
      i += open
      continue
    }
    text += ch
    i++
  }
  if (text) parts.push({ text })
  return parts
}

/** Index of the `$` / `$$` closing a formula that starts at `from`, skipping TeX escapes such as `\$` */
function closingDelimiter(line: string, from: number, display: boolean): number {
  for (let i = from; i < line.length; i++) {
    if (line[i] === '\\') i++
    else if (line[i] === '$' && (!display || line[i + 1] === '$')) return i
  }
  return -1
}

/** The source of a formula as written */
export function texSource(p: { tex: string; display: boolean }): string {
  const d = p.display ? '$$' : '$'
  return d + p.tex + d
}

// ---------- rendering cache ----------

type Entry = { svg: TexSvg } | { error: string } | { pending: Promise<void> }
/**
 * Rendered formulas, least recently used first. Typing a formula renders every intermediate
 * state of it, so the cache is limited; formulas still rendering are never dropped.
 */
const cache = new Map<string, Entry>()
const MAX_CACHED = 300
const listeners = new Set<() => void>()
let version = 0
let engine: Promise<typeof import('./mathjax')> | null = null

const key = (tex: string, display: boolean) => (display ? 'D' : 'I') + tex

function render(tex: string, display: boolean): Promise<void> {
  const k = key(tex, display)
  const e = cache.get(k)
  if (e) return 'pending' in e ? e.pending : Promise.resolve()
  engine ??= import('./mathjax')
  const pending = engine
    .then((m) => m.texToSvg(tex, display))
    .then(
      (svg) => void cache.set(k, { svg }),
      (err) => void cache.set(k, { error: err instanceof Error ? err.message : String(err) }),
    )
    .then(() => {
      version++
      listeners.forEach((l) => l())
    })
  cache.set(k, { pending })
  trim()
  return pending
}

/** Drop the least recently used finished formulas beyond MAX_CACHED */
function trim(): void {
  for (const [k, e] of cache) {
    if (cache.size <= MAX_CACHED) return
    if (!('pending' in e)) cache.delete(k)
  }
}

/** The rendered formula, or undefined while it renders (then subscribers are notified) or on error */
export function texSvg(tex: string, display: boolean): TexSvg | undefined {
  const k = key(tex, display)
  const e = cache.get(k)
  if (!e) void render(tex, display)
  else if (!('pending' in e)) {
    // Used: move to the end, so it is dropped last
    cache.delete(k)
    cache.set(k, e)
  }
  return e && 'svg' in e ? e.svg : undefined
}

/** Renders all formulas in the texts (for exports, which cannot wait for a redraw) */
export async function loadTex(texts: string[]): Promise<void> {
  const jobs: Promise<void>[] = []
  for (const s of texts) for (const line of s.split('\n')) for (const p of splitTex(line)) if ('tex' in p) jobs.push(render(p.tex, p.display))
  await Promise.all(jobs)
}

/** HTML of a text with its formulas as inline SVG (report tables); render them with loadTex first */
export function texHtml(s: string): string {
  const em = (v: number) => `${+(v * MATH_SCALE).toFixed(3)}em`
  return s
    .split('\n')
    .map((line) =>
      splitTex(line)
        .map((p) => {
          if (!('tex' in p)) return escapeHtml(p.text)
          const f = texSvg(p.tex, p.display)
          if (!f) return escapeHtml(texSource(p))
          return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f.viewBox}" width="${em(f.width)}" height="${em(f.ascent + f.descent)}" style="vertical-align:-${em(f.descent)}" role="img" aria-label="${escapeHtml(p.tex)}">${f.body}</svg>`
        })
        .join(''),
    )
    .join('<br>')
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** Re-renders the component when a formula has been rendered */
export function useTexVersion(): number {
  return useSyncExternalStore(subscribe, () => version)
}
