import type { ChannelDisplay, Waveform } from '../model/types'
import type { MinMaxPyramid } from '../dsp/minmax'
import { niceStep, si, siTick } from '../util/format'
import { channelTag, slopeSymbol } from '../util/names'
import { sampleAt } from '../math/signal'
import type { Theme } from './theme'
import { PLOT_FONT, SANS, font } from './fonts'

export const DIVS_Y = 10
/** Gutter on the right of each plot for the vertical scale labels */
export const AXIS_GUTTER = 64
/** The dashed line at the trigger level, in the colour of the source, is this faint */
const TRIGGER_LINE_ALPHA = 0.45

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
  /** Channel whose vertical scale is labelled on the right axis (in its unit) */
  axisChannel?: TraceInput
  cursors?: { a: number; b: number; sourceId?: string; showLabels: boolean }
  /** `slope` as stored in the setup (RISE / FALL / EITHER) */
  trigger?: { sourceId?: string; level?: number; slope?: string; showMarker: boolean }
  selectedId?: string
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

let measureCtx: CanvasRenderingContext2D | null | undefined
/** Width of a text in a canvas font (estimated where there is no canvas, e.g. in tests) */
export function textWidth(text: string, cssFont: string): number {
  if (measureCtx === undefined) measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * 7
  measureCtx.font = cssFont
  return measureCtx.measureText(text).width
}

/** Least distance (px) between two scale labels */
const LABEL_GAP = 15
/** Space (px) kept free between two time labels */
const TIME_LABEL_PAD = 10
/** The dots that mark fifths of a division are left out when they would be closer than this (px) */
const MIN_DOT_GAP = 3

/**
 * Heights (px from the top) of the grid rows of a view: one per division, at the round values of
 * the channel whose scale is labelled (the multiples of its V/div), so its labels sit on the rows
 * and the grid moves with its position, as on a Tektronix scope. Without one, at the divisions from
 * the centre.
 */
export function gridRows(height: number, axis?: ChannelDisplay): number[] {
  const divH = height / DIVS_Y
  // Where the value 0 is (div); the rows are a whole number of divisions from it
  const zero = axis ? valueToDiv(0, axis) : 0
  const rows: number[] = []
  for (let k = Math.ceil(-DIVS_Y / 2 - zero - 1e-9); zero + k <= DIVS_Y / 2 + 1e-9; k++) rows.push(height / 2 - (zero + k) * divH)
  return rows
}

/** Whether a positive value is on the 1-2-5 sequence */
function isOneTwoFive(v: number): boolean {
  const m = v / Math.pow(10, Math.floor(Math.log10(v) + 1e-9))
  return [1, 2, 5, 10].some((s) => Math.abs(m - s) < s * 1e-6)
}

/**
 * Value step between the scale labels of a channel: the least 1-2-5 value that keeps them LABEL_GAP
 * apart. When its V/div is on the 1-2-5 sequence, also a multiple of it, so the labels sit on grid
 * rows; else (after a zoom rectangle) they are round values between the rows, never rounded ones.
 */
export function labelStep(scale: number, divPx: number): number {
  let step = niceStep(scale * Math.max(1, LABEL_GAP / divPx) * (1 - 1e-9))
  if (isOneTwoFive(scale)) while (Math.abs(step / scale - Math.round(step / scale)) > 1e-6) step = niceStep(step * (1 + 1e-6))
  return step
}

/** How many ticks apart labels `need` px wide go on ticks `gap` px apart: 1, 2, 5, 10 … */
export function labelEvery(gap: number, need: number): number {
  return need <= gap ? 1 : Math.round(niceStep(need / gap))
}

/** Font of the channel labels next to the tags */
const TAG_LABEL_FONT = font(13, SANS)
/** Half the height of a tag, and the least distance between the centres of two tags (where there is room) */
const TAG_HALF = 7
const TAG_GAP = 16

/** The offset of a channel as its tag shows it, e.g. "3.57 V"; empty when it is 0 */
export function offsetText(d: ChannelDisplay, unit: string): string {
  return Math.abs(d.offset) > d.scale * 1e-9 ? si(d.offset, unit, 3) : ''
}

/**
 * A channel's tag on the left edge of its view, as the handle on a Tektronix scope: at the channel's
 * position, which is where its offset level is (0 without an offset), with the offset in the tag
 */
