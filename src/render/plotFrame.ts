/**
 * The plot frame: where everything is on the plot, for one layout of it – its width, the time window,
 * the stacked views with their sizes, and the channels in them. Built once per layout and asked
 * everywhere: drawing the callouts, what a gesture means, the drag previews, the image export. So
 * every one of them maps a time to x, finds the view at a height and puts a value at a y the same way.
 *
 * Positions are in CSS pixels of the plot: x from its left edge (the time axis, without the scale
 * labels on the right), y from the top of the first view.
 *
 * Only a visible channel in a shown view has a place on the plot: for any other channel `place`,
 * `traces` and `yOf` have nothing.
 */
import type { LiveChannel, TimeWindow } from '../model/view'
import { AXIS_GUTTER, DIVS_Y, valueAt, valueToDiv } from './draw'

/** Least height of a view (px) */
export const MIN_VIEW_H = 40

/** Where the stacked views of a plot are: the top and height of each (px from the top of the plot) */
export interface ViewBoxes {
  tops: number[]
  heights: number[]
}

/** The share of each view: its size, all equal without sizes for all of them */
export function viewShares(sizes: number[] | undefined, count: number): number[] {
  const n = Math.max(1, count)
  return sizes?.length === n && sizes.every((s) => Number.isFinite(s) && s > 0) ? sizes : Array<number>(n).fill(1 / n)
}

/**
 * The views of a plot `available` px high, each its share (see viewShares) of it in whole pixels. A
 * view that is not `shown` gets no height and the others share the plot; a shown view is never lower
 * than MIN_VIEW_H, which may make them higher than the plot.
 */
export function viewBoxes(sizes: number[] | undefined, count: number, available: number, shown?: boolean[]): ViewBoxes {
  const shares = viewShares(sizes, count).map((s, i) => (shown && !shown[i] ? 0 : s))
  const sum = shares.reduce((a, b) => a + b, 0) || 1
  const tops: number[] = []
  const heights: number[] = []
  let top = 0
  let before = 0
  for (const s of shares) {
    const h = s > 0 ? Math.max(MIN_VIEW_H, Math.round((available * (before + s)) / sum) - Math.round((available * before) / sum)) : 0
    tops.push(top)
    heights.push(h)
    top += h
    before += s
  }
  return { tops, heights }
}

/** What the frame needs to know of a channel */
export type FrameChannel = Pick<LiveChannel, 'wave' | 'display'>

/** A view's place on the plot: its top and height, and the height of one of its divisions (px) */
export interface ViewBox {
  top: number
  h: number
  divPx: number
}

export interface PlotFrame<C extends FrameChannel = LiveChannel> {
  readonly win: TimeWindow
  /** Width of the plot without the scale labels */
  readonly plotW: number
  /** Height of all the views together */
  readonly viewsH: number
  readonly views: string[][]
  readonly channels: C[]
  /** Top and height of every view (a view left out has no height) */
  readonly boxes: ViewBoxes
  /** The views the plot shows, top to bottom */
  readonly shown: number[]
  tToX(t: number): number
  xToT(x: number): number
  /** x kept on the plot: from its left edge to the scale labels */
  clampX(x: number): number
  /** The shown view at height y; above the first the first, below the last the last */
  viewAt(y: number): number
  /** View `view` (clamped to the views there are) */
  box(view: number): ViewBox
  /** The view a channel is in, or -1 */
  viewOf(id: string | undefined): number
  /** A visible channel in a shown view, with its view and the view's place */
  place(id: string | undefined): ({ ch: C; view: number } & ViewBox) | undefined
  /** The visible channels of a shown view, in the order of the view */
  traces(view: number): C[]
  /** Height of a channel's trace at time t; undefined without a place or a value there */
  yOf(id: string | undefined, t: number): number | undefined
  /** Height of a value of a channel; undefined without a place */
  yOfValue(id: string | undefined, v: number): number | undefined
  /** The level at height y in a view, in divisions from its centre (up is positive) */
  divAt(view: number, y: number): number
  /** The height of a level of a view (divisions from its centre) */
  yOfDiv(view: number, div: number): number
}

export interface PlotFrameInput<C extends FrameChannel> {
  /** Width of the plot with its scale labels */
  width: number
  /** Height the views share (the plot without its time axis) */
  height: number
  win: TimeWindow
  views: string[][]
  /** Shares of the views (see viewShares) and which of them are shown */
  sizes?: number[]
  shown?: boolean[]
  channels: C[]
}

export function plotFrame<C extends FrameChannel>(o: PlotFrameInput<C>): PlotFrame<C> {
  const { win, views, channels } = o
  const boxes = viewBoxes(o.sizes, Math.max(1, views.length), o.height, o.shown)
  const plotW = o.width - AXIS_GUTTER
  const span = win.end - win.start
  const viewsH = boxes.tops[boxes.tops.length - 1] + boxes.heights[boxes.heights.length - 1]
  const shown = boxes.heights.flatMap((h, i) => (h > 0 ? [i] : []))
  const byId = new Map(channels.map((c) => [c.wave.id, c]))
  const viewById = new Map<string, number>()
  views.forEach((ids, vi) => ids.forEach((id) => viewById.has(id) || viewById.set(id, vi)))

  const box = (view: number): ViewBox => {
    const v = Math.min(boxes.heights.length - 1, Math.max(0, view))
    return { top: boxes.tops[v], h: boxes.heights[v], divPx: boxes.heights[v] / DIVS_Y }
  }
  const yOfDiv = (view: number, div: number) => {
    const b = box(view)
    return b.top + b.h / 2 - div * b.divPx
  }
  const place = (id: string | undefined) => {
    const ch = id === undefined ? undefined : byId.get(id)
    const view = id === undefined ? -1 : (viewById.get(id) ?? -1)
    if (!ch || !ch.display.visible || view < 0 || !boxes.heights[view]) return undefined
    return { ch, view, ...box(view) }
  }
  const yOfValue = (id: string | undefined, v: number) => {
    const at = place(id)
    return at && Number.isFinite(v) ? yOfDiv(at.view, valueToDiv(v, at.ch.display)) : undefined
  }

  return {
    win,
    plotW,
    viewsH,
    views,
    channels,
    boxes,
    shown,
    tToX: (t) => ((t - win.start) / span) * plotW,
    xToT: (x) => win.start + (x / plotW) * span,
    clampX: (x) => Math.min(plotW, Math.max(0, x)),
    viewAt: (y) => {
      let at = -1
      boxes.tops.forEach((top, i) => {
        if (boxes.heights[i] > 0 && (at < 0 || y >= top)) at = i
      })
      return Math.max(0, at)
    },
    box,
    viewOf: (id) => (id === undefined ? -1 : (viewById.get(id) ?? -1)),
    place,
    traces: (view) => (boxes.heights[view] ? (views[view] ?? []).flatMap((id) => (place(id)?.view === view ? [byId.get(id)!] : [])) : []),
    yOf: (id, t) => {
      const ch = id === undefined ? undefined : byId.get(id)
      return ch ? yOfValue(id, valueAt(ch.wave, t)) : undefined
    },
    yOfValue,
    divAt: (view, y) => {
      const b = box(view)
      return DIVS_Y / 2 - (y - b.top) / b.divPx
    },
    yOfDiv,
  }
}
