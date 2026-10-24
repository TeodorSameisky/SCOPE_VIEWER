import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { edgeLevels, nearestEdge, type EdgeLevels } from '../dsp/edges'
import type { PlotImageSource } from '../export/sessionExport'
import { DEFAULT_CALLOUT_COLOR, calloutSpan, type Callout } from '../model/callouts'
import { calloutsSvg, flagsBottom, layoutCallouts } from '../render/callouts'
import {
  AXIS_GUTTER,
  DIVS_Y,
  divToValue,
  drawTimeAxis,
  drawView,
  layoutTags,
  positionForZeroAt,
  tagAt,
  valueAt,
  valueToDiv,
  type ViewDrawOptions,
} from '../render/draw'
import { PLOT_FONT, SANS, font } from '../render/fonts'
import { loadTex, useTexVersion } from '../render/tex'
import type { Theme } from '../render/theme'
import { si } from '../util/format'
import { channelName, displayUnit } from '../util/names'
import { CalloutLayer } from './CalloutLayer'
import { useTheme } from './ui/themeContext'
import { panShare, wheelPan, wheelPixels, wheelZoomFactor } from './ui/wheel'
import {
  POSITION_STEP,
  snapToGrid,
  stepPosition,
  stepScale,
  timeTicks,
  zoomAround,
  type CursorState,
  type DisplayPatch,
  type LiveChannel,
  type NavKind,
  type TimeWindow,
  type Tool,
} from '../model/view'

const AXIS_H = 24
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const GRAB_PX = 8
const MIN_BOX_PX = 5
/** Markers and region edges snap to an edge of the selected trace this close to the pointer */
const SNAP_PX = 8
/** Wheel delta (px) of one step of V/div or position: about one notch of a mouse wheel */
const WHEEL_STEP = 40
/** Top of the cursor readout box: below the cursor labels, and below the marker flags if there are any */
const readoutTop = (flags: number) => Math.max(22, flags + 6)

/** What is under the pointer when the plot is right-clicked */
export interface PlotPoint {
  t: number
  /** On the time axis below the views */
  onAxis: boolean
  /** Trace under the pointer */
  channel?: string
  /** The note the Note tool would add at this point */
  note?: NewCallout
  /** Time of an edge of the selected trace next to the pointer (not with Alt) */
  edgeT?: number
}

export type NewCallout = Pick<Callout, 'type' | 't' | 't2' | 'channel' | 'channel2' | 'v' | 'v2' | 'view' | 'div' | 'div2' | 'dy'>

interface Props {
  channels: LiveChannel[]
  views: string[][]
  win: TimeWindow
  record: TimeWindow
  minSpan: number
  tool: Tool
  /** Short instruction shown while a non-default tool is active */
  hint?: string
  /** Show the values of all channels at the pointer */
  readout: boolean
  /** Continuous navigation (wheel, pan) */
  onNavigate: (w: TimeWindow, kind: NavKind) => void
  /** Discrete zoom, optionally with new vertical settings for some channels */
  onZoomTo: (w: TimeWindow, patches?: { id: string; patch: DisplayPatch }[]) => void
  cursors: CursorState
  setCursors: (c: CursorState) => void
  selected?: string
  setSelected: (id: string) => void
  trigger?: { source: string; level?: number }
  onAdjust: (id: string, patch: DisplayPatch) => void
  /** A channel tag was dropped onto another view */
  onMoveToView: (id: string, view: number) => void
  /** Double-click on a channel tag */
  onChannelSettings?: (id: string) => void
  /** Right-click on a channel tag */
  onChannelMenu?: (e: React.MouseEvent, id: string) => void
  callouts: Callout[]
  selectedCallout?: string
  editingCallout?: string
  onSelectCallout: (id: string | undefined) => void
  onAddCallout: (c: NewCallout) => void
  onUpdateCallout: (id: string, patch: Partial<Callout>) => void
  onEditCallout: (id: string | null) => void
  onDeleteCallout: (id: string) => void
  onContextMenu?: (e: React.MouseEvent, at: PlotPoint) => void
  onCalloutMenu?: (e: React.MouseEvent, c: Callout) => void
  /** Go to a callout (the counters of callouts outside the view) */
  onJumpToCallout: (c: Callout) => void
}

export interface PlotAreaHandle extends PlotImageSource {
  /** Current size of the plot (CSS pixels) */
  size: () => { w: number; h: number }
}

/** What a press in the plot does until the pointer is released (Esc or a cancelled pointer drops it) */
type Drag =
  | { kind: 'pan'; x0: number; win: TimeWindow }
  | { kind: 'cursor'; which: 'a' | 'b'; orig: CursorState }
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
   * channel there on release. `zero0`: the channel's 0 level (div) when the drag started.
   */
  | { kind: 'tag'; id: string; view: number; y0: number; x: number; y: number; zero0: number; pos0: number; moved: boolean; target?: number }