export interface ChannelTag {
  display: ChannelDisplay
  /** The level the tag points at (px from the top of the view): the position, inside the view */
  level: number
  /** Centre of the tag: at its level, unless moved apart from the other tags (or away from the edge) */
  y: number
  /** Width of the channel part of the tag */
  nameW: number
  /** Width of the tag itself (channel and offset) */
  w: number
  /** The offset shown in the tag, '' without one */
  offset: string
  /** Right end of the tag with its label (px) */
  right: number
  /** The position lies above (-1) or below (1) the view; the tag then shows an arrow */
  off: -1 | 0 | 1
}

/** A tag that is not at its level is joined to it by a leader */
const hasLeader = (t: ChannelTag) => t.off === 0 && Math.abs(t.y - t.level) > 0.5

/** Where the tags of the channels of one view go (in drawing order) */
export function layoutTags(traces: { display: ChannelDisplay; wave: Pick<Waveform, 'yUnit'> }[], height: number): ChannelTag[] {
  const divH = height / DIVS_Y
  const top = TAG_HALF + 1
  const bottom = height - TAG_HALF - 1
  const tags = traces
    .map(({ display: d, wave }): ChannelTag => {
      const level = height / 2 - d.position * divH
      const nameW = textWidth(channelTag(d.id), PLOT_FONT) + 8
      const offset = offsetText(d, wave.yUnit)
      const w = offset ? nameW + textWidth(offset, PLOT_FONT) + 10 : nameW
      return {
        display: d,
        level: Math.min(height, Math.max(0, level)),
        y: Math.min(bottom, Math.max(top, level)),
        nameW,
        w,
        offset,
        right: 0,
        off: level < 0 ? -1 : level > height ? 1 : 0,
      }
    })
    .sort((a, b) => a.y - b.y)
  // Spread apart where they would overlap; where there is not room for all, they overlap evenly
  // but never leave the view
  const gap = tags.length > 1 ? Math.min(TAG_GAP, (bottom - top) / (tags.length - 1)) : TAG_GAP
  for (let i = 1; i < tags.length; i++) tags[i].y = Math.max(tags[i].y, tags[i - 1].y + gap)
  for (let i = tags.length - 1; i >= 0; i--) tags[i].y = Math.min(tags[i].y, i === tags.length - 1 ? bottom : tags[i + 1].y - gap)
  for (const t of tags) t.right = t.display.label ? t.w + 12 + textWidth(t.display.label, TAG_LABEL_FONT) : t.w + 12
  return tags
}

