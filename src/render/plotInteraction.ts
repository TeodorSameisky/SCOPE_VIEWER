/**
 * What a pointer gesture in the plot means, as pure functions: which trace is meant, which trace a
 * box belongs to, where a note is anchored, what a released drag does. The plot component (PlotArea)
 * keeps the events, the state and the drawing, and applies what these decide; so the rules of each
 * tool can be tested without a browser.
 *
 * Positions are in CSS pixels of the plot, as in its frame (see plotFrame.ts): x from its left edge
 * (the time axis), y from the top of the first view.
 */
import type { NewCallout } from '../model/callouts'
import { snapToGrid, type CursorState, type DisplayPatch, type LiveChannel, type TimeWindow, type Tool } from '../model/view'
import { DIVS_Y, divToValue } from './draw'
import type { FrameChannel, PlotFrame } from './plotFrame'

/** A drag shorter than this (px) is a click */
export const MIN_BOX_PX = 5

/** What a press in the plot does until the pointer is released (Esc or a cancelled pointer drops it) */
export type Drag =
  | { kind: 'pan'; x0: number; win: TimeWindow }
  /**
   * A cursor dragged. `orig`: the cursors when the drag started (Esc puts them back). `now`: where the
   * pointer has taken them; the plot shows these until the drag ends, while the analysis follows at a slower pace.
   */
  | { kind: 'cursor'; which: 'a' | 'b'; orig: CursorState; now?: CursorState }
  /** time-only zoom band */
  | { kind: 'band'; x0: number; x1: number }
  /** time + vertical zoom rectangle inside one view, or (`box`) a new box callout */
  | { kind: 'rect'; box: boolean; view: number; x0: number; y0: number; x1: number; y1: number }
  /** new span callout from end `a`; `b` follows the pointer */
  | { kind: 'span'; a: { ch: string; t: number }; b?: { ch: string; t: number } }
  /** new region callout */
  | { kind: 'region'; x0: number; x1: number }
  /** click-type tools (zoom click, note, marker): only track whether it moved */
  | { kind: 'click'; x0: number; y0: number }
  /**
   * A channel tag moved up or down (its position), or over another view (`target`) to move the
   * channel there on release. `pos0`: the channel's position (div) when the drag started.
   */
  | { kind: 'tag'; id: string; view: number; y0: number; x: number; y: number; pos0: number; moved: boolean; target?: number }

/**
 * The visible trace of the view at height `y` that passes closest to the pointer at time `t`, within
 * `maxPx`; undefined when none does. Traces without a value at `t` are not considered.
 */
export function nearestTrace(frame: PlotFrame<FrameChannel>, t: number, y: number, maxPx = 20): string | undefined {
  let best: string | undefined
  let bestD = maxPx
  for (const c of frame.traces(frame.viewAt(y))) {
    const yc = frame.yOf(c.wave.id, t)
    if (yc === undefined) continue
    const dist = Math.abs(yc - y)
    if (dist < bestD) {
      bestD = dist
      best = c.wave.id
    }
  }
  return best
}

/** A tag's position in a view whose divisions are `divPx` high (div from the centre, to 0.01 div), snapped to whole divisions unless `free` */
export function tagPosition(div: number, divPx: number, free: boolean): number {
  return Math.round((free ? div : snapToGrid(div, divPx)) * 100) / 100
}

/**
 * A new box around the rectangle dragged in a view. It belongs to a trace that runs through it: the
 * selected one if it does, else the one nearest the centre; without one, the selected trace of the view or
 * the nearest. Its time edges snap to edges of that trace where `snapEdge` finds one (leave it out to place
 * them freely). `traces`: the visible traces of the view.
 */
