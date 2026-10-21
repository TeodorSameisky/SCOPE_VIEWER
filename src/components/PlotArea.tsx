import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { AXIS_GUTTER, DIVS_Y, drawTimeAxis, drawView, valueAt, valueToDiv } from '../render/draw'
import { si } from '../util/format'
import { stepScale, timeTicks, type CursorState, type DisplayPatch, type LiveChannel, type TimeWindow } from './state'

const AXIS_H = 24
const GRAB_PX = 8

interface Props {
  channels: LiveChannel[]
  views: string[][]
  win: TimeWindow
  setWin: (w: TimeWindow) => void
  record: TimeWindow
  minSpan: number
  cursors: CursorState
  setCursors: (c: CursorState) => void
  selected?: string
  setSelected: (id: string) => void
  trigger?: { source: string; level?: number }
  onAdjust: (id: string, patch: DisplayPatch) => void
}

export interface PlotAreaHandle {
  /** Compose all views and the time axis into a single PNG */
  toPng: () => Promise<Blob | null>
}

type Drag =
  | { kind: 'pan'; x0: number; win: TimeWindow }
  | { kind: 'cursor'; which: 'a' | 'b' }
  | { kind: 'box'; x0: number; x1: number }

export const PlotArea = forwardRef<PlotAreaHandle, Props>(function PlotArea(p, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const axisRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [hoverT, setHoverT] = useState<number | undefined>()
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragMoved = useRef(false)

  const nViews = Math.max(1, p.views.length)
  const viewH = Math.max(40, Math.floor((size.h - AXIS_H) / nViews))
  const plotW = size.w - AXIS_GUTTER
  const span = p.win.end - p.win.start
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
        if (drag?.kind === 'box') {
          const x0 = Math.min(drag.x0, drag.x1)
          const x1 = Math.max(drag.x0, drag.x1)
          ctx.save()
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.fillStyle = 'rgba(80, 160, 255, 0.15)'
          ctx.strokeStyle = 'rgba(80, 160, 255, 0.8)'
          ctx.fillRect(x0, 0, x1 - x0, viewH)
          ctx.strokeRect(x0 + 0.5, 0.5, x1 - x0, viewH - 1)
          ctx.restore()
        }
      })
      const ax = axisRef.current?.getContext('2d')
      if (ax) drawTimeAxis(ax, size.w, AXIS_H, dpr, p.win.start, p.win.end, ticks)
    })
    return () => cancelAnimationFrame(id)
  }, [p.channels, p.views, p.win, p.cursors, p.selected, p.trigger, size, viewH, hoverT, drag])

  useImperativeHandle(ref, () => ({
    toPng: () => {
      const dpr = window.devicePixelRatio || 1
      const out = document.createElement('canvas')
      out.width = Math.round(size.w * dpr)
      out.height = Math.round((viewH * nViews + AXIS_H) * dpr)
      const ctx = out.getContext('2d')!
      canvasRefs.current.slice(0, nViews).forEach((cv, i) => cv && ctx.drawImage(cv, 0, Math.round(i * viewH * dpr)))
      if (axisRef.current) ctx.drawImage(axisRef.current, 0, Math.round(nViews * viewH * dpr))
      return new Promise((resolve) => out.toBlob(resolve, 'image/png'))
    },
  }))

  const clampWin = useCallback(
    (start: number, end: number): TimeWindow => {
      let s = Math.max(end - start, p.minSpan)
      const recSpan = p.record.end - p.record.start
      s = Math.min(s, recSpan * 4)
      const mid = (start + end) / 2
      return { start: mid - s / 2, end: mid + s / 2 }
    },
    [p.minSpan, p.record],
  )

  // Wheel: zoom time around the mouse; Ctrl = V/div of selected channel; Alt = its position
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
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
        p.setWin({ start: p.win.start + shift, end: p.win.end + shift })
        return
      }
      const t = xToT(Math.min(plotW, Math.max(0, x)))
      // Proportional to the wheel delta so trackpads and fast wheels feel natural
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      const f = Math.min(4, Math.max(0.25, Math.pow(1.0022, delta)))
      const w = clampWin(t - (t - p.win.start) * f, t + (p.win.end - t) * f)
      // keep the point under the mouse fixed after clamping
      const ns = w.end - w.start
      const frac = (t - p.win.start) / span
      p.setWin({ start: t - frac * ns, end: t - frac * ns + ns })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [p, span, plotW, xToT, clampWin])

  const localX = (e: React.PointerEvent) => e.clientX - containerRef.current!.getBoundingClientRect().left
  const localY = (e: React.PointerEvent) => e.clientY - containerRef.current!.getBoundingClientRect().top

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const x = localX(e)
    if (x > plotW) return
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // synthetic events have no active pointer
    }
    dragMoved.current = false
    if (p.cursors.on) {
      const da = Math.abs(tToX(p.cursors.a) - x)
      const db = Math.abs(tToX(p.cursors.b) - x)
      if (Math.min(da, db) < GRAB_PX) {
        setDrag({ kind: 'cursor', which: da <= db ? 'a' : 'b' })
        return
      }
    }
    if (e.shiftKey) setDrag({ kind: 'box', x0: x, x1: x })
    else setDrag({ kind: 'pan', x0: x, win: p.win })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const x = localX(e)
    setHoverT(x >= 0 && x <= plotW ? xToT(x) : undefined)
    if (!drag) return
    dragMoved.current = true
    if (drag.kind === 'pan') {
      const dt = ((x - drag.x0) / plotW) * (drag.win.end - drag.win.start)
      p.setWin({ start: drag.win.start - dt, end: drag.win.end - dt })
    } else if (drag.kind === 'cursor') {
      p.setCursors({ ...p.cursors, [drag.which]: xToT(Math.min(plotW, Math.max(0, x))) })
    } else {
      setDrag({ ...drag, x1: Math.min(plotW, Math.max(0, x)) })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag?.kind === 'box' && Math.abs(drag.x1 - drag.x0) > 4) {
      const a = xToT(Math.min(drag.x0, drag.x1))
      const b = xToT(Math.max(drag.x0, drag.x1))
      p.setWin(clampWin(a, b))
    } else if (drag && !dragMoved.current) {
      selectNearestTrace(localX(e), localY(e))
    }
    setDrag(null)
  }

  // Click on a trace selects that channel
  const selectNearestTrace = (x: number, y: number) => {
    const vi = Math.min(nViews - 1, Math.floor(y / viewH))
    const yIn = y - vi * viewH
    const t = xToT(x)
    let best: string | undefined
    let bestD = 20
    for (const id of p.views[vi] ?? []) {
      const c = p.channels.find((ch) => ch.wave.id === id)
      if (!c || !c.display.visible) continue
      const v = valueAt(c.wave, t)
      if (!Number.isFinite(v)) continue
      const yy = viewH / 2 - valueToDiv(v, c.display) * (viewH / DIVS_Y)
      const d = Math.abs(yy - yIn)
      if (d < bestD) {
        bestD = d
        best = id
      }
    }
    if (best) p.setSelected(best)
  }

  const cursorReadout = p.cursors.on ? cursorSummary(p) : null
  const cursorHover = hoverT !== undefined && p.cursors.on && [p.cursors.a, p.cursors.b].some((t) => Math.abs(tToX(t) - tToX(hoverT)) < GRAB_PX)

  return (
    <div
      ref={containerRef}
      className="plot-area"
      style={{ cursor: drag?.kind === 'pan' ? 'grabbing' : cursorHover || drag?.kind === 'cursor' ? 'ew-resize' : 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHoverT(undefined)}
      onDoubleClick={() => p.setWin(p.record)}
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
      />
      {cursorReadout && (
        <div className="cursor-readout" style={{ left: Math.max(8, Math.min(plotW - 260, (tToX(p.cursors.a) + tToX(p.cursors.b)) / 2 - 130)) }}>
          {cursorReadout}
        </div>
      )}
      {hoverT !== undefined && !drag && <div className="hover-time">{si(hoverT, 's', 5)}</div>}
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