/** The tag at (x, y) of a view (tags drawn later win), or undefined */
export function tagAt(tags: ChannelTag[], x: number, y: number): ChannelTag | undefined {
  if (x < 0) return undefined
  for (let i = tags.length - 1; i >= 0; i--) if (x <= tags[i].right && Math.abs(y - tags[i].y) <= TAG_HALF + 1) return tags[i]
  return undefined
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

  // Graticule as on the scope: 10 divisions high, the rows at round values of the axis channel (see
  // gridRows), the columns at the time ticks; dots on every line mark fifths of a division, in time
  // along the rows and in level along the columns
  const rows = gridRows(H, o.axisChannel?.display)
  const cols = o.timeTicks.map(tx)
  const colGap = cols.length > 1 ? cols[1] - cols[0] : plotW / 10
  ctx.lineWidth = 1
  ctx.strokeStyle = theme.grid
  ctx.beginPath()
  for (const y of rows) {
    ctx.moveTo(0, Math.round(y) + 0.5)
    ctx.lineTo(plotW, Math.round(y) + 0.5)
  }
  for (const x of cols) {
    ctx.moveTo(Math.round(x) + 0.5, 0)
    ctx.lineTo(Math.round(x) + 0.5, H)
  }
  ctx.stroke()
  ctx.fillStyle = theme.gridCenter
  const dots = (from: number, gap: number, end: number, dot: (p: number) => void) => {
    if (gap < MIN_DOT_GAP) return
    const first = from - Math.floor(from / gap) * gap
    for (let i = 0; first + i * gap <= end; i++) dot(Math.round(first + i * gap))
  }
  if (cols.length) for (const y of rows) dots(cols[0], colGap / 5, plotW, (x) => ctx.fillRect(x, Math.round(y), 1, 1))
  if (rows.length) for (const x of cols) dots(rows[0], divH / 5, H, (y) => ctx.fillRect(Math.round(x), y, 1, 1))
  ctx.strokeStyle = theme.gridCenter
  ctx.strokeRect(0.5, 0.5, plotW - 1, H - 1)

  // Traces
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, plotW, H)
  ctx.clip()
  for (const tr of o.traces) drawTrace(ctx, tr, o, plotW, divH)
  ctx.restore()

  // Right axis labels for the selected/first channel of this view, over its whole height as on the
  // scope: round values far enough apart (see labelStep)
  if (o.axisChannel) {
    const d = o.axisChannel.display
    const unit = o.axisChannel.wave.yUnit
    ctx.font = PLOT_FONT
    ctx.fillStyle = theme.ink(d.color)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const step = labelStep(d.scale, divH)
    const vLo = divToValue(-DIVS_Y / 2, d)
    const vHi = divToValue(DIVS_Y / 2, d)
    for (let k = Math.ceil(vLo / step - 1e-9); k * step <= vHi + step * 1e-9; k++) {
      const v = k * step
      const y = H / 2 - valueToDiv(v, d) * divH
      if (y < 5 || y > H - 5) continue
      ctx.fillText(siTick(v, unit, step), plotW + 6, y)
      ctx.fillRect(plotW, Math.round(y), 4, 1)
    }
  }

  // Channel tags on the left edge at each channel's position, with its offset (see layoutTags); a
  // tag moved apart from the others points to its level with a leader, and a tag whose position is
  // outside the view sits at the edge with an arrow towards it
  ctx.font = PLOT_FONT
  ctx.textBaseline = 'middle'
  const tags = layoutTags(o.traces, H)
  // The leaders first: from the tip of the tag to a tick at its level, under the tags and labels
  ctx.lineWidth = 1
  for (const tag of tags.filter(hasLeader)) {
    const { y, w, level } = tag
    ctx.strokeStyle = theme.ink(tag.display.color)
    ctx.beginPath()
    ctx.moveTo(w + 6, y)
    ctx.lineTo(w + 9.5, y)
    ctx.lineTo(w + 9.5, level)
    ctx.lineTo(w + 3, level)
    ctx.stroke()
  }
  for (const tag of tags) {
    const { display: d, y, w, off } = tag
    const ink = theme.ink(d.color)
    ctx.fillStyle = ink
    ctx.beginPath()
    if (off === 0) {
      ctx.moveTo(0, y - TAG_HALF)
      ctx.lineTo(w, y - TAG_HALF)
      ctx.lineTo(w + 6, y)
      ctx.lineTo(w, y + TAG_HALF)
      ctx.lineTo(0, y + TAG_HALF)
      ctx.closePath()
    } else {
      ctx.rect(0, y - TAG_HALF, w, 2 * TAG_HALF)
      ctx.moveTo(w + 1, y - off * TAG_HALF)
      ctx.lineTo(w + 11, y - off * TAG_HALF)
      ctx.lineTo(w + 6, y + off * TAG_HALF)
      ctx.closePath()
    }
    ctx.fill()
    ctx.textAlign = 'left'
    if (tag.offset) {
      // The offset in the outlined part of the tag, as on the scope
      ctx.fillStyle = theme.bg
      ctx.fillRect(tag.nameW, y - TAG_HALF + 1, w - tag.nameW - 1, 2 * TAG_HALF - 2)
      ctx.fillStyle = ink
      ctx.fillText(tag.offset, tag.nameW + 5, y + 0.5)
    }
    ctx.fillStyle = theme.onInk(ink)
    ctx.fillText(channelTag(d.id), 4, y + 0.5)
    if (d.label) {
      ctx.fillStyle = ink
      ctx.font = TAG_LABEL_FONT
      ctx.fillText(d.label, w + 12, y + 0.5)
      ctx.font = PLOT_FONT
    }
    if (d.id === o.selectedId) {
      ctx.strokeStyle = theme.selection
      ctx.lineWidth = 1
      ctx.strokeRect(0.5, y - 7.5, w + 0.5, 15)
    }
  }

  // Trigger: time marker, and the level as on the scope: an arrow on the right edge in the colour of
  // the source, with its name and slope; outside the view it sits at the top or bottom, pointing out
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
      const ink = theme.ink(src.display.color)
      const level = H / 2 - valueToDiv(o.trigger.level, src.display) * divH
      const off = level < 0 ? -1 : level > H ? 1 : 0
      const y = off < 0 ? 6 : off > 0 ? H - 6 : level
      if (off === 0) {
        ctx.strokeStyle = ink
        ctx.globalAlpha = TRIGGER_LINE_ALPHA
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(0, Math.round(y) + 0.5)
        ctx.lineTo(plotW, Math.round(y) + 0.5)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }
      ctx.fillStyle = ink
      ctx.beginPath()
      if (off === 0) {
        ctx.moveTo(plotW, y)
        ctx.lineTo(plotW - 9, y - 6)
        ctx.lineTo(plotW - 9, y + 6)
      } else {
        ctx.moveTo(plotW - 5, y + off * 5)
        ctx.lineTo(plotW - 10, y - off * 4)
        ctx.lineTo(plotW, y - off * 4)
      }
      ctx.closePath()
      ctx.fill()
      const text = `${channelTag(src.display.id)} ${slopeSymbol(o.trigger.slope)}`.trim()
      ctx.font = PLOT_FONT
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      const tw = ctx.measureText(text).width
      ctx.fillStyle = theme.bg
      ctx.fillRect(plotW - 15 - tw, y - 7, tw + 4, 14)
      ctx.fillStyle = ink
      ctx.fillText(text, plotW - 13, y + 0.5)
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

  ctx.restore()
}