export function boxCallout(
  rect: { x0: number; x1: number; y0: number; y1: number; view: number },
  o: { frame: PlotFrame; selected?: string; snapEdge?: (channel: string, t: number) => number | undefined },
): NewCallout {
  const { frame, selected } = o
  const traces = frame.traces(rect.view)
  const top = frame.divAt(rect.view, Math.min(rect.y0, rect.y1))
  const bottom = frame.divAt(rect.view, Math.max(rect.y0, rect.y1))
  const ta = frame.xToT(Math.min(rect.x0, rect.x1))
  const tb = frame.xToT(Math.max(rect.x0, rect.x1))
  const range: [number, number] = [0, 0]
  const through = traces.filter(({ wave: w, display, pyramid }) => {
    pyramid.range(Math.floor((ta - w.t0) / w.dt), Math.ceil((tb - w.t0) / w.dt) + 1, range)
    return range[1] >= divToValue(bottom, display) && range[0] <= divToValue(top, display)
  })
  // Distance of a trace from the centre of the box (px)
  const midT = (ta + tb) / 2
  const midY = (rect.y0 + rect.y1) / 2
  const distance = (c: LiveChannel) => Math.abs((frame.yOf(c.wave.id, midT) ?? NaN) - midY)
  const closest = (list: LiveChannel[]) =>
    list.filter((c) => Number.isFinite(distance(c))).reduce<LiveChannel | undefined>((best, c) => (!best || distance(c) < distance(best) ? c : best), undefined)
  const selectedIn = (list: LiveChannel[]) => list.find((c) => c.wave.id === selected)
  const ch = selectedIn(through) ?? closest(through) ?? selectedIn(traces) ?? closest(traces)
  const at = (x: number) => {
    const t = frame.xToT(x)
    return !ch || !o.snapEdge ? t : (o.snapEdge(ch.wave.id, t) ?? t)
  }
  const t = at(Math.min(rect.x0, rect.x1))
  const t2 = at(Math.max(rect.x0, rect.x1))
  if (!ch) return { type: 'box', t, t2, view: rect.view, div: top, div2: bottom }
  const round = (v: number) => parseFloat(v.toPrecision(6))
  return { type: 'box', t, t2, channel: ch.wave.id, v: round(divToValue(top, ch.display)), v2: round(divToValue(bottom, ch.display)) }
}

/** Where the note tool puts a note at (x, y): on the nearest trace (within 40 px), otherwise at that spot of the view */
export function noteAnchor(frame: PlotFrame<FrameChannel>, t: number, y: number): NewCallout {
  const ch = nearestTrace(frame, t, y, 40)
  const view = frame.viewAt(y)
  // The text box goes below the anchor near the top of the plot, above it elsewhere
  const dy = y < 70 ? 24 : -46
  if (ch) return { type: 'note', t, channel: ch, dy }
  return { type: 'note', t, view, div: frame.divAt(view, y), dy }
}

/**
 * The vertical settings that fit the levels `divTop` … `divBot` (divisions from the centre of their view)
 * of each of the channels `ids` into the whole height of the view: what a zoom rectangle does to the vertical.
 */
export function rectZoomPatches(channels: Pick<LiveChannel, 'wave' | 'display'>[], ids: string[], divTop: number, divBot: number): { id: string; patch: DisplayPatch }[] {
  return ids.flatMap((id) => {
    const c = channels.find((ch) => ch.wave.id === id)
    if (!c) return []
    const vTop = divToValue(divTop, c.display)
    const vBot = divToValue(divBot, c.display)
    const scale = parseFloat(((vTop - vBot) / DIVS_Y).toPrecision(4))
    const offset = parseFloat(((vTop + vBot) / 2).toPrecision(6))
    return [{ id, patch: { scale, offset, position: 0 } }]
  })
}

/** What the plot has to do when a drag ends */
export type Release =
  | { kind: 'none' }
  /** A tag was dropped onto another view: the channel goes there, with its tag at `position` */
  | { kind: 'dropTag'; id: string; view: number; position: number }
  | { kind: 'addCallout'; callout: NewCallout }
  /** Zoom to this range (the timebase widens one narrower than it allows), and set the vertical settings of channels (a zoom rectangle) */
  | { kind: 'zoom'; window: TimeWindow; patches?: { id: string; patch: DisplayPatch }[] }
  /** Zoom by `factor` (> 1: out) keeping time t in place (a click with the zoom tool) */
  | { kind: 'zoomAt'; t: number; factor: number }
  | { kind: 'select'; id: string }

