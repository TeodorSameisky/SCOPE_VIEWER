import type { ChannelDisplay, Waveform } from '../model/types'
import type { MinMaxPyramid } from '../dsp/minmax'
import { siTick } from '../util/format'
import { channelTag } from '../util/names'
import { sampleAt } from '../math/signal'
import type { Theme } from './theme'

export const DIVS_Y = 10
/** Gutter on the right of each plot for the vertical scale labels */
export const AXIS_GUTTER = 64

export const PLOT_FONT = '11px "JetBrains Mono", ui-monospace, Consolas, monospace'

export interface TraceInput {
  display: ChannelDisplay
  wave: Waveform
  pyramid: MinMaxPyramid
}

export interface ViewDrawOptions {
  width: number
  height: number
  dpr: number
  tStart: number
  tEnd: number
  timeTicks: number[]
  traces: TraceInput[]
  /** Channel whose vertical scale is labelled on the right axis */
  axisChannel?: ChannelDisplay
  cursors?: { a: number; b: number; sourceId?: string; showLabels: boolean }
  trigger?: { sourceId?: string; level?: number; showMarker: boolean }
  selectedId?: string
  hoverT?: number
  theme: Theme
}

export function valueToDiv(v: number, d: ChannelDisplay): number {
  return (v - d.offset) / d.scale + d.position
}

export function divToValue(div: number, d: ChannelDisplay): number {
  return (div - d.position) * d.scale + d.offset
}

/** Interpolated sample value at time t, NaN outside the record. */
export function valueAt(w: Waveform, t: number): number {
  return sampleAt(w.data, w.t0, w.dt, t)
}