export const PlotArea = forwardRef<PlotAreaHandle, Props>(function PlotArea(p, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const axisRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  /** Pointer position over the plot (CSS pixels) */
  const [hover, setHover] = useState<{ x: number; y: number; alt: boolean } | undefined>()
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragMoved = useRef(false)

  const nViews = Math.max(1, p.views.length)
  const viewH = Math.max(40, Math.floor((size.h - AXIS_H) / nViews))
  const viewsH = viewH * nViews
  const divH = viewH / DIVS_Y
  const plotW = size.w - AXIS_GUTTER
  const span = p.win.end - p.win.start
  const maxSpan = (p.record.end - p.record.start) * 4
  const xToT = useCallback((x: number) => p.win.start + (x / plotW) * span, [p.win.start, plotW, span])
  const tToX = useCallback((t: number) => ((t - p.win.start) / span) * plotW, [p.win.start, plotW, span])
  const clampX = (x: number) => Math.min(plotW, Math.max(0, x))

  /** The visible trace of the view at y that passes closest to (x, y), within maxPx */
  const nearestTrace = (x: number, y: number, maxPx = 20): string | undefined => {
    const vi = Math.min(nViews - 1, Math.floor(y / viewH))
    const yIn = y - vi * viewH
    const t = xToT(x)
    let best: string | undefined
    let bestD = maxPx
    for (const id of p.views[vi] ?? []) {
      const c = p.channels.find((ch) => ch.wave.id === id)
      if (!c || !c.display.visible) continue
      const v = valueAt(c.wave, t)
      if (!Number.isFinite(v)) continue
      const dist = Math.abs(viewH / 2 - valueToDiv(v, c.display) * divH - yIn)
      if (dist < bestD) {
        bestD = dist
        best = id
      }
    }
    return best
  }

  /**
   * Edge finder of a trace: the time of its edge nearest to t (within SNAP_PX), or undefined. The
   * reference levels come from the samples on screen and are worked out on first use.
   */
  const edgesOf = useMemo(() => {
    const finders = new Map<string, (t: number) => number | undefined>()
    return (id: string | undefined): ((t: number) => number | undefined) => {
      const ch = p.channels.find((c) => c.wave.id === id && c.display.visible)
      if (!ch) return () => undefined
      let find = finders.get(ch.wave.id)
      if (!find) {
        const w = ch.wave
        const i0 = Math.max(0, Math.floor((p.win.start - w.t0) / w.dt))
        const i1 = Math.min(w.data.length, Math.ceil((p.win.end - w.t0) / w.dt) + 1)
        const maxN = (SNAP_PX * (p.win.end - p.win.start)) / Math.max(1, plotW) / w.dt
        let levels: EdgeLevels | undefined | null = null
        find = (t: number): number | undefined => {
          if (levels === null) levels = edgeLevels(w.data, i0, i1)
          if (!levels) return undefined
          const x = nearestEdge(w.data, (t - w.t0) / w.dt, maxN, levels, i0, i1)
          return x === undefined ? undefined : w.t0 + x * w.dt
        }
        finders.set(ch.wave.id, find)
      }
      return find
    }
  }, [p.channels, p.win, plotW])
  /** Markers and the edges of regions snap to edges of the selected trace */
  const edgeNear = useMemo(() => edgesOf(p.selected), [edgesOf, p.selected])
  /** Markers and region edges snap to edges; Alt places them freely */
  const snapT = (t: number, alt: boolean) => (alt ? t : (edgeNear(t) ?? t))
  const snapX = (x: number, alt: boolean) => tToX(snapT(xToT(x), alt))
  /** An end of a new span at (x, y): on the nearest trace of that view, at its edge next to x (Alt: at x) */
  const spanEndAt = (x: number, y: number, free: boolean): { ch: string; t: number } | undefined => {
    if (y < 0 || y >= viewsH) return undefined
    const ch = nearestTrace(x, y, viewH)
    if (!ch) return undefined
    const t = xToT(clampX(x))
    return { ch, t: free ? t : (edgesOf(ch)(t) ?? t) }
  }

  const pointerT = hover && hover.x >= 0 && hover.x <= plotW ? xToT(hover.x) : undefined
  // With the Marker, Region and Span tools the hover line shows where a click would put the edge
  const hoverT =
    pointerT === undefined
      ? undefined
      : p.tool === 'marker' || p.tool === 'region'
        ? snapT(pointerT, hover!.alt)
        : p.tool === 'span'
          ? (spanEndAt(hover!.x, hover!.y, hover!.alt)?.t ?? pointerT)
          : pointerT
  // Callout geometry (formulas render asynchronously: lay out again when one is ready)
  const texVersion = useTexVersion()
  const { theme } = useTheme()
  // Laid out again only when something it depends on changes (not on every pointer move)
  const calloutGeo = useMemo(
    () => layoutCallouts(p.callouts, { channels: p.channels, views: p.views, win: p.win, plotW, viewH }),
    // texVersion: a formula has been rendered meanwhile
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.callouts, p.channels, p.views, p.win, plotW, viewH, texVersion],
  )

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const byId = useMemo(() => new Map(p.channels.map((c) => [c.wave.id, c])), [p.channels])
  /** The visible channels of view `vi`, and the one its scale labels are for: the selected one, else the first */
  const viewChannels = (vi: number) => {
    const traces = (p.views[vi] ?? []).map((id) => byId.get(id)).filter((c): c is LiveChannel => !!c && c.display.visible)
    return { traces, axis: traces.find((t) => t.display.id === p.selected) ?? traces[0] }
  }
  /** The channel tag at (x, y) on the left edge of a view, and that view */
  const tagUnder = (x: number, y: number): { id: string; view: number } | undefined => {
    if (y < 0 || y >= viewsH) return undefined
    const view = Math.floor(y / viewH)
    const tag = tagAt(layoutTags(viewChannels(view).traces.map((t) => t.display), viewH), x, y - view * viewH)
    return tag && { id: tag.display.id, view }
  }

  // Discrete settings (V/div, position) change one step per wheel notch; trackpads add up small deltas
  const wheelAcc = useRef(0)
  const wheelStep = (delta: number): -1 | 0 | 1 => {
    if (Math.abs(delta) < WHEEL_STEP) {
      wheelAcc.current += delta
      if (Math.abs(wheelAcc.current) < WHEEL_STEP) return 0
      delta = wheelAcc.current
    }
    wheelAcc.current = 0
    return delta > 0 ? 1 : -1
  }

  const ticks = timeTicks(p.win)
  /** Drawing options of view `vi` that are the same on screen and in exports */
  const viewOptions = (vi: number, dpr: number, theme: Theme): ViewDrawOptions => {
    const { traces, axis } = viewChannels(vi)
    return {
      width: size.w,
      height: viewH,
      dpr,
      tStart: p.win.start,
      tEnd: p.win.end,
      timeTicks: ticks,
      traces,
      axisChannel: axis,
      cursors: p.cursors.on ? { a: p.cursors.a, b: p.cursors.b, sourceId: p.cursors.source, showLabels: vi === 0 } : undefined,
      trigger: { sourceId: p.trigger?.source, level: p.trigger?.level, showMarker: true },
      theme,
    }
  }

  // Draw everything on the next animation frame whenever inputs change
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1
      p.views.forEach((_, vi) => {
        const ctx = canvasRefs.current[vi]?.getContext('2d')
        if (!ctx) return
        drawView(ctx, { ...viewOptions(vi, dpr, theme), selectedId: p.selected, hoverT: drag ? undefined : hoverT, hoverDots: p.readout })
        drawDragPreview(ctx, dpr, vi)
      })
      const ax = axisRef.current?.getContext('2d')
      if (ax) drawTimeAxis(ax, size.w, AXIS_H, dpr, p.win.start, p.win.end, ticks, theme)
    })
    return () => cancelAnimationFrame(id)
    // viewOptions and drawDragPreview only read the props and state listed here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.channels, p.views, p.win, p.cursors, p.selected, p.trigger, p.readout, size, viewH, hoverT, drag, theme])

  /** Rubber band for zoom / region selection; the level or the drop target of a dragged channel tag */
  const drawDragPreview = (ctx: CanvasRenderingContext2D, dpr: number, vi: number) => {
    if (drag?.kind === 'tag') return drawTagDrag(ctx, dpr, vi)
    if (drag?.kind === 'span') return drawSpanDrag(ctx, dpr, vi)
    if (!drag || (drag.kind !== 'band' && drag.kind !== 'rect' && drag.kind !== 'region')) return
    if (drag.kind === 'rect' && drag.view !== vi) return
    const x0 = Math.min(drag.x0, drag.x1)
    const x1 = Math.max(drag.x0, drag.x1)
    let y0 = 0
    let y1 = viewH
    if (drag.kind === 'rect') {
      y0 = Math.min(drag.y0, drag.y1) - vi * viewH
      y1 = Math.max(drag.y0, drag.y1) - vi * viewH
    }
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // A new region has a solid edge, a zoom range a dashed one
    ctx.fillStyle = theme.bandFill
    ctx.strokeStyle = theme.band
    ctx.setLineDash(drag.kind === 'region' ? [] : [4, 3])
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0 - 1)
    if (vi === 0 || drag.kind === 'rect') {
      ctx.setLineDash([])
      ctx.font = font(11, SANS)
      ctx.fillStyle = theme.bandText
      ctx.textBaseline = 'top'
      ctx.fillText(si(Math.abs(xToT(drag.x1) - xToT(drag.x0)), 's'), x0 + 4, y0 + 4)
    }
    ctx.restore()
  }

  /** A new span while it is dragged: from its first end to where the second would go, with Δt */
  const drawSpanDrag = (ctx: CanvasRenderingContext2D, dpr: number, vi: number) => {
    if (drag?.kind !== 'span' || !drag.b) return
    // The ends on their traces, in plot coordinates (each view's canvas shows its part)
    const end = ({ ch, t }: { ch: string; t: number }) => {
      const c = byId.get(ch)
      const view = p.views.findIndex((v) => v.includes(ch))
      const v = c ? valueAt(c.wave, t) : NaN
      return c && view >= 0 && Number.isFinite(v) ? { x: tToX(t), y: view * viewH + viewH / 2 - valueToDiv(v, c.display) * divH } : undefined
    }
    const a = end(drag.a)
    const b = end(drag.b)
    if (!a || !b) return
    const ink = theme.ink(DEFAULT_CALLOUT_COLOR.span)
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, -vi * viewH * dpr)
    ctx.strokeStyle = ink
    ctx.fillStyle = ink
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    for (const pt of [a, b]) {
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.font = font(12, SANS)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(`Δt ${si(drag.b.t - drag.a.t, 's')}`, (a.x + b.x) / 2, Math.min(a.y, b.y) - 6)
    ctx.restore()
  }

  /** While a tag is dragged: a dashed line at the channel's 0 level, or the view it would move to */
  const drawTagDrag = (ctx: CanvasRenderingContext2D, dpr: number, vi: number) => {
    if (drag?.kind !== 'tag') return
    const ch = byId.get(drag.id)
    if (!ch || !drag.moved) return
    const line = (y: number) => {
      ctx.beginPath()
      ctx.moveTo(0, Math.round(y) + 0.5)
      ctx.lineTo(plotW, Math.round(y) + 0.5)
      ctx.stroke()
    }
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.strokeStyle = theme.ink(ch.display.color)
    ctx.lineWidth = 1
    ctx.setLineDash([5, 4])
    if (drag.target === undefined && vi === drag.view) {
      const y = viewH / 2 - valueToDiv(0, ch.display) * divH
      if (y >= 0 && y <= viewH) line(y)
    } else if (drag.target === vi) {
      ctx.fillStyle = theme.bandFill
      ctx.fillRect(0, 0, plotW, viewH)
      line(drag.y - vi * viewH)
      ctx.strokeStyle = theme.band
      ctx.strokeRect(0.5, 0.5, plotW - 1, viewH - 1)
    }
    ctx.restore()
  }

  useImperativeHandle(ref, () => ({
    size: () => size,
    renderImage: async (scale: number, theme: Theme) => {
      const out = document.createElement('canvas')
      out.width = Math.round(size.w * scale)
      out.height = Math.round((viewsH + AXIS_H) * scale)
      const ctx = out.getContext('2d')!
      // Redraw each view at the export resolution (no hover line or rubber band)
      p.views.forEach((_, vi) => {
        const cv = document.createElement('canvas')
        cv.width = out.width
        cv.height = Math.round(viewH * scale)
        drawView(cv.getContext('2d')!, viewOptions(vi, scale, theme))
        ctx.drawImage(cv, 0, Math.round(vi * viewH * scale))
      })
      const ax = document.createElement('canvas')
      ax.width = out.width
      ax.height = Math.round(AXIS_H * scale)
      drawTimeAxis(ax.getContext('2d')!, size.w, AXIS_H, scale, p.win.start, p.win.end, ticks, theme)
      ctx.drawImage(ax, 0, Math.round(viewsH * scale))
      // Callouts are vector graphics: rasterised directly at the export resolution
      let flags = 0
      if (p.callouts.length) {
        await loadTex(p.callouts.map((c) => c.text))
        const layout = { channels: p.channels, views: p.views, win: p.win, plotW, viewH }
        const geo = layoutCallouts(p.callouts, layout)
        flags = flagsBottom(geo)
        const img = await svgToImage(calloutsSvg(p.callouts, layout, theme, geo))
        if (img) ctx.drawImage(img, 0, 0, plotW * scale, viewsH * scale)
      }
      if (p.cursors.on) drawCursorReadout(ctx, scale, p, tToX, theme, readoutTop(flags))
      return out
    },
  }))

  // Wheel: zoom time around the mouse. On a channel tag or a view's scale labels: V/div of that
  // channel; Ctrl = V/div of the selected channel, Alt = its position
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.callout-editor')) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const delta = wheelPixels(e).y
      const onTag = tagUnder(x, y)
      const pointed = onTag ? byId.get(onTag.id) : x > plotW && y >= 0 && y < viewsH ? viewChannels(Math.floor(y / viewH)).axis : undefined
      if (pointed && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const step = wheelStep(delta)
        if (step) p.onAdjust(pointed.wave.id, { scale: stepScale(pointed.display.scale, step) })
        return
      }
      if ((e.ctrlKey || e.altKey) && p.selected) {
        const ch = byId.get(p.selected)
        const step = wheelStep(delta)
        if (!ch || !step) return
        if (e.ctrlKey) p.onAdjust(ch.wave.id, { scale: stepScale(ch.display.scale, step) })
        else p.onAdjust(ch.wave.id, { position: stepPosition(ch.display.position, -step * POSITION_STEP) })
        return
      }
      // Shift+wheel or a sideways swipe pans, the wheel zooms
      const pan = wheelPan(e)
      if (pan !== undefined) {
        const shift = span * panShare(pan)
        if (shift) p.onNavigate({ start: p.win.start + shift, end: p.win.end + shift }, 'pan')
        return
      }
      const t = xToT(Math.min(plotW, Math.max(0, x)))
      p.onNavigate(zoomAround(p.win, t, wheelZoomFactor(delta), p.minSpan, maxSpan), 'wheel')
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // tagUnder, viewChannels and wheelStep only read the props and sizes listed here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, byId, span, plotW, viewH, viewsH, xToT, maxSpan])

  const local = (e: { clientX: number; clientY: number }) => {
    const r = containerRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const clampY = (y: number, view: number) => Math.min((view + 1) * viewH, Math.max(view * viewH, y))

  const onPointerDown = (e: React.PointerEvent) => {
    // Middle button pans with every tool; Ctrl+click on a Mac opens the context menu
    const middle = e.button === 1
    if ((e.button !== 0 && !middle) || (e.ctrlKey && IS_MAC)) return
    const { x, y } = local(e)
    if (x > plotW) return
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // synthetic events have no active pointer
    }
    dragMoved.current = false
    if (middle) {
      e.preventDefault()
      setDrag({ kind: 'pan', x0: x, win: p.win })
      return
    }
    p.onSelectCallout(undefined)
    // A channel tag is a handle with every tool: pressing selects the channel, dragging moves it
    const onTag = tagUnder(x, y)
    const tagged = onTag && byId.get(onTag.id)
    if (onTag && tagged) {
      p.setSelected(onTag.id)
      const d = tagged.display
      setDrag({ kind: 'tag', id: onTag.id, view: onTag.view, y0: y, x, y, zero0: valueToDiv(0, d), pos0: d.position, moved: false })
      return
    }
    const onAxis = y > viewsH
    const navTool = p.tool === 'pan' || p.tool === 'zoom'

    if (navTool && !onAxis && p.cursors.on) {
      const da = Math.abs(tToX(p.cursors.a) - x)
      const db = Math.abs(tToX(p.cursors.b) - x)
      if (Math.min(da, db) < GRAB_PX) {
        setDrag({ kind: 'cursor', which: da <= db ? 'a' : 'b', orig: p.cursors })
        return
      }
    }
    // Dragging along the time axis always marks a time range to zoom into
    if (onAxis || (navTool && e.shiftKey)) setDrag({ kind: 'band', x0: x, x1: x })
    else if (p.tool === 'pan') setDrag({ kind: 'pan', x0: x, win: p.win })
    else if (p.tool === 'zoom' || p.tool === 'box') {
      const view = Math.min(nViews - 1, Math.floor(y / viewH))
      setDrag({ kind: 'rect', box: p.tool === 'box', view, x0: x, y0: y, x1: x, y1: y })
    } else if (p.tool === 'region') {
      const xs = snapX(clampX(x), e.altKey)
      setDrag({ kind: 'region', x0: xs, x1: xs })
    } else if (p.tool === 'span') {
      const a = spanEndAt(x, y, e.altKey)
      if (a) setDrag({ kind: 'span', a })
    } else setDrag({ kind: 'click', x0: x, y0: y })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = local(e)
    setHover({ x, y, alt: e.altKey })
    if (!drag) return
    if (drag.kind === 'click') {
      if (Math.hypot(x - drag.x0, y - drag.y0) > 3) dragMoved.current = true
      return
    }
    if (drag.kind === 'tag') return moveTag(drag, x, y, e.altKey)
    dragMoved.current = true
    switch (drag.kind) {
      case 'pan': {
        const dt = ((x - drag.x0) / plotW) * (drag.win.end - drag.win.start)
        p.onNavigate({ start: drag.win.start - dt, end: drag.win.end - dt }, 'pan')
        break
      }
      case 'cursor':
        p.setCursors({ ...p.cursors, [drag.which]: xToT(clampX(x)) })
        break
      case 'band':
        setDrag({ ...drag, x1: clampX(x) })
        break
      case 'region':
        setDrag({ ...drag, x1: snapX(clampX(x), e.altKey) })
        break
      case 'rect':
        setDrag({ ...drag, x1: clampX(x), y1: clampY(y, drag.view) })
        break
      case 'span':
        setDrag({ ...drag, b: spanEndAt(x, y, e.altKey) })
        break
    }
  }

  /**
   * A new box around the rectangle dragged in a view. It belongs to a trace that runs through it:
   * the selected one if it does, else the one nearest the centre; without one, the selected trace
   * of the view or the nearest. Its time edges snap to edges of that trace (Alt: free).
   */
  const newBox = (d: Extract<Drag, { kind: 'rect' }>, free: boolean): NewCallout => {
    const divAt = (yy: number) => DIVS_Y / 2 - (yy - d.view * viewH) / divH
    const top = divAt(Math.min(d.y0, d.y1))
    const bottom = divAt(Math.max(d.y0, d.y1))
    const [ta, tb] = [xToT(Math.min(d.x0, d.x1)), xToT(Math.max(d.x0, d.x1))]
    const { traces } = viewChannels(d.view)
    const mm: [number, number] = [0, 0]
    const through = traces.filter(({ wave: w, display, pyramid }) => {
      pyramid.range(Math.floor((ta - w.t0) / w.dt), Math.ceil((tb - w.t0) / w.dt) + 1, mm)
      return mm[1] >= divToValue(bottom, display) && mm[0] <= divToValue(top, display)
    })
    // Distance of a trace from the centre of the box (px)
    const midT = (ta + tb) / 2
    const midY = (d.y0 + d.y1) / 2 - d.view * viewH
    const distance = (c: LiveChannel) => Math.abs(viewH / 2 - valueToDiv(valueAt(c.wave, midT), c.display) * divH - midY)
    const closest = (list: LiveChannel[]) =>
      list.filter((c) => Number.isFinite(distance(c))).reduce<LiveChannel | undefined>((best, c) => (!best || distance(c) < distance(best) ? c : best), undefined)
    const selectedIn = (list: LiveChannel[]) => list.find((c) => c.wave.id === p.selected)
    const ch = selectedIn(through) ?? closest(through) ?? selectedIn(traces) ?? closest(traces)
    const at = (x: number) => {
      const t = xToT(x)
      return free || !ch ? t : (edgesOf(ch.wave.id)(t) ?? t)
    }
    const t = at(Math.min(d.x0, d.x1))
    const t2 = at(Math.max(d.x0, d.x1))
    if (!ch) return { type: 'box', t, t2, view: d.view, div: top, div2: bottom }
    const round = (v: number) => parseFloat(v.toPrecision(6))
    return { type: 'box', t, t2, channel: ch.wave.id, v: round(divToValue(top, ch.display)), v2: round(divToValue(bottom, ch.display)) }
  }

  /** The 0 level (div from the centre) of a tag dragged to `y` in `view`; snapped to the grid unless `free` */
  const zeroAt = (y: number, view: number, free: boolean) => {
    const div = DIVS_Y / 2 - (y - view * viewH) / divH
    return free ? div : snapToGrid(div, divH)
  }

  /** Drag of a channel tag: up and down in its view moves the trace, over another view marks it as the target */
  const moveTag = (drag: Extract<Drag, { kind: 'tag' }>, x: number, y: number, free: boolean) => {
    // A click only selects: the trace moves once the pointer has moved a few pixels
    if (!drag.moved && Math.abs(y - drag.y0) < 3) return
    const d = byId.get(drag.id)?.display
    if (!d) return
    const over = y >= 0 && y < viewsH ? Math.floor(y / viewH) : drag.view
    if (over !== drag.view) {
      // Over another view: the trace waits where it was until it is dropped
      if (drag.target === undefined) p.onAdjust(drag.id, { position: drag.pos0 })
      setDrag({ ...drag, x, y, moved: true, target: over })
      return
    }
    const zero = drag.zero0 - (y - drag.y0) / divH
    p.onAdjust(drag.id, { position: positionForZeroAt(free ? zero : snapToGrid(zero, divH), d) })
    setDrag({ ...drag, x, y, moved: true, target: undefined })
  }

  /** Esc or a cancelled pointer: the drag is dropped, and what it moved goes back */
  const cancelDrag = () => {
    const d = drag
    if (!d) return
    setDrag(null)
    if (d.kind === 'tag' && d.moved) p.onAdjust(d.id, { position: d.pos0 })
    else if (d.kind === 'cursor') p.setCursors(d.orig)
    else if (d.kind === 'pan') p.onNavigate(d.win, 'pan')
  }
  useEffect(() => {
    if (!drag) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && cancelDrag()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const onPointerUp = (e: React.PointerEvent) => {
    const { x, y } = local(e)
    const d = drag
    setDrag(null)
    if (!d) return
    if (d.kind === 'tag') {
      // Dropped onto another view: the channel moves there, with its 0 level where it was dropped
      const disp = byId.get(d.id)?.display
      if (d.target === undefined || !disp) return
      p.onMoveToView(d.id, d.target)
      p.onAdjust(d.id, { position: positionForZeroAt(zeroAt(y, d.target, e.altKey), disp) })
      return
    }
    const wide = (a: number, b: number) => Math.abs(a - b) >= MIN_BOX_PX

    // The kind of rectangle was decided when it was started: a later tool change does not turn a box into a zoom
    if (d.kind === 'rect' && d.box) {
      if (wide(d.x0, d.x1) && wide(d.y0, d.y1)) p.onAddCallout(newBox(d, e.altKey))
      return
    }
    if (d.kind === 'span') {
      if (d.b && wide(tToX(d.a.t), tToX(d.b.t))) p.onAddCallout({ type: 'span', t: d.a.t, t2: d.b.t, channel: d.a.ch, channel2: d.b.ch })
      return
    }
    if (d.kind === 'band' && wide(d.x0, d.x1)) {
      zoomToTimes(xToT(Math.min(d.x0, d.x1)), xToT(Math.max(d.x0, d.x1)))
    } else if (d.kind === 'rect' && wide(d.x0, d.x1)) {
      const t0 = xToT(Math.min(d.x0, d.x1))
      const t1 = xToT(Math.max(d.x0, d.x1))
      if (!wide(d.y0, d.y1)) return zoomToTimes(t0, t1)
      // Map the rectangle's vertical range onto the full height of its view
      const divAt = (yy: number) => DIVS_Y / 2 - (yy - d.view * viewH) / divH
      const divTop = divAt(Math.min(d.y0, d.y1))
      const divBot = divAt(Math.max(d.y0, d.y1))
      const patches = (p.views[d.view] ?? []).flatMap((id) => {
        const c = p.channels.find((ch) => ch.wave.id === id)
        if (!c) return []
        const vTop = divToValue(divTop, c.display)
        const vBot = divToValue(divBot, c.display)
        const scale = parseFloat(((vTop - vBot) / DIVS_Y).toPrecision(4))
        const offset = parseFloat(((vTop + vBot) / 2).toPrecision(6))
        return [{ id, patch: { scale, offset, position: 0 } }]
      })
      zoomToTimes(t0, t1, patches)
    } else if (d.kind === 'rect' && !wide(d.y0, d.y1)) {
      // plain click with the zoom tool: zoom in 2x, Alt+click zooms out
      p.onZoomTo(zoomAround(p.win, xToT(clampX(x)), e.altKey ? 2 : 0.5, p.minSpan, maxSpan))
    } else if (d.kind === 'click' && !dragMoved.current) {
      if (p.tool === 'marker') {
        p.onAddCallout({ type: 'marker', t: snapT(xToT(clampX(x)), e.altKey) })
      } else if (p.tool === 'note') {
        addNote(clampX(x), Math.min(viewsH - 1, Math.max(0, y)))
      }
    } else if (d.kind === 'region' && wide(d.x0, d.x1)) {
      p.onAddCallout({ type: 'region', t: xToT(Math.min(d.x0, d.x1)), t2: xToT(Math.max(d.x0, d.x1)) })
    } else if (d.kind === 'pan' && !dragMoved.current) {
      const id = nearestTrace(x, y)
      if (id) p.setSelected(id)
    }
  }

  const zoomToTimes = (a: number, b: number, patches?: { id: string; patch: DisplayPatch }[]) => {
    const s = Math.max(b - a, p.minSpan)
    const mid = (a + b) / 2
    p.onZoomTo({ start: mid - s / 2, end: mid + s / 2 }, patches)
  }

  const addNote = (x: number, y: number) => p.onAddCallout(noteAt(x, y))

  /** Note attaches to the nearest trace (within 40 px), otherwise to the clicked position */
  const noteAt = (x: number, y: number): NewCallout => {
    const t = xToT(x)
    const ch = nearestTrace(x, y, 40)
    const view = Math.min(nViews - 1, Math.floor(y / viewH))
    const dy = y < 70 ? 24 : -46
    if (ch) return { type: 'note', t, channel: ch, dy }
    return { type: 'note', t, view, div: DIVS_Y / 2 - (y - view * viewH) / divH, dy }
  }

  const onContextMenu = (e: React.MouseEvent) => {
    if (!p.onContextMenu || (e.target as HTMLElement).closest('.callout-editor')) return
    const pt = local(e)
    // On a channel tag: the commands of that channel
    const onTag = tagUnder(pt.x, pt.y)
    if (onTag && p.onChannelMenu) {
      p.setSelected(onTag.id)
      p.onChannelMenu(e, onTag.id)
      return
    }
    const x = clampX(pt.x)
    const y = pt.y
    const onAxis = y > viewsH
    const yIn = Math.min(viewsH - 1, Math.max(0, y))
    p.onContextMenu(e, {
      t: xToT(x),
      onAxis,
      channel: onAxis ? undefined : nearestTrace(x, yIn, 24),
      note: onAxis ? undefined : noteAt(x, yIn),
      edgeT: e.altKey ? undefined : edgeNear(xToT(x)),
    })
  }

  const cursorReadout = p.cursors.on ? cursorSummary(p, theme) : null
  // Callouts outside the view: counted in the top corners, a click goes to the nearest
  const before = p.callouts.filter((c) => calloutSpan(c)[1] < p.win.start)
  const after = p.callouts.filter((c) => calloutSpan(c)[0] > p.win.end)
  const nearestBefore = before.reduce<Callout | undefined>((a, c) => (!a || calloutSpan(c)[1] > calloutSpan(a)[1] ? c : a), undefined)
  const nearestAfter = after.reduce<Callout | undefined>((a, c) => (!a || calloutSpan(c)[0] < calloutSpan(a)[0] ? c : a), undefined)
  const offscreen = (dir: 'left' | 'right', n: number, c: Callout | undefined) =>
    c && (
      <button
        type="button"
        className={`offscreen-callouts ${dir}`}
        style={dir === 'right' ? { right: size.w - plotW + 4 } : undefined}
        title={`${n} callout${n > 1 ? 's' : ''} ${dir === 'left' ? 'before' : 'after'} this view: go to the nearest (${dir === 'left' ? ',' : '.'})`}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={() => p.onJumpToCallout(c)}
      >
        {dir === 'left' ? `‹ ${n}` : `${n} ›`}
      </button>
    )
  // Channel tags and scale labels under the pointer: what dragging and the wheel do there
  const hoverTag = hover && !drag ? tagUnder(hover.x, hover.y) : undefined
  const hoverScale = hover && !drag && hover.x > plotW && hover.y >= 0 && hover.y < viewsH ? viewChannels(Math.floor(hover.y / viewH)).axis : undefined
  const pointerTip = hoverTag
    ? `${channelName(hoverTag.id)}: drag to move the trace (Alt: no snapping; drop on another view to move it there) · wheel: V/div · double-click: settings`
    : hoverScale
      ? `Wheel: V/div of ${channelName(hoverScale.wave.id)}`
      : undefined
  const dragged = drag?.kind === 'tag' && drag.moved ? byId.get(drag.id) : undefined

  const showHover = hover !== undefined && hoverT !== undefined && !drag && !p.editingCallout && !hoverTag
  const nearCursor =
    hoverT !== undefined && p.cursors.on && (p.tool === 'pan' || p.tool === 'zoom') && [p.cursors.a, p.cursors.b].some((t) => Math.abs(tToX(t) - tToX(hoverT)) < GRAB_PX)
  const cursorStyle =
    drag?.kind === 'tag'
      ? drag.target === undefined
        ? 'ns-resize'
        : 'move'
      : hoverTag
        ? 'ns-resize'
        : drag?.kind === 'pan'
          ? 'grabbing'
          : nearCursor || drag?.kind === 'cursor'
            ? 'ew-resize'
            : p.tool === 'zoom'
              ? 'zoom-in'
              : p.tool === 'pan'
                ? 'grab'
                : 'crosshair'

  return (
    <div
      ref={containerRef}
      className="plot-area"
      style={{ cursor: cursorStyle }}
      title={pointerTip}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelDrag}
      onPointerLeave={() => setHover(undefined)}
      // no auto-scroll on a middle click
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onDoubleClick={(e) => {
        const pt = local(e)
        const onTag = tagUnder(pt.x, pt.y)
        if (onTag) p.onChannelSettings?.(onTag.id)
        else if (p.tool === 'pan' || p.tool === 'zoom') p.onZoomTo(p.record)
      }}
      onContextMenu={onContextMenu}
    >
      {p.views.map((_, i) => (
        <canvas
          key={i}
          ref={(el) => {
            canvasRefs.current[i] = el
          }}
          width={Math.round(size.w * (window.devicePixelRatio || 1))}
          height={Math.round(viewH * (window.devicePixelRatio || 1))}
          style={{ width: size.w, height: viewH, display: 'block' }}
        />
      ))}
      <canvas
        ref={axisRef}
        width={Math.round(size.w * (window.devicePixelRatio || 1))}
        height={Math.round(AXIS_H * (window.devicePixelRatio || 1))}
        style={{ width: size.w, height: AXIS_H, display: 'block' }}
        title="Drag along the time axis to zoom into a time range"
      />
      <CalloutLayer
        ref={svgRef}
        callouts={p.callouts}
        geo={calloutGeo}
        snap={edgeNear}
        snapOn={edgesOf}
        channels={p.channels}
        views={p.views}
        win={p.win}
        plotW={plotW}
        viewH={viewH}
        selectedId={p.selectedCallout}
        editingId={p.editingCallout}
        onSelect={p.onSelectCallout}
        onUpdate={p.onUpdateCallout}
        onEdit={p.onEditCallout}
        onDelete={p.onDeleteCallout}
        onContextMenu={p.onCalloutMenu}
      />
      {cursorReadout && (
        <div
          className="cursor-readout"
          style={{ left: Math.max(8, Math.min(plotW - 260, (tToX(p.cursors.a) + tToX(p.cursors.b)) / 2 - 130)), top: readoutTop(flagsBottom(calloutGeo)) }}
        >
          {cursorReadout}
        </div>
      )}
      {showHover && p.readout && (
        <HoverReadout
          t={hoverT}
          x={hover.x}
          y={hover.y}
          channels={p.channels}
          views={p.views}
          near={hover.y < viewsH ? nearestTrace(hover.x, hover.y) : undefined}
          width={plotW}
          height={size.h}
        />
      )}
      {showHover && !p.readout && <div className="hover-time">{si(hoverT, 's', 5)}</div>}
      {drag?.kind === 'tag' && dragged && (
        <div className="drag-readout" style={{ left: Math.min(plotW - 180, drag.x + 16), top: Math.max(4, Math.min(viewsH - 30, drag.y - 12)) }}>
          <span className="dot" style={{ background: theme.ink(dragged.display.color) }} />
          {drag.target === undefined
            ? `${channelName(drag.id)} · position ${dragged.display.position >= 0 ? '+' : ''}${dragged.display.position.toFixed(2)} div`
            : `Move ${channelName(drag.id)} to view ${drag.target + 1}`}
        </div>
      )}
      {offscreen('left', before.length, nearestBefore)}
      {offscreen('right', after.length, nearestAfter)}
      {p.hint && <div className="tool-hint">{p.hint}</div>}
    </div>
  )
})

