import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { Callout } from '../model/callouts'
import { AXIS_GUTTER, DIVS_Y, divToValue, drawTimeAxis, drawView, valueAt, valueToDiv } from '../render/draw'
import { si } from '../util/format'
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
} from './state'

const AXIS_H = 24
const GRAB_PX = 8
const MIN_BOX_PX = 5

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
}

export interface PlotAreaHandle {
  /** Draw all views, callouts and the time axis at `scale` × the screen size (CSS pixels) */
  renderImage: (scale: number) => Promise<HTMLCanvasElement>
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
  const [hoverT, setHoverT] = useState<number | undefined>()
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

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Draw everything on the next animation frame whenever inputs change
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1
      const ticks = timeTicks(p.win)
      const byId = new Map(p.channels.map((c) => [c.wave.id, c]))
      p.views.forEach((ids, vi) => {
        const cv = canvasRefs.current[vi]
        if (!cv) return
        const ctx = cv.getContext('2d')
        if (!ctx) return
        const traces = ids
          .map((id) => byId.get(id))
          .filter((c): c is LiveChannel => !!c && c.display.visible)
          .map((c) => ({ display: c.display, wave: c.wave, pyramid: c.pyramid }))
        const axisChannel = traces.find((t) => t.display.id === p.selected)?.display ?? traces[0]?.display
        drawView(ctx, {
          width: size.w,
          height: viewH,
          dpr,
          tStart: p.win.start,
          tEnd: p.win.end,
          timeTicks: ticks,
          traces,
          axisChannel,
          selectedId: p.selected,
          cursors: p.cursors.on ? { a: p.cursors.a, b: p.cursors.b, sourceId: p.cursors.source, showLabels: vi === 0 } : undefined,
          trigger: { sourceId: p.trigger?.source, level: p.trigger?.level, showMarker: true },
          hoverT: drag ? undefined : hoverT,
        })
        drawDragPreview(ctx, dpr, vi)
      })
      const ax = axisRef.current?.getContext('2d')
      if (ax) drawTimeAxis(ax, size.w, AXIS_H, dpr, p.win.start, p.win.end, ticks)
    })
    return () => cancelAnimationFrame(id)
    // drawDragPreview only reads `drag`, `viewH`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.channels, p.views, p.win, p.cursors, p.selected, p.trigger, size, viewH, hoverT, drag])

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
    renderImage: async (scale: number) => {
      const out = document.createElement('canvas')
      out.width = Math.round(size.w * scale)
      out.height = Math.round((viewsH + AXIS_H) * scale)
      const ctx = out.getContext('2d')!
      const ticks = timeTicks(p.win)
      const byId = new Map(p.channels.map((c) => [c.wave.id, c]))
      // Redraw each view at the export resolution (no hover line or rubber band)
      p.views.forEach((ids, vi) => {
        const cv = document.createElement('canvas')
        cv.width = out.width
        cv.height = Math.round(viewH * scale)
        const traces = ids
          .map((id) => byId.get(id))
          .filter((c): c is LiveChannel => !!c && c.display.visible)
          .map((c) => ({ display: c.display, wave: c.wave, pyramid: c.pyramid }))
        drawView(cv.getContext('2d')!, {
          width: size.w,
          height: viewH,
          dpr: scale,
          tStart: p.win.start,
          tEnd: p.win.end,
          timeTicks: ticks,
          traces,
          axisChannel: traces.find((t) => t.display.id === p.selected)?.display ?? traces[0]?.display,
          cursors: p.cursors.on ? { a: p.cursors.a, b: p.cursors.b, sourceId: p.cursors.source, showLabels: vi === 0 } : undefined,
          trigger: { sourceId: p.trigger?.source, level: p.trigger?.level, showMarker: true },
        })
        ctx.drawImage(cv, 0, Math.round(vi * viewH * scale))
      })
      const ax = document.createElement('canvas')
      ax.width = out.width
      ax.height = Math.round(AXIS_H * scale)
      drawTimeAxis(ax.getContext('2d')!, size.w, AXIS_H, scale, p.win.start, p.win.end, ticks)
      ctx.drawImage(ax, 0, Math.round(viewsH * scale))
      // Callouts are vector graphics: rasterised directly at the export resolution
      if (svgRef.current && p.callouts.length) {
        const img = await svgToImage(svgRef.current)
        if (img) ctx.drawImage(img, 0, 0, plotW * scale, viewsH * scale)
      }
      if (p.cursors.on) drawCursorReadout(ctx, scale, p, tToX)
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
    if (e.button !== 0) return
    const { x, y } = local(e)
    if (x > plotW) return
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // synthetic events have no active pointer
    }
    dragMoved.current = false
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
    } else if (p.tool === 'region') setDrag({ kind: 'region', x0: x, x1: x })
    else setDrag({ kind: 'click', x0: x, y0: y })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = local(e)
    setHoverT(x >= 0 && x <= plotW ? xToT(x) : undefined)
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
      case 'region':
        setDrag({ ...drag, x1: clampX(x) })
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
        p.onAddCallout({ type: 'marker', t: xToT(clampX(x)) })
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

  /** Note attaches to the nearest trace (within 40 px), otherwise to the clicked position */
  const addNote = (x: number, y: number) => {
    const t = xToT(x)
    const ch = nearestTrace(x, y, 40)
    const view = Math.min(nViews - 1, Math.floor(y / viewH))
    const dy = y < 70 ? 24 : -46
    if (ch) p.onAddCallout({ type: 'note', t, channel: ch, dy })
    else p.onAddCallout({ type: 'note', t, view, div: DIVS_Y / 2 - (y - view * viewH) / divH, dy })
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
      onPointerLeave={() => setHoverT(undefined)}
      onDoubleClick={() => (p.tool === 'pan' || p.tool === 'zoom') && p.onZoomTo(p.record)}
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
      />
      {cursorReadout && (
        <div className="cursor-readout" style={{ left: Math.max(8, Math.min(plotW - 260, (tToX(p.cursors.a) + tToX(p.cursors.b)) / 2 - 130)) }}>
          {cursorReadout}
        </div>
      )}
      {hoverT !== undefined && !drag && <div className="hover-time">{si(hoverT, 's', 5)}</div>}
      {p.hint && <div className="tool-hint">{p.hint}</div>}
    </div>
  )
})

