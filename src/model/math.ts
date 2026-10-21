import type { ChannelDisplay } from './types'

/** Definition of a math channel; its display settings live with the other channels. */
export interface MathDef {
  id: string
  expr: string
  /** Overrides the unit derived from the expression */
  unit?: string
}

export const MAX_MATH = 8

export const MATH_COLORS = ['#ff6ec7', '#b388ff', '#5ce1e6', '#ffd166', '#f4845f', '#9ef01a', '#e0aaff', '#48cae4']

/**
 * First free id MATH1, MATH2, … that is neither used by another math channel nor by a channel
 * of the session (a scope session can contain its own math waveforms, e.g. math1.wfm → MATH1).
 */
export function nextMathId(defs: MathDef[], taken: string[] = []): string {
  for (let n = 1; ; n++) {
    const id = `MATH${n}`
    if (!defs.some((d) => d.id === id) && !taken.includes(id)) return id
  }
}

/** Quick operations offered in the math editor; A and B are channel names */
export const MATH_PRESETS: { label: string; title: string; build: (a: string, b: string) => string; usesB?: boolean }[] = [
  { label: 'A + B', title: 'Sum', build: (a, b) => `${a} + ${b}`, usesB: true },
  { label: 'A − B', title: 'Difference, e.g. a differential voltage', build: (a, b) => `${a} - ${b}`, usesB: true },
  { label: 'A × B', title: 'Product, e.g. voltage × current = power', build: (a, b) => `${a} * ${b}`, usesB: true },
  { label: 'A ÷ B', title: 'Ratio', build: (a, b) => `${a} / ${b}`, usesB: true },
  { label: '−A', title: 'Invert', build: (a) => `-${a}` },
  { label: '|A|', title: 'Absolute value', build: (a) => `abs(${a})` },
  { label: 'd/dt', title: 'Derivative (slew rate)', build: (a) => `deriv(${a})` },
  { label: '∫ dt', title: 'Running integral', build: (a) => `integ(${a})` },
  { label: 'Low-pass', title: 'Filter out high-frequency noise (edit the cut-off)', build: (a) => `lowpass(${a}, 1M)` },
  { label: 'Average', title: 'Moving average (edit the window)', build: (a) => `avg(${a}, 10u)` },
]

// ---------- persistence per session file ----------

export interface StoredMath {
  def: MathDef
  display: Omit<ChannelDisplay, 'id'>
  view: number
}

const PREFIX = 'scope-viewer:math:'

export function loadMath(fingerprint: string | undefined): StoredMath[] {
  if (!fingerprint) return []
  try {
    const raw = localStorage.getItem(PREFIX + fingerprint)
    const list = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list)) return []
    return list.filter(
      (m): m is StoredMath =>
        m && typeof m.def?.id === 'string' && /^MATH\d+$/.test(m.def.id) && typeof m.def.expr === 'string' && typeof m.display === 'object' && typeof m.view === 'number',
    )
  } catch {
    return []
  }
}
