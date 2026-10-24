import { toDb, type Peak, type Spectrum } from '../math/fft'
import type { FreqAxis, SpectrumScale } from '../model/spectrum'
import { niceStep, siTick } from '../util/format'
import { MONO, PLOT_FONT, font } from './fonts'
import type { Theme } from './theme'

/** Height of the frequency axis below the spectrum plot */
export const FREQ_AXIS_H = 22

export interface FreqRange {
  lo: number
  hi: number
}

/** Pixel ↔ frequency mapping of the spectrum plot */
export interface FreqMap {
  axis: FreqAxis
  lo: number
  hi: number
  /** Plot width (px) */
  width: number
}

export function fToX(m: FreqMap, f: number): number {
  if (m.axis === 'log') return ((Math.log10(Math.max(f, 1e-30)) - Math.log10(m.lo)) / (Math.log10(m.hi) - Math.log10(m.lo))) * m.width
  return ((f - m.lo) / (m.hi - m.lo)) * m.width
}

export function xToF(m: FreqMap, x: number): number {
  if (m.axis === 'log') return Math.pow(10, Math.log10(m.lo) + (x / m.width) * (Math.log10(m.hi) - Math.log10(m.lo)))
  return m.lo + (x / m.width) * (m.hi - m.lo)
}

/** Value on the level axis: dB re 1 unit RMS, or linear RMS */
export function levelValue(scale: SpectrumScale, rms: number): number {
  return scale === 'db' ? toDb(rms) : rms
}

/**
 * Highest level of the bins between fa and fb (what the trace shows in that pixel column), or
 * the nearest bin to f when the column holds none.
 */
export function readLevel(s: Spectrum, f: number, fa: number, fb: number): { rms: number; freq: number } | undefined {
  const last = s.rms.length - 1
  if (f < 0 || f > last * s.df + s.df / 2) return undefined
  const ka = Math.max(0, Math.ceil(fa / s.df))
  const kb = Math.min(last, Math.floor(fb / s.df))
  if (kb < ka) {
    const k = Math.min(last, Math.max(0, Math.round(f / s.df)))
    return { rms: s.rms[k], freq: k * s.df }
  }
  let best = ka
  for (let k = ka + 1; k <= kb; k++) if (s.rms[k] > s.rms[best]) best = k
  return { rms: s.rms[best], freq: best * s.df }
}

export interface FreqTick {
  f: number
  major: boolean
  label: boolean
}

/** Grid lines of the frequency axis: decades with 2…9 subdivisions (log), or a 1-2-5 step (linear) */
export function freqTicks(m: FreqMap): FreqTick[] {
  const ticks: FreqTick[] = []
  if (m.axis === 'log') {
    const pxPerDecade = m.width / (Math.log10(m.hi) - Math.log10(m.lo))
    if (pxPerDecade < 700) {
      for (let e = Math.floor(Math.log10(m.lo)); e <= Math.ceil(Math.log10(m.hi)); e++) {
        const dec = Math.pow(10, e)
        for (let k = 1; k <= 9; k++) {
          const f = k * dec
          if (f < m.lo * 0.999999 || f > m.hi * 1.000001) continue
          const label = k === 1 || (pxPerDecade > 160 && (k === 2 || k === 5)) || pxPerDecade > 420
          ticks.push({ f, major: k === 1, label })
        }
      }
      if (ticks.filter((t) => t.label).length >= 2) return ticks
      ticks.length = 0
    }
    // Less than about a decade in view: nice linear steps read better
  }
  const step = niceStep((m.hi - m.lo) / Math.max(2, Math.round(m.width / 70)))
  for (let f = Math.ceil(m.lo / step) * step; f <= m.hi + step * 1e-9; f += step) ticks.push({ f: Math.abs(f) < step * 1e-9 ? 0 : f, major: true, label: true })
  return ticks
}

/** Level grid: steps of 1-2-5 at least ~22 px apart (10 or 20 dB for usual ranges) */
export function levelTicks(lo: number, hi: number, height: number): { values: number[]; step: number } {
  const step = niceStep((hi - lo) / Math.max(2, Math.floor(height / 22)))
  const values: number[] = []
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) values.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return { values, step }
}

export interface SpectrumTrace {
  spec: Spectrum
  color: string
  peaks: Peak[]
}

export interface SpectrumDrawOptions {
  width: number
  height: number
  dpr: number
  map: FreqMap
  scale: SpectrumScale
  /** Level axis range in dB or linear units */
  yLo: number
  yHi: number
  /** Unit of the level labels, e.g. "dBV" or "V" */
  yUnit: string
  traces: SpectrumTrace[]
  hoverF?: number
  /** Rubber band of a frequency zoom (px) */
  band?: { x0: number; x1: number }
  theme: Theme
}