function cursorSummary(p: Props) {
  const dt = p.cursors.b - p.cursors.a
  const src = p.channels.find((c) => c.wave.id === p.cursors.source)
  const va = src ? valueAt(src.wave, p.cursors.a) : NaN
  const vb = src ? valueAt(src.wave, p.cursors.b) : NaN
  const dv = vb - va
  const unit = src?.wave.yUnit ?? 'V'
  return (
    <>
      <span>Δt: {si(dt, 's')}</span>
      <span>1/Δt: {si(1 / Math.abs(dt), 'Hz')}</span>
      <span>
        Δv: {si(dv, unit)} <small style={{ color: src?.display.color }}>{src?.wave.id}</small>
      </span>
      <span>Δv/Δt: {si(dv / dt, `${unit}/s`)}</span>
    </>
  )
}

/** Rasterise the callout SVG (without selection outlines) for PNG export. */
async function svgToImage(svg: SVGSVGElement): Promise<HTMLImageElement | null> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.querySelectorAll('[data-ui="selection"]').forEach((n) => n.remove())
  const xml = new XMLSerializer().serializeToString(clone)
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
function drawCursorReadout(ctx: CanvasRenderingContext2D, scale: number, p: Props, tToX: (t: number) => number) {
  const dt = p.cursors.b - p.cursors.a
  const src = p.channels.find((c) => c.wave.id === p.cursors.source)
  const unit = src?.wave.yUnit ?? 'V'
  const dv = src ? valueAt(src.wave, p.cursors.b) - valueAt(src.wave, p.cursors.a) : NaN
  const lines = [`Δt: ${si(dt, 's')}   1/Δt: ${si(1 / Math.abs(dt), 'Hz')}`, `Δv: ${si(dv, unit)} (${src?.wave.id ?? '?'})   Δv/Δt: ${si(dv / dt, `${unit}/s`)}`]
  ctx.save()
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.font = '11px "JetBrains Mono", ui-monospace, Consolas, monospace'
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20
  const x = Math.max(8, (tToX(p.cursors.a) + tToX(p.cursors.b)) / 2 - w / 2)
  ctx.fillStyle = 'rgba(30, 36, 46, 0.9)'
  ctx.strokeStyle = '#3a4454'
  ctx.fillRect(x, 22, w, 40)
  ctx.strokeRect(x + 0.5, 22.5, w, 40)
  ctx.fillStyle = '#d7dce4'
  lines.forEach((l, i) => ctx.fillText(l, x + 10, 38 + i * 16))
  ctx.restore()
}
