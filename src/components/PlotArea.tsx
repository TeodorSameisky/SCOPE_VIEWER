import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { edgeLevels, nearestEdge, type EdgeLevels } from '../dsp/edges'
import type { PlotImageSource } from '../export/sessionExport'
import { calloutSpan, type Callout } from '../model/callouts'
import { calloutsSvg, flagsBottom, layoutCallouts } from '../render/callouts'
import { AXIS_GUTTER, DIVS_Y, PLOT_FONT, divToValue, drawTimeAxis, drawView, valueAt, valueToDiv, type ViewDrawOptions } from '../render/draw'
import { loadTex, useTexVersion } from '../render/tex'
import { DARK_THEME, type Theme } from '../render/theme'
import { si } from '../util/format'
import { channelName } from '../util/names'
import { CalloutLayer } from './CalloutLayer'
import {
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

export interface NewCallout {
  type: Callout['type']
  t: number
  t2?: number
  channel?: string
  view?: number
  div?: number
  dy?: number
}

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

type Drag =
  | { kind: 'pan'; x0: number; win: TimeWindow }
  | { kind: 'cursor'; which: 'a' | 'b' }
  /** time-only zoom band */
  | { kind: 'band'; x0: number; x1: number }
  /** time + vertical zoom rectangle inside one view */
  | { kind: 'rect'; view: number; x0: number; y0: number; x1: number; y1: number }
  /** new region callout */
  | { kind: 'region'; x0: number; x1: number }
  /** click-type tools (zoom click, note, marker): only track whether it moved */
  | { kind: 'click'; x0: number; y0: number }

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
  /**
   * Time of the edge of the selected trace nearest to t (within SNAP_PX), or undefined. The
   * reference levels come from the samples on screen and are worked out on first use.
   */
  const edgeNear = useMemo(() => {
    const ch = p.channels.find((c) => c.wave.id === p.selected && c.display.visible)
    if (!ch) return () => undefined
    const w = ch.wave
    const i0 = Math.max(0, Math.floor((p.win.start - w.t0) / w.dt))
    const i1 = Math.min(w.data.length, Math.ceil((p.win.end - w.t0) / w.dt) + 1)
    const maxN = (SNAP_PX * (p.win.end - p.win.start)) / Math.max(1, plotW) / w.dt
    let levels: EdgeLevels | undefined | null = null
    return (t: number): number | undefined => {
      if (levels === null) levels = edgeLevels(w.data, i0, i1)
      if (!levels) return undefined
      const x = nearestEdge(w.data, (t - w.t0) / w.dt, maxN, levels, i0, i1)
      return x === undefined ? undefined : w.t0 + x * w.dt
    }
  }, [p.channels, p.selected, p.win, plotW])
  /** Markers and region edges snap to edges; Alt places them freely */
  const snapT = (t: number, alt: boolean) => (alt ? t : (edgeNear(t) ?? t))
  const snapX = (x: number, alt: boolean) => tToX(snapT(xToT(x), alt))

  const pointerT = hover && hover.x >= 0 && hover.x <= plotW ? xToT(hover.x) : undefined
  // With the Marker and Region tools the hover line shows where a click would put the edge
  const hoverT = pointerT !== undefined && (p.tool === 'marker' || p.tool === 'region') ? snapT(pointerT, hover!.alt) : pointerT
  // Callout geometry (formulas render asynchronously: lay out again when one is ready)
  useTexVersion()
  const calloutGeo = layoutCallouts(p.callouts, { channels: p.channels, views: p.views, win: p.win, plotW, viewH })

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const ticks = timeTicks(p.win)
  /** Drawing options of view `vi` that are the same on screen and in exports */
  const viewOptions = (vi: number, byId: Map<string, LiveChannel>, dpr: number, theme: Theme): ViewDrawOptions => {
    const traces = p.views[vi].map((id) => byId.get(id)).filter((c): c is LiveChannel => !!c && c.display.visible)
    return {
      width: size.w,
      height: viewH,
      dpr,
      tStart: p.win.start,
      tEnd: p.win.end,
      timeTicks: ticks,
      traces,
      // The right axis is labelled for the selected channel, else the first one of the view
      axisChannel: traces.find((t) => t.display.id === p.selected) ?? traces[0],
      cursors: p.cursors.on ? { a: p.cursors.a, b: p.cursors.b, sourceId: p.cursors.source, showLabels: vi === 0 } : undefined,
      trigger: { sourceId: p.trigger?.source, level: p.trigger?.level, showMarker: true },
      theme,
    }
  }

  // Draw everything on the next animation frame whenever inputs change
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1
      const byId = new Map(p.channels.map((c) => [c.wave.id, c]))
      p.views.forEach((_, vi) => {
        const ctx = canvasRefs.current[vi]?.getContext('2d')
        if (!ctx) return
        drawView(ctx, { ...viewOptions(vi, byId, dpr, DARK_THEME), selectedId: p.selected, hoverT: drag ? undefined : hoverT, hoverDots: p.readout })
        drawDragPreview(ctx, dpr, vi)
      })
      const ax = axisRef.current?.getContext('2d')
      if (ax) drawTimeAxis(ax, size.w, AXIS_H, dpr, p.win.start, p.win.end, ticks, DARK_THEME)
    })
    return () => cancelAnimationFrame(id)
    // viewOptions and drawDragPreview only read the props and state listed here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.channels, p.views, p.win, p.cursors, p.selected, p.trigger, p.readout, size, viewH, hoverT, drag])

  /** Rubber band for zoom / region selection */
  const drawDragPreview = (ctx: CanvasRenderingContext2D, dpr: number, vi: number) => {
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
    const color = drag.kind === 'region' ? '63, 182, 255' : '80, 160, 255'
    ctx.fillStyle = `rgba(${color}, 0.15)`
    ctx.strokeStyle = `rgba(${color}, 0.85)`
    ctx.setLineDash(drag.kind === 'region' ? [] : [4, 3])
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0 - 1)
    if (vi === 0 || drag.kind === 'rect') {
      ctx.setLineDash([])
      ctx.font = '11px system-ui, sans-serif'
      ctx.fillStyle = '#cfe6ff'
      ctx.textBaseline = 'top'
      ctx.fillText(si(Math.abs(xToT(drag.x1) - xToT(drag.x0)), 's'), x0 + 4, y0 + 4)
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
      const byId = new Map(p.channels.map((c) => [c.wave.id, c]))
      // Redraw each view at the export resolution (no hover line or rubber band)
      p.views.forEach((_, vi) => {
        const cv = document.createElement('canvas')
        cv.width = out.width
        cv.height = Math.round(viewH * scale)
        drawView(cv.getContext('2d')!, viewOptions(vi, byId, scale, theme))
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

  // Wheel: zoom time around the mouse; Ctrl = V/div of selected channel; Alt = its position
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.callout-editor')) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const dir = e.deltaY > 0 ? 1 : -1
      if ((e.ctrlKey || e.altKey) && p.selected) {
        const ch = p.channels.find((c) => c.wave.id === p.selected)
        if (!ch) return
        if (e.ctrlKey) p.onAdjust(ch.wave.id, { scale: stepScale(ch.display.scale, dir as 1 | -1) })
        else p.onAdjust(ch.wave.id, { position: Math.round((ch.display.position - dir * 0.2) * 100) / 100 })
        return
      }
      if (e.shiftKey) {
        const shift = span * 0.1 * dir
        p.onNavigate({ start: p.win.start + shift, end: p.win.end + shift }, 'pan')
        return
      }
      const t = xToT(Math.min(plotW, Math.max(0, x)))
      // Proportional to the wheel delta so trackpads and fast wheels feel natural
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      const f = Math.min(4, Math.max(0.25, Math.pow(1.0022, delta)))
      p.onNavigate(zoomAround(p.win, t, f, p.minSpan, maxSpan), 'wheel')
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [p, span, plotW, xToT, maxSpan])

  const local = (e: React.PointerEvent) => {
    const r = containerRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const clampX = (x: number) => Math.min(plotW, Math.max(0, x))
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
    const onAxis = y > viewsH
    const navTool = p.tool === 'pan' || p.tool === 'zoom'

    if (navTool && !onAxis && p.cursors.on) {
      const da = Math.abs(tToX(p.cursors.a) - x)
      const db = Math.abs(tToX(p.cursors.b) - x)
      if (Math.min(da, db) < GRAB_PX) {
        setDrag({ kind: 'cursor', which: da <= db ? 'a' : 'b' })
        return
      }
    }
    // Dragging along the time axis always marks a time range to zoom into
    if (onAxis || (navTool && e.shiftKey)) setDrag({ kind: 'band', x0: x, x1: x })
    else if (p.tool === 'pan') setDrag({ kind: 'pan', x0: x, win: p.win })
    else if (p.tool === 'zoom') {
      const view = Math.min(nViews - 1, Math.floor(y / viewH))
      setDrag({ kind: 'rect', view, x0: x, y0: y, x1: x, y1: y })
    } else if (p.tool === 'region') {
      const xs = snapX(clampX(x), e.altKey)
      setDrag({ kind: 'region', x0: xs, x1: xs })
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
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const { x, y } = local(e)
    const d = drag
    setDrag(null)
    if (!d) return
    const wide = (a: number, b: number) => Math.abs(a - b) >= MIN_BOX_PX

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
    const r = containerRef.current!.getBoundingClientRect()
    const x = clampX(e.clientX - r.left)
    const y = e.clientY - r.top
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

  const cursorReadout = p.cursors.on ? cursorSummary(p) : null
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
  const showHover = hover !== undefined && hoverT !== undefined && !drag && !p.editingCallout
  const nearCursor =
    hoverT !== undefined && p.cursors.on && (p.tool === 'pan' || p.tool === 'zoom') && [p.cursors.a, p.cursors.b].some((t) => Math.abs(tToX(t) - tToX(hoverT)) < GRAB_PX)
  const cursorStyle =
    drag?.kind === 'pan'
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
      className={`plot-area tool-${p.tool}`}
      style={{ cursor: cursorStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(undefined)}
      // no auto-scroll on a middle click
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onDoubleClick={() => (p.tool === 'pan' || p.tool === 'zoom') && p.onZoomTo(p.record)}
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
        className="time-axis"
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
          <span className="dot" style={{ background: c.display.color }} />
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
  return { dt, dv, src, unit: src?.wave.yUnit ?? 'V', name: src ? channelName(src.wave.id) : '?' }
}

function cursorSummary(p: Props) {
  const { dt, dv, src, unit, name } = cursorDeltas(p)
  return (
    <>
      <span>Δt: {si(dt, 's')}</span>
      <span>1/Δt: {si(1 / Math.abs(dt), 'Hz')}</span>
      <span>
        Δv: {si(dv, unit)} <small style={{ color: src?.display.color }}>{src && name}</small>
      </span>
      <span>Δv/Δt: {si(dv / dt, `${unit}/s`)}</span>
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
  const lines = [`Δt: ${si(dt, 's')}   1/Δt: ${si(1 / Math.abs(dt), 'Hz')}`, `Δv: ${si(dv, unit)} (${name})   Δv/Δt: ${si(dv / dt, `${unit}/s`)}`]
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
