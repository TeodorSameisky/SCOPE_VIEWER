/**
 * State of the view on a session (time window, cursors, tool, measurement range) and the pure
 * helpers that work on it. Shared by the UI, the renderers and the exports.
 */
import type { Channel, ChannelDisplay } from './types'
import type { MinMaxPyramid } from '../dsp/minmax'
import { niceStep } from '../util/format'

export interface TimeWindow {
  start: number
  end: number
}

export interface CursorState {
  on: boolean
  a: number
  b: number
  source: string
}

/** Samples measurements, spectra and CSV exports are taken from */
export type MeasureRange = 'screen' | 'cursors' | 'record'
export const MEASURE_RANGES: readonly MeasureRange[] = ['screen', 'cursors', 'record']

/** Sample index range [i0, i1) of a waveform for a measurement range (fractional, clamped by the caller) */
export function sampleRange(w: { t0: number; dt: number; data: { length: number } }, range: MeasureRange, win: TimeWindow, cursors: CursorState): [number, number] {
  if (range === 'screen') return [(win.start - w.t0) / w.dt, (win.end - w.t0) / w.dt + 1]
  if (range === 'cursors') return [(Math.min(cursors.a, cursors.b) - w.t0) / w.dt, (Math.max(cursors.a, cursors.b) - w.t0) / w.dt + 1]
  return [0, w.data.length]
}

export const RANGE_LABEL: Record<MeasureRange, string> = { screen: 'On screen', cursors: 'Between cursors', record: 'Whole record' }
/** The same in a word, for the small choice buttons of the menus */
export const RANGE_SHORT: Record<MeasureRange, string> = { screen: 'Screen', cursors: 'Cursors', record: 'Record' }

export function isMeasureRange(v: unknown): v is MeasureRange {
  return MEASURE_RANGES.includes(v as MeasureRange)
}

export interface LiveChannel extends Channel {
  pyramid: MinMaxPyramid
}

export function timeTicks(w: TimeWindow, target = 10): number[] {
  const step = niceStep((w.end - w.start) / target)
  const first = Math.ceil(w.start / step) * step
  const ticks: number[] = []
  for (let t = first; t <= w.end + step * 1e-9; t += step) ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t)
  return ticks
}

/** Next value in the 1-2-5 sequence above (dir=1) or below (dir=-1) the given scale. */
export function stepScale(scale: number, dir: 1 | -1): number {
  const exp = Math.pow(10, Math.floor(Math.log10(scale) + 1e-9))
  const seq = [1, 2, 5, 10, 20].map((m) => m * exp)
  const m = seq.findIndex((s) => Math.abs(s - scale) / scale < 1e-6)
  if (m >= 0) return dir > 0 ? seq[m + 1] : m > 0 ? seq[m - 1] : exp / 2
  // Not on the sequence: snap to the nearest one in the requested direction
  return dir > 0 ? (seq.find((s) => s > scale) ?? 10 * exp) : ([...seq].reverse().find((s) => s < scale) ?? exp / 2)
}

export type DisplayPatch = Partial<Omit<ChannelDisplay, 'id'>>

/** Vertical settings of channels by id: what Back restores after a zoom that scaled them */
export type Verticals = Record<string, Pick<ChannelDisplay, 'scale' | 'position' | 'offset'>>

/** The vertical settings of the channels `ids` */
export function verticalsOf(displays: ChannelDisplay[], ids: string[]): Verticals {
  return Object.fromEntries(displays.filter((d) => ids.includes(d.id)).map((d) => [d.id, { scale: d.scale, position: d.position, offset: d.offset }]))
}

/** `displays` with the patches (by channel id) applied; the same array when they change nothing */
export function patchDisplays(displays: ChannelDisplay[], patches: Record<string, DisplayPatch>): ChannelDisplay[] {
  let changed = false
  const next = displays.map((d) => {
    const p = patches[d.id]
    if (!p || (Object.keys(p) as (keyof DisplayPatch)[]).every((k) => p[k] === d[k])) return d
    changed = true
    return { ...d, ...p }
  })
  return changed ? next : displays
}