export function drawSpectrum(ctx: CanvasRenderingContext2D, o: SpectrumDrawOptions): void {
  const { dpr, map, theme } = o
  const W = o.width
  const plotW = map.width
  const plotH = o.height - FREQ_AXIS_H
  const yOf = (v: number) => ((o.yHi - v) / (o.yHi - o.yLo)) * plotH

  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, W, o.height)
  ctx.lineWidth = 1

  // Grid
  const fTicks = freqTicks(map)
  for (const t of fTicks) {
    const x = Math.round(fToX(map, t.f)) + 0.5
    ctx.strokeStyle = t.major ? theme.grid : theme.gridMinor
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, plotH)
    ctx.stroke()
  }
  const lv = levelTicks(o.yLo, o.yHi, plotH)
  ctx.setLineDash([2, 4])
  ctx.strokeStyle = theme.grid
  for (const v of lv.values) {
    const y = Math.round(yOf(v)) + 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(plotW, y)
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.strokeStyle = theme.gridCenter
  ctx.strokeRect(0.5, 0.5, plotW - 1, plotH - 1)

  // Traces: highest bin per device-pixel column (peak detector), so narrow lines never vanish
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, plotW, plotH)
  ctx.clip()
  const floor = o.scale === 'db' ? o.yLo - 20 : o.yLo
  for (const tr of o.traces) {
    const { rms, df } = tr.spec
    const last = rms.length - 1
    const cols = Math.ceil(plotW * dpr)
    ctx.strokeStyle = theme.ink(tr.color)
    ctx.lineWidth = 1.2
    ctx.lineJoin = 'round'
    ctx.beginPath()
    let started = false
    let fb = xToF(map, 0)
    for (let c = 0; c < cols; c++) {
      const fa = fb
      fb = xToF(map, (c + 1) / dpr)
      const ka = Math.max(0, Math.ceil(fa / df))
      const kb = Math.min(last, Math.ceil(fb / df) - 1)
      if (kb < ka) continue
      let v = rms[ka]
      for (let k = ka + 1; k <= kb; k++) if (rms[k] > v) v = rms[k]
      const y = yOf(Math.max(floor, levelValue(o.scale, v)))
      const x = (c + 0.5) / dpr
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  // Peak markers: numbered triangles above each peak
  ctx.font = font(10, MONO)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  for (const tr of o.traces) {
    tr.peaks.forEach((pk, i) => {
      const x = fToX(map, pk.freq)
      if (x < 0 || x > plotW) return
      const y = Math.max(16, yOf(levelValue(o.scale, pk.rms)))
      ctx.fillStyle = theme.ink(tr.color)
      ctx.beginPath()
      ctx.moveTo(x, y - 2)
      ctx.lineTo(x - 4, y - 8)
      ctx.lineTo(x + 4, y - 8)
      ctx.closePath()
      ctx.fill()
      ctx.fillText(String(i + 1), x, y - 9)
    })
  }

  // Hover crosshair with the level of each trace
  if (o.hoverF !== undefined) {
    const x = fToX(map, o.hoverF)
    ctx.strokeStyle = theme.hover
    ctx.beginPath()
    ctx.moveTo(Math.round(x) + 0.5, 0)
    ctx.lineTo(Math.round(x) + 0.5, plotH)
    ctx.stroke()
    for (const tr of o.traces) {
      const r = readLevel(tr.spec, o.hoverF, xToF(map, x - 0.5), xToF(map, x + 0.5))
      if (!r) continue
      ctx.fillStyle = theme.ink(tr.color)
      ctx.beginPath()
      ctx.arc(x, yOf(Math.max(floor, levelValue(o.scale, r.rms))), 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  if (o.band) {
    const x0 = Math.min(o.band.x0, o.band.x1)
    const x1 = Math.max(o.band.x0, o.band.x1)
    ctx.fillStyle = theme.bandFill
    ctx.strokeStyle = theme.band
    ctx.setLineDash([4, 3])
    ctx.fillRect(x0, 0, x1 - x0, plotH)
    ctx.strokeRect(x0 + 0.5, 0.5, x1 - x0, plotH - 1)
    ctx.setLineDash([])
  }
  ctx.restore()

  // Level labels in the right gutter
  ctx.font = PLOT_FONT
  ctx.fillStyle = theme.axisText
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const v of lv.values) {
    const y = yOf(v)
    if (y < 5 || y > plotH - 5) continue
    const label = o.scale === 'db' ? `${parseFloat(v.toFixed(6))} ${o.yUnit}` : siTick(v, o.yUnit, lv.step)
    ctx.fillText(label, plotW + 6, y)
    ctx.fillRect(plotW, Math.round(y), 4, 1)
  }

  // Frequency labels below, skipping any that would overlap the previous one
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.strokeStyle = theme.gridCenter
  const labelled = fTicks.filter((t) => t.label)
  const linearStep = map.axis === 'linear' || !labelled.some((t) => !t.major) ? (labelled.length > 1 ? labelled[1].f - labelled[0].f : undefined) : undefined
  let lastRight = -Infinity
  for (const t of labelled) {
    const x = Math.round(fToX(map, t.f)) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, plotH)
    ctx.lineTo(x, plotH + 4)
    ctx.stroke()
    const label = siTick(t.f, 'Hz', linearStep ?? t.f / 10)
    const w = ctx.measureText(label).width / 2
    const cx = Math.min(plotW - w, Math.max(w, x))
    if (cx - w < lastRight + 8) continue
    ctx.fillText(label, cx, plotH + 6)
    lastRight = cx + w
  }
  ctx.restore()
}