/**
 * Time and the value of every visible channel at the pointer, next to the pointer (on the side
 * with room). The channel whose trace is under the pointer is highlighted.
 */
function HoverReadout(p: { t: number; x: number; y: number; channels: LiveChannel[]; views: string[][]; near?: string; width: number; height: number }) {
  const { ink } = useTheme().theme
  const byId = new Map(p.channels.map((c) => [c.wave.id, c]))
  const rows = p.views.flat().flatMap((id) => {
    const c = byId.get(id)
    return c?.display.visible ? [c] : []
  })
  const flipX = p.x > p.width - 200
  const flipY = p.y + 14 + 26 + rows.length * 17 > p.height
  return (
    <div
      className="hover-readout"
      style={{ left: p.x, top: p.y, transform: `translate(${flipX ? 'calc(-100% - 14px)' : '14px'}, ${flipY ? 'calc(-100% - 10px)' : '14px'})` }}
    >
      <span className="hr-time mono">{si(p.t, 's', 5)}</span>
      {rows.map((c) => (
        <div key={c.wave.id} className={`hr-row ${c.wave.id === p.near ? 'near' : ''}`}>
          <span className="dot" style={{ background: ink(c.display.color) }} />
          <span className="hr-name">
            {channelName(c.wave.id)}
            {c.display.label && <span className="hr-label">{c.display.label}</span>}
          </span>
          <span className="hr-value mono">{si(valueAt(c.wave, p.t), c.wave.yUnit, 4)}</span>
        </div>
      ))}
    </div>
  )
}

