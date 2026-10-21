import type { Channel, ChannelDisplay } from '../model/types'
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

export type MeasureRange = 'screen' | 'cursors' | 'record'

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

/** Active mouse tool in the plot */
export type Tool = 'pan' | 'zoom' | 'note' | 'marker' | 'region'

/**
 * How a view change was made. Continuous changes (wheel, pan) are grouped so that
 * "zoom back" steps over a whole gesture instead of every single event.
 */
export type NavKind = 'zoom' | 'pan' | 'wheel'

/** Zoom the time window by factor f (>1 = out) keeping time t at the same screen position. */
export function zoomAround(w: TimeWindow, t: number, f: number, minSpan: number, maxSpan: number): TimeWindow {
  const span = w.end - w.start
  const ns = Math.min(maxSpan, Math.max(minSpan, span * f))
  const frac = (t - w.start) / span
  return { start: t - frac * ns, end: t - frac * ns + ns }
}