/** What `releaseOutcome` needs to know about the plot */
export interface ReleaseContext {
  /** The pointer where it was released, and whether Alt is held (no snapping) */
  pointer: { x: number; y: number; alt: boolean }
  /** The pointer moved since it was pressed (a click that moves is not a click) */
  moved: boolean
  tool: Tool
  /** Where everything is on the plot */
  frame: PlotFrame
  selected?: string
  /** A time moved onto an edge of the selected trace (markers, region edges), unless `alt` */
  snap: (t: number, alt: boolean) => number
  /** The edge of a channel's trace nearest to a time, if there is one within reach */
  snapEdge: (channel: string, t: number) => number | undefined
}

/**
 * What releasing a drag does. Rectangles are what they were started as (a later tool change does not turn a
 * box into a zoom); drags shorter than MIN_BOX_PX count as clicks, which with the zoom tool zoom in (Alt: out),
 * with the marker and note tools place one, and with the pan tool select the trace under the pointer.
 */
export function releaseOutcome(d: Drag, c: ReleaseContext): Release {
  const { x, y, alt } = c.pointer
  const { frame } = c
  const wide = (a: number, b: number) => Math.abs(a - b) >= MIN_BOX_PX
  const { clampX, xToT } = frame
  const none: Release = { kind: 'none' }
  const zoomTo = (a: number, b: number, patches?: { id: string; patch: DisplayPatch }[]): Release => ({ kind: 'zoom', window: { start: a, end: b }, patches })

  if (d.kind === 'tag') {
    // Dropped onto another view: the channel moves there, with its tag where it was dropped
    if (d.target === undefined || !frame.channels.some((ch) => ch.wave.id === d.id)) return none
    return { kind: 'dropTag', id: d.id, view: d.target, position: tagPosition(frame.divAt(d.target, y), frame.box(d.target).divPx, alt) }
  }
  if (d.kind === 'rect' && d.box) {
    if (!wide(d.x0, d.x1) || !wide(d.y0, d.y1)) return none
    const callout = boxCallout(d, { frame, selected: c.selected, snapEdge: alt ? undefined : c.snapEdge })
    return { kind: 'addCallout', callout }
  }
  if (d.kind === 'span') {
    if (d.b && wide(frame.tToX(d.a.t), frame.tToX(d.b.t))) return { kind: 'addCallout', callout: { type: 'span', t: d.a.t, t2: d.b.t, channel: d.a.ch, channel2: d.b.ch } }
    return none
  }
  if (d.kind === 'band') return wide(d.x0, d.x1) ? zoomTo(xToT(Math.min(d.x0, d.x1)), xToT(Math.max(d.x0, d.x1))) : none
  if (d.kind === 'rect') {
    if (wide(d.x0, d.x1)) {
      const t0 = xToT(Math.min(d.x0, d.x1))
      const t1 = xToT(Math.max(d.x0, d.x1))
      if (!wide(d.y0, d.y1)) return zoomTo(t0, t1)
      // Map the rectangle's vertical range onto the full height of its view
      const top = frame.divAt(d.view, Math.min(d.y0, d.y1))
      const bottom = frame.divAt(d.view, Math.max(d.y0, d.y1))
      return zoomTo(t0, t1, rectZoomPatches(frame.channels, frame.views[d.view] ?? [], top, bottom))
    }
    // A plain click with the zoom tool: zoom in 2x, Alt+click zooms out
    if (!wide(d.y0, d.y1)) return { kind: 'zoomAt', t: xToT(clampX(x)), factor: alt ? 2 : 0.5 }
    return none
  }
  if (d.kind === 'click') {
    if (c.moved) return none
    if (c.tool === 'marker') return { kind: 'addCallout', callout: { type: 'marker', t: c.snap(xToT(clampX(x)), alt) } }
    if (c.tool === 'note') {
      const yIn = Math.min(frame.viewsH - 1, Math.max(0, y))
      return { kind: 'addCallout', callout: noteAnchor(frame, xToT(clampX(x)), yIn) }
    }
    return none
  }
  if (d.kind === 'region') return wide(d.x0, d.x1) ? { kind: 'addCallout', callout: { type: 'region', t: xToT(Math.min(d.x0, d.x1)), t2: xToT(Math.max(d.x0, d.x1)) } } : none
  if (d.kind === 'pan' && !c.moved) {
    const id = nearestTrace(frame, xToT(x), y)
    return id ? { kind: 'select', id } : none
  }
  return none
}