/** Δt between the cursors and Δv of their source channel */
function cursorDeltas(p: Props) {
  const dt = p.cursors.b - p.cursors.a
  const src = p.channels.find((c) => c.wave.id === p.cursors.source)
  const dv = src ? valueAt(src.wave, p.cursors.b) - valueAt(src.wave, p.cursors.a) : NaN
  return { dt, dv, src, unit: src?.wave.yUnit ?? '', name: src ? channelName(src.wave.id) : '?' }
}

function cursorSummary(p: Props, theme: Theme) {
  const { dt, dv, src, unit, name } = cursorDeltas(p)
  return (
    <>
      <span>Δt: {si(dt, 's')}</span>
      <span>1/Δt: {si(1 / Math.abs(dt), 'Hz')}</span>
      <span>
        Δv: {si(dv, unit)} <small style={{ color: src && theme.ink(src.display.color) }}>{src && name}</small>
      </span>
      <span>Δv/Δt: {si(dv / dt, `${displayUnit(unit)}/s`)}</span>
    </>
  )
}

/** Rasterise the callout SVG for PNG export. */
async function svgToImage(xml: string): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The Δt / Δv box of the cursors, drawn into exported images (on screen it is HTML) */
function drawCursorReadout(ctx: CanvasRenderingContext2D, scale: number, p: Props, tToX: (t: number) => number, theme: Theme, top: number) {
  const { dt, dv, unit, name } = cursorDeltas(p)
  const lines = [`Δt: ${si(dt, 's')}   1/Δt: ${si(1 / Math.abs(dt), 'Hz')}`, `Δv: ${si(dv, unit)} (${name})   Δv/Δt: ${si(dv / dt, `${displayUnit(unit)}/s`)}`]
  ctx.save()
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.font = PLOT_FONT
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20
  const x = Math.max(8, (tToX(p.cursors.a) + tToX(p.cursors.b)) / 2 - w / 2)
  ctx.fillStyle = theme.readoutBg
  ctx.strokeStyle = theme.readoutBorder
  ctx.fillRect(x, top, w, 40)
  ctx.strokeRect(x + 0.5, top + 0.5, w, 40)
  ctx.fillStyle = theme.text
  lines.forEach((l, i) => ctx.fillText(l, x + 10, top + 16 + i * 16))
  ctx.restore()
}