/** Share of its view (or band) an autoscaled trace may fill */
const AUTOSCALE_FILL = 0.8

/**
 * Autoscale: V/div (1-2-5), offset and position that fit the samples of the channels `ids` in the
 * time window `win` into their views (`divs` high), up to 80 % of the height; a waveform with no
 * sample in the window is fitted over the whole record. Visible channels that share a view get a
 * band each, top to bottom in the order of the view, so they do not overlap – the same band whether
 * one of them is autoscaled or all of them. A flat trace keeps its V/div and goes to its band's middle.
 */
export function autoscalePatches(channels: LiveChannel[], views: string[][], ids: string[], win: TimeWindow, divs: number): Record<string, DisplayPatch> {
  const byId = new Map(channels.map((c) => [c.wave.id, c]))
  const patches: Record<string, DisplayPatch> = {}
  for (const id of ids) {
    const c = byId.get(id)
    const range = c && valueRange(c, win)
    if (!c || !range) continue
    // Its band among the traces of its view (itself also when it is hidden)
    const band = (views.find((v) => v.includes(id)) ?? [id]).filter((x) => x === id || byId.get(x)?.display.visible)
    const h = divs / band.length
    const position = Math.round(h * ((band.length - 1) / 2 - band.indexOf(id)) * 100) / 100
    const [lo, hi] = range
    const scale = hi > lo ? parseFloat(niceStep(Math.max(hi - lo, Math.abs(lo) * 1e-3) / (h * AUTOSCALE_FILL)).toPrecision(6)) : c.display.scale
    // The offset rounded to a tenth of a division so it reads nicely
    const offset = parseFloat((Math.round((lo + hi) / 2 / (scale / 10)) * (scale / 10)).toPrecision(6))
    patches[id] = { scale, offset, position }
  }
  return patches
}

/** Min and max of a channel's samples in the window, else of the whole record; undefined without finite samples */
function valueRange(c: LiveChannel, win: TimeWindow): [number, number] | undefined {
  const { t0, dt, data } = c.wave
  const mm: [number, number] = [NaN, NaN]
  c.pyramid.range(Math.floor((win.start - t0) / dt), Math.ceil((win.end - t0) / dt) + 1, mm)
  if (Number.isNaN(mm[0])) c.pyramid.range(0, data.length, mm)
  return Number.isFinite(mm[0]) && Number.isFinite(mm[1]) ? mm : undefined
}

/** One step of a channel's position (div): arrow keys, Alt+wheel and the ± buttons; Shift+arrow moves a whole division */
export const POSITION_STEP = 0.1

/** A position moved by `divs`, rounded to 0.01 div */
export function stepPosition(position: number, divs: number): number {
  return Math.round((position + divs) * 100) / 100
}

/** The cursors switched on at 30 % and 70 % of the view */
export function cursorsInView(c: CursorState, win: TimeWindow): CursorState {
  const span = win.end - win.start
  return { ...c, on: true, a: win.start + span * 0.3, b: win.start + span * 0.7 }
}

/** Active mouse tool in the plot */
export type Tool = 'pan' | 'zoom' | 'note' | 'marker' | 'region' | 'box' | 'span'

/**
 * How a view change was made. Continuous changes (wheel, pan) are grouped so that
 * "zoom back" steps over a whole gesture instead of every single event.
 */
export type NavKind = 'zoom' | 'pan' | 'wheel'

/**
 * A vertical level in divisions moved onto the nearest grid line when it is within `snapPx`
 * of it on screen; `divPx` is the height of one division.
 */
export function snapToGrid(div: number, divPx: number, snapPx = 6): number {
  const line = Math.round(div)
  return Math.abs(div - line) * divPx <= snapPx ? line : div
}

/** Zoom the time window by factor f (>1 = out) keeping time t at the same screen position. */
export function zoomAround(w: TimeWindow, t: number, f: number, minSpan: number, maxSpan: number): TimeWindow {
  const span = w.end - w.start
  const ns = Math.min(maxSpan, Math.max(minSpan, span * f))
  const frac = (t - w.start) / span
  return { start: t - frac * ns, end: t - frac * ns + ns }
}
