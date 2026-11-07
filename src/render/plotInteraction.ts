/**
 * What a pointer gesture in the plot means, as pure functions: which trace is meant, which trace a
 * box belongs to, where a note is anchored, what a released drag does. The plot component (PlotArea)
 * keeps the events, the state and the drawing, and applies what these decide; so the rules of each
 * tool can be tested without a browser.
 *
 * Positions are in CSS pixels of the plot: x from its left edge (the time axis), y from the top of the
 * first view (the views are stacked, `ViewBoxes` says where each one is).
 */
import type { NewCallout } from '../model/callouts'
import { snapToGrid, zoomAround, type CursorState, type DisplayPatch, type LiveChannel, type TimeWindow, type Tool } from '../model/view'
import { DIVS_Y, divToValue, valueAt, valueToDiv, viewAt, type ViewBoxes } from './draw'

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

/** The level at plot height `y` in view `view`, in divisions from the centre of that view (up is positive) */
export function divAtY(boxes: ViewBoxes, view: number, y: number): number {
  return DIVS_Y / 2 - (y - boxes.tops[view]) / (boxes.heights[view] / DIVS_Y)
}

/**
 * The visible trace of the view at height `y` that passes closest to the pointer at time `t`, within
 * `maxPx`; undefined when none does. Traces without a value at `t` are not considered.
 */
