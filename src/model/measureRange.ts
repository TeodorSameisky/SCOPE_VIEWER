/**
 * Which samples a measurement range means. Every place that measures, takes a spectrum or exports
 * samples of a range asks here, so the measurement table, edge snapping, the spectrum, callout values
 * and the exports always take the same samples of a window – and the compute engine, which remembers
 * results by sample indices, can share one result between them.
 *
 * The rule: the samples whose time lies within the window, both ends included. A time within a
 * billionth of a sample of a sample's time counts as that sample's (a cursor placed on a sample by
 * snapping, after rounding).
 */
import type { CursorState, MeasureRange, TimeWindow } from './view'

/** Rounding slack, in samples */
const SLACK = 1e-9

/** All of time: the window of the whole record, whatever a waveform's record is */
const ALL: TimeWindow = { start: -Infinity, end: Infinity }

/** The time window of a measurement range: the screen, the span between the cursors (in either order), or all of time */
export function rangeWindow(range: MeasureRange, win: TimeWindow, cursors: Pick<CursorState, 'a' | 'b'>): TimeWindow {
  if (range === 'screen') return win
  if (range === 'cursors') return { start: Math.min(cursors.a, cursors.b), end: Math.max(cursors.a, cursors.b) }
  return ALL
}

/**
 * The samples of a waveform within a time window: [i0, i1), whole indices within the waveform. A
 * window with no sample in it gives i0 === i1.
 */
export function samplesIn(w: { t0: number; dt: number; data: { length: number } }, win: TimeWindow): [number, number] {
  const n = w.data.length
  const i0 = win.start === -Infinity ? 0 : Math.min(n, Math.max(0, Math.ceil((win.start - w.t0) / w.dt - SLACK)))
  const i1 = win.end === Infinity ? n : Math.min(n, Math.max(0, Math.floor((win.end - w.t0) / w.dt + SLACK) + 1))
  return i1 > i0 ? [i0, i1] : [i0, i0]
}

/** The samples of a waveform a measurement range means (see samplesIn) */
export function rangeSamples(w: { t0: number; dt: number; data: { length: number } }, range: MeasureRange, win: TimeWindow, cursors: Pick<CursorState, 'a' | 'b'>): [number, number] {
  return samplesIn(w, rangeWindow(range, win, cursors))
}