export function drawView(ctx: CanvasRenderingContext2D, o: ViewDrawOptions): void {
  const { dpr, theme } = o
  const W = o.width
  const H = o.height
  const plotW = W - AXIS_GUTTER
  const divH = H / DIVS_Y
  const span = o.tEnd - o.tStart
  const tx = (t: number) => ((t - o.tStart) / span) * plotW

  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, W, H)

  // Graticule: fixed 10 vertical divisions, time grid follows nice tick values
  ctx.lineWidth = 1
  for (let i = 0; i <= DIVS_Y; i++) {
    const y = Math.round(i * divH) + 0.5
    ctx.strokeStyle = i === DIVS_Y / 2 ? theme.gridCenter : theme.grid
    ctx.setLineDash(i === 0 || i === DIVS_Y ? [] : [2, 4])
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(plotW, y)
    ctx.stroke()
  }
  ctx.strokeStyle = theme.grid
  for (const t of o.timeTicks) {
    const x = Math.round(tx(t)) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, H)
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.strokeStyle = theme.gridCenter
  ctx.strokeRect(0.5, 0.5, plotW - 1, H - 1)

  // Traces
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, plotW, H)
  ctx.clip()
  for (const tr of o.traces) drawTrace(ctx, tr, o, plotW, divH)
  ctx.restore()

  // Right axis labels for the selected/first channel of this view, at round multiples of V/div
  if (o.axisChannel) {
    const d = o.axisChannel
    ctx.font = PLOT_FONT
    ctx.fillStyle = theme.ink(d.color)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const vLo = divToValue(-DIVS_Y / 2, d)
    const vHi = divToValue(DIVS_Y / 2, d)
    const first = Math.ceil(vLo / d.scale - 1e-9)
    for (let k = first; k * d.scale <= vHi + d.scale * 1e-9; k++) {
      const v = k * d.scale
      const y = H / 2 - valueToDiv(v, d) * divH
      if (y < 5 || y > H - 5) continue
      ctx.fillText(siTick(v, 'V', d.scale), plotW + 6, y)
      ctx.fillRect(plotW, Math.round(y), 4, 1)
    }
  }

  // Channel ground/offset badges on the left edge
  ctx.font = PLOT_FONT
  ctx.textBaseline = 'middle'
  // Badges sit at each channel's 0 V level; spread them apart where they would overlap
  const badges = o.traces
    .map((tr) => ({ d: tr.display, y: Math.min(H - 8, Math.max(8, H / 2 - valueToDiv(0, tr.display) * divH)) }))
    .sort((a, b) => a.y - b.y)
  for (let i = 1; i < badges.length; i++) badges[i].y = Math.max(badges[i].y, badges[i - 1].y + 16)
  for (let i = badges.length - 1; i >= 0; i--) {
    const limit = i === badges.length - 1 ? H - 8 : badges[i + 1].y - 16
    badges[i].y = Math.min(badges[i].y, limit)
  }
  for (const { d, y } of badges) {
    const tag = channelTag(d.id)
    const w = ctx.measureText(tag).width + 8
    const ink = theme.ink(d.color)
    ctx.fillStyle = ink
    ctx.beginPath()
    ctx.moveTo(0, y - 7)
    ctx.lineTo(w, y - 7)
    ctx.lineTo(w + 6, y)
    ctx.lineTo(w, y + 7)
    ctx.lineTo(0, y + 7)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = theme.onInk(ink)
    ctx.textAlign = 'left'
    ctx.fillText(tag, 4, y + 0.5)
    if (d.label) {
      ctx.fillStyle = ink
      ctx.font = '13px system-ui, sans-serif'
      ctx.fillText(d.label, w + 12, y + 0.5)
      ctx.font = PLOT_FONT
    }
    if (d.id === o.selectedId) {
      ctx.strokeStyle = theme.selection
      ctx.lineWidth = 1
      ctx.strokeRect(0.5, y - 7.5, w + 0.5, 15)
    }
  }

  // Trigger: time marker and level arrow
  if (o.trigger) {
    ctx.fillStyle = theme.trigger
    if (o.trigger.showMarker) {
      const x = tx(0)
      if (x >= 0 && x <= plotW) {
        ctx.beginPath()
        ctx.moveTo(x - 6, 0)
        ctx.lineTo(x + 6, 0)
        ctx.lineTo(x, 8)
        ctx.closePath()
        ctx.fill()
      }
    }
    const src = o.traces.find((t) => t.display.id === o.trigger!.sourceId)
    if (src && o.trigger.level !== undefined) {
      const y = H / 2 - valueToDiv(o.trigger.level, src.display) * divH
      if (y >= 0 && y <= H) {
        ctx.beginPath()
        ctx.moveTo(plotW, y)
        ctx.lineTo(plotW - 9, y - 6)
        ctx.lineTo(plotW - 9, y + 6)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = theme.triggerLevel
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(0, Math.round(y) + 0.5)
        ctx.lineTo(plotW, Math.round(y) + 0.5)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
  }

  // Cursors
  if (o.cursors) {
    const src = o.traces.find((t) => t.display.id === o.cursors!.sourceId)
    for (const [name, t] of [['A', o.cursors.a], ['B', o.cursors.b]] as const) {
      const x = Math.round(tx(t)) + 0.5
      if (x < 0 || x > plotW) continue
      ctx.strokeStyle = theme.cursor
      ctx.lineWidth = 1
      ctx.setLineDash(name === 'A' ? [] : [6, 3])
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
      ctx.stroke()
      ctx.setLineDash([])
      if (o.cursors.showLabels) {
        ctx.fillStyle = theme.cursor
        ctx.fillRect(x - 8, 0, 16, 16)
        ctx.fillStyle = theme.cursorText
        ctx.textAlign = 'center'
        ctx.fillText(name, x, 8.5)
      }
      if (src) {
        const v = valueAt(src.wave, t)
        if (Number.isFinite(v)) {
          const y = H / 2 - valueToDiv(v, src.display) * divH
          ctx.fillStyle = theme.ink(src.display.color)
          ctx.beginPath()
          ctx.arc(x, y, 3.5, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
  }

  // Hover crosshair
  if (o.hoverT !== undefined) {
    const x = Math.round(tx(o.hoverT)) + 0.5
    ctx.strokeStyle = theme.hover
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, H)
    ctx.stroke()
  }
  ctx.restore()
}

function drawTrace(ctx: CanvasRenderingContext2D, tr: TraceInput, o: ViewDrawOptions, plotW: number, divH: number): void {
  const { wave, display: d, pyramid } = tr
  const H = o.height
  const span = o.tEnd - o.tStart
  const yOf = (v: number) => H / 2 - ((v - d.offset) / d.scale + d.position) * divH
  const samplesPerPx = span / wave.dt / plotW

  const color = o.theme.ink(d.color)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = d.id === o.selectedId ? 1.5 : 1.1
  ctx.lineJoin = 'round'
  ctx.beginPath()

  if (samplesPerPx <= 2) {
    // Few samples per pixel: connect the real samples
    const i0 = Math.max(0, Math.floor((o.tStart - wave.t0) / wave.dt) - 1)
    const i1 = Math.min(wave.data.length - 1, Math.ceil((o.tEnd - wave.t0) / wave.dt) + 1)
    for (let i = i0; i <= i1; i++) {
      const x = ((wave.t0 + i * wave.dt - o.tStart) / span) * plotW
      const y = yOf(wave.data[i])
      if (i === i0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    if (samplesPerPx < 0.12) {
      for (let i = i0; i <= i1; i++) {
        const x = ((wave.t0 + i * wave.dt - o.tStart) / span) * plotW
        ctx.fillRect(x - 1.5, yOf(wave.data[i]) - 1.5, 3, 3)
      }
    }
    return
  }

  // Many samples per pixel: min/max envelope per device pixel column
  const cols = Math.ceil(plotW * o.dpr)
  const colT = span / cols
  const mm: [number, number] = [0, 0]
  let started = false
  for (let c = 0; c < cols; c++) {
    const ta = o.tStart + c * colT
    const i0 = Math.floor((ta - wave.t0) / wave.dt)
    const i1 = Math.floor((ta + colT - wave.t0) / wave.dt) + 1
    if (i1 <= 0 || i0 >= wave.data.length) continue
    pyramid.range(i0, i1, mm)
    if (!Number.isFinite(mm[0])) continue
    const x = (c + 0.5) / o.dpr
    const y0 = yOf(mm[1])
    const y1 = yOf(mm[0]) + 0.5
    if (!started) {
      ctx.moveTo(x, y0)
      started = true
    } else ctx.lineTo(x, y0)
    ctx.lineTo(x, y1)
  }
  ctx.stroke()
}

export function drawTimeAxis(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number, tStart: number, tEnd: number, ticks: number[], theme: Theme): void {
  const plotW = width - AXIS_GUTTER
  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, width, height)
  ctx.font = PLOT_FONT
  ctx.fillStyle = theme.axisText
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.strokeStyle = theme.gridCenter
  for (const t of ticks) {
    const x = Math.round(((t - tStart) / (tEnd - tStart)) * plotW) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 4)
    ctx.stroke()
    const label = siTick(t, 's', ticks.length > 1 ? ticks[1] - ticks[0] : undefined)
    const w = ctx.measureText(label).width / 2
    ctx.fillText(label, Math.min(plotW - w, Math.max(w, x)), 6)
  }
  ctx.restore()
}