export interface HoverDrawOptions {
  width: number
  height: number
  dpr: number
  tStart: number
  tEnd: number
  traces: TraceInput[]
  /** Time at the pointer */
  t: number
  /** Mark where each trace crosses the line */
  dots: boolean
  theme: Theme
}

/**
 * The line at the pointer's time across a view, with a ring where each trace crosses it. Drawn on
 * a transparent canvas over the view (cleared by the caller), so following the pointer never
 * redraws the traces.
 */
export function drawHover(ctx: CanvasRenderingContext2D, o: HoverDrawOptions): void {
  const { theme } = o
  const H = o.height
  const plotW = o.width - AXIS_GUTTER
  const divH = H / DIVS_Y
  const x = Math.round(((o.t - o.tStart) / (o.tEnd - o.tStart)) * plotW) + 0.5
  ctx.save()
  ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0)
  ctx.beginPath()
  ctx.rect(0, 0, plotW, H)
  ctx.clip()
  ctx.lineWidth = 1
  ctx.strokeStyle = theme.hover
  ctx.beginPath()
  ctx.moveTo(x, 0)
  ctx.lineTo(x, H)
  ctx.stroke()
  if (o.dots) {
    ctx.lineWidth = 1.5
    for (const tr of o.traces) {
      const y = H / 2 - valueToDiv(valueAt(tr.wave, o.t), tr.display) * divH
      if (!Number.isFinite(y) || y < -4 || y > H + 4) continue
      ctx.fillStyle = theme.bg
      ctx.strokeStyle = theme.ink(tr.display.color)
      ctx.beginPath()
      ctx.arc(x, y, 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
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
    // Few samples per pixel: connect the real samples. Invalid ones (gaps of math channels) break
    // the line: canvas would ignore them and join the samples on both sides of a gap.
    const i0 = Math.max(0, Math.floor((o.tStart - wave.t0) / wave.dt) - 1)
    const i1 = Math.min(wave.data.length - 1, Math.ceil((o.tEnd - wave.t0) / wave.dt) + 1)
    let started = false
    for (let i = i0; i <= i1; i++) {
      const x = ((wave.t0 + i * wave.dt - o.tStart) / span) * plotW
      const y = yOf(wave.data[i])
      if (!Number.isFinite(y)) started = false
      else if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else ctx.lineTo(x, y)
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

  // Many samples per pixel: min/max envelope per device pixel column; a column without valid
  // samples (a gap of a math channel) breaks the line
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
    if (!Number.isFinite(mm[0])) {
      started = false
      continue
    }
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
  // Every tick is marked; the labels go on every 1st, 2nd, 5th … tick, so they do not run into each other
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : undefined
  const labels = ticks.map((t) => siTick(t, 's', step))
  const gap = step ? (step / (tEnd - tStart)) * plotW : plotW
  const every = labelEvery(gap, Math.max(0, ...labels.map((l) => ctx.measureText(l).width)) + TIME_LABEL_PAD)
  ticks.forEach((t, i) => {
    const x = Math.round(((t - tStart) / (tEnd - tStart)) * plotW) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 4)
    ctx.stroke()
    if (step && Math.round(t / step) % every !== 0) return
    const w = ctx.measureText(labels[i]).width / 2
    ctx.fillText(labels[i], Math.min(plotW - w, Math.max(w, x)), 6)
  })
  ctx.restore()
}