export function nearestTrace(channels: Pick<LiveChannel, 'wave' | 'display'>[], views: string[][], boxes: ViewBoxes, t: number, y: number, maxPx = 20): string | undefined {
  const vi = viewAt(boxes, y)
  const height = boxes.heights[vi]
  const yIn = y - boxes.tops[vi]
  let best: string | undefined
  let bestD = maxPx
  for (const id of views[vi] ?? []) {
    const c = channels.find((ch) => ch.wave.id === id)
    if (!c || !c.display.visible) continue
    const v = valueAt(c.wave, t)
    if (!Number.isFinite(v)) continue
    const dist = Math.abs(height / 2 - valueToDiv(v, c.display) * (height / DIVS_Y) - yIn)
    if (dist < bestD) {
      bestD = dist
      best = id
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
  o: { traces: LiveChannel[]; boxes: ViewBoxes; xToT: (x: number) => number; selected?: string; snapEdge?: (channel: string, t: number) => number | undefined },
): NewCallout {
  const { traces, boxes, selected } = o
  const top = divAtY(boxes, rect.view, Math.min(rect.y0, rect.y1))
  const bottom = divAtY(boxes, rect.view, Math.max(rect.y0, rect.y1))
  const ta = o.xToT(Math.min(rect.x0, rect.x1))
  const tb = o.xToT(Math.max(rect.x0, rect.x1))
  const range: [number, number] = [0, 0]
  const through = traces.filter(({ wave: w, display, pyramid }) => {
    pyramid.range(Math.floor((ta - w.t0) / w.dt), Math.ceil((tb - w.t0) / w.dt) + 1, range)
    return range[1] >= divToValue(bottom, display) && range[0] <= divToValue(top, display)
  })
  // Distance of a trace from the centre of the box (px)
  const height = boxes.heights[rect.view]
  const divPx = height / DIVS_Y
  const midT = (ta + tb) / 2
  const midY = (rect.y0 + rect.y1) / 2 - boxes.tops[rect.view]
  const distance = (c: LiveChannel) => Math.abs(height / 2 - valueToDiv(valueAt(c.wave, midT), c.display) * divPx - midY)
  const closest = (list: LiveChannel[]) =>
    list.filter((c) => Number.isFinite(distance(c))).reduce<LiveChannel | undefined>((best, c) => (!best || distance(c) < distance(best) ? c : best), undefined)
  const selectedIn = (list: LiveChannel[]) => list.find((c) => c.wave.id === selected)
  const ch = selectedIn(through) ?? closest(through) ?? selectedIn(traces) ?? closest(traces)
  const at = (x: number) => {
    const t = o.xToT(x)
    return !ch || !o.snapEdge ? t : (o.snapEdge(ch.wave.id, t) ?? t)
  }
  const t = at(Math.min(rect.x0, rect.x1))
  const t2 = at(Math.max(rect.x0, rect.x1))
  if (!ch) return { type: 'box', t, t2, view: rect.view, div: top, div2: bottom }
  const round = (v: number) => parseFloat(v.toPrecision(6))
  return { type: 'box', t, t2, channel: ch.wave.id, v: round(divToValue(top, ch.display)), v2: round(divToValue(bottom, ch.display)) }
}

/** Where the note tool puts a note at (x, y): on the nearest trace (within 40 px), otherwise at that spot of the view */
export function noteAnchor(o: { channels: LiveChannel[]; views: string[][]; boxes: ViewBoxes; t: number; y: number }): NewCallout {
  const ch = nearestTrace(o.channels, o.views, o.boxes, o.t, o.y, 40)
  const view = viewAt(o.boxes, o.y)
  // The text box goes below the anchor near the top of the plot, above it elsewhere
  const dy = o.y < 70 ? 24 : -46
  if (ch) return { type: 'note', t: o.t, channel: ch, dy }
  return { type: 'note', t: o.t, view, div: divAtY(o.boxes, view, o.y), dy }
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
  /** Show this window, and set the vertical settings of channels (a zoom rectangle) */
  | { kind: 'zoom'; window: TimeWindow; patches?: { id: string; patch: DisplayPatch }[] }
  | { kind: 'select'; id: string }

/** What `releaseOutcome` needs to know about the plot */
export interface ReleaseContext {
  /** The pointer where it was released, and whether Alt is held (no snapping) */
  pointer: { x: number; y: number; alt: boolean }
  /** The pointer moved since it was pressed (a click that moves is not a click) */
  moved: boolean
  tool: Tool
  win: TimeWindow
  minSpan: number
  maxSpan: number
  /** Width of the plot without the scale labels, and the height of all its views */
  plotW: number
  viewsH: number
  boxes: ViewBoxes
  views: string[][]
  /** Everything that has a waveform, and the visible traces of one view */
  channels: LiveChannel[]
  viewTraces: (view: number) => LiveChannel[]
  selected?: string
  xToT: (x: number) => number
  tToX: (t: number) => number
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
  const wide = (a: number, b: number) => Math.abs(a - b) >= MIN_BOX_PX
  const clampX = (v: number) => Math.min(c.plotW, Math.max(0, v))
  const none: Release = { kind: 'none' }
  const zoomTo = (a: number, b: number, patches?: { id: string; patch: DisplayPatch }[]): Release => {
    const span = Math.max(b - a, c.minSpan)
    const mid = (a + b) / 2
    return { kind: 'zoom', window: { start: mid - span / 2, end: mid + span / 2 }, patches }
  }

  if (d.kind === 'tag') {
    // Dropped onto another view: the channel moves there, with its tag where it was dropped
    if (d.target === undefined || !c.channels.some((ch) => ch.wave.id === d.id)) return none
    return { kind: 'dropTag', id: d.id, view: d.target, position: tagPosition(divAtY(c.boxes, d.target, y), c.boxes.heights[d.target] / DIVS_Y, alt) }
  }
  if (d.kind === 'rect' && d.box) {
    if (!wide(d.x0, d.x1) || !wide(d.y0, d.y1)) return none
    const callout = boxCallout(d, { traces: c.viewTraces(d.view), boxes: c.boxes, xToT: c.xToT, selected: c.selected, snapEdge: alt ? undefined : c.snapEdge })
    return { kind: 'addCallout', callout }
  }
  if (d.kind === 'span') {
    if (d.b && wide(c.tToX(d.a.t), c.tToX(d.b.t))) return { kind: 'addCallout', callout: { type: 'span', t: d.a.t, t2: d.b.t, channel: d.a.ch, channel2: d.b.ch } }
    return none
  }
  if (d.kind === 'band') return wide(d.x0, d.x1) ? zoomTo(c.xToT(Math.min(d.x0, d.x1)), c.xToT(Math.max(d.x0, d.x1))) : none
  if (d.kind === 'rect') {
    if (wide(d.x0, d.x1)) {
      const t0 = c.xToT(Math.min(d.x0, d.x1))
      const t1 = c.xToT(Math.max(d.x0, d.x1))
      if (!wide(d.y0, d.y1)) return zoomTo(t0, t1)
      // Map the rectangle's vertical range onto the full height of its view
      const top = divAtY(c.boxes, d.view, Math.min(d.y0, d.y1))
      const bottom = divAtY(c.boxes, d.view, Math.max(d.y0, d.y1))
      return zoomTo(t0, t1, rectZoomPatches(c.channels, c.views[d.view] ?? [], top, bottom))
    }
    // A plain click with the zoom tool: zoom in 2x, Alt+click zooms out
    if (!wide(d.y0, d.y1)) return { kind: 'zoom', window: zoomAround(c.win, c.xToT(clampX(x)), alt ? 2 : 0.5, c.minSpan, c.maxSpan) }
    return none
  }
  if (d.kind === 'click') {
    if (c.moved) return none
    if (c.tool === 'marker') return { kind: 'addCallout', callout: { type: 'marker', t: c.snap(c.xToT(clampX(x)), alt) } }
    if (c.tool === 'note') {
      const yIn = Math.min(c.viewsH - 1, Math.max(0, y))
      return { kind: 'addCallout', callout: noteAnchor({ channels: c.channels, views: c.views, boxes: c.boxes, t: c.xToT(clampX(x)), y: yIn }) }
    }
    return none
  }
  if (d.kind === 'region') return wide(d.x0, d.x1) ? { kind: 'addCallout', callout: { type: 'region', t: c.xToT(Math.min(d.x0, d.x1)), t2: c.xToT(Math.max(d.x0, d.x1)) } } : none
  if (d.kind === 'pan' && !c.moved) {
    const id = nearestTrace(c.channels, c.views, c.boxes, c.xToT(x), y)
    return id ? { kind: 'select', id } : none
  }
  return none
}
