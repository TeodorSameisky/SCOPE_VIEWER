import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AXIS_GUTTER, DIVS_Y, PLOT_FONT, valueToDiv } from '../render/draw'
import { DARK_THEME } from '../render/theme'
import { zoomAround, type LiveChannel, type NavKind, type TimeWindow } from './state'

const HEIGHT = 46
const EDGE_PX = 6

interface Props {
  channels: LiveChannel[]
  views: string[][]
  record: TimeWindow
  win: TimeWindow
  minSpan: number
  onNavigate: (w: TimeWindow, kind: NavKind) => void
}

type Drag =
  | { kind: 'move'; x0: number; win: TimeWindow }
  | { kind: 'start' | 'end' }
  | { kind: 'select'; x0: number; x1: number }

/**
 * Navigator above the plot: the whole record in miniature with the visible window
 * as a box. Drag the box to pan, drag its edges to resize, drag elsewhere to mark
 * a new range to zoom into, click to centre the view.
 */
export function Overview({ channels, views, record, win, minSpan, onNavigate }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tracesRef = useRef<HTMLCanvasElement | null>(null)
  const [width, setWidth] = useState(800)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [hoverPart, setHoverPart] = useState<'move' | 'edge' | null>(null)
  const moved = useRef(false)

  const plotW = Math.max(1, width - AXIS_GUTTER)
  const recSpan = record.end - record.start || 1
  const tToX = (t: number) => ((t - record.start) / recSpan) * plotW
  const xToT = (x: number) => record.start + (x / plotW) * recSpan

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Miniature traces: redrawn only when channels, layout or size change
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1
    const cv = tracesRef.current ?? document.createElement('canvas')
    tracesRef.current = cv
    cv.width = Math.round(width * dpr)
    cv.height = Math.round(HEIGHT * dpr)
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0a0d12'
    ctx.fillRect(0, 0, width, HEIGHT)
    const nViews = Math.max(1, views.length)
    const laneH = HEIGHT / nViews
    const cols = Math.ceil(plotW * dpr)
    const mm: [number, number] = [0, 0]
    views.forEach((ids, vi) => {
      const top = vi * laneH
      if (vi > 0) {
        ctx.fillStyle = DARK_THEME.grid
        ctx.fillRect(0, Math.round(top), plotW, 1)
      }
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, top, plotW, laneH)
      ctx.clip()
      for (const id of ids) {
        const c = channels.find((ch) => ch.wave.id === id)
        if (!c || !c.display.visible) continue
        const { wave, display: d } = c
        const yOf = (v: number) => top + laneH / 2 - valueToDiv(v, d) * (laneH / DIVS_Y)
        ctx.strokeStyle = d.color
        ctx.globalAlpha = 0.85
        ctx.lineWidth = 1
        ctx.beginPath()
        let started = false
        for (let col = 0; col < cols; col++) {
          const ta = record.start + (col / cols) * recSpan
          const tb = record.start + ((col + 1) / cols) * recSpan
          c.pyramid.range(Math.floor((ta - wave.t0) / wave.dt), Math.floor((tb - wave.t0) / wave.dt) + 1, mm)
          if (!Number.isFinite(mm[0])) continue
          const x = (col + 0.5) / dpr
          if (!started) {
            ctx.moveTo(x, yOf(mm[1]))
            started = true
          } else ctx.lineTo(x, yOf(mm[1]))
          ctx.lineTo(x, yOf(mm[0]) + 0.5)
        }
        ctx.stroke()
      }
      ctx.restore()
    })
    ctx.globalAlpha = 1
  }, [channels, views, width, plotW, record.start, recSpan])

  // Window box on top of the cached traces
  useEffect(() => {
    const cv = canvasRef.current
    const traces = tracesRef.current
    if (!cv || !traces) return
    const dpr = window.devicePixelRatio || 1
    const ctx = cv.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(traces, 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const x0 = Math.max(0, tToX(win.start))
    const x1 = Math.min(plotW, tToX(win.end))
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(0, 0, Math.max(0, x0), HEIGHT)
    ctx.fillRect(x1, 0, Math.max(0, plotW - x1), HEIGHT)
    ctx.strokeStyle = '#3fb6ff'
    ctx.lineWidth = 1.5
    ctx.strokeRect(x0 + 0.75, 0.75, Math.max(2, x1 - x0 - 1.5), HEIGHT - 1.5)
    // trigger position
    const xt = tToX(0)
    if (xt >= 0 && xt <= plotW) {
      ctx.fillStyle = DARK_THEME.trigger
      ctx.beginPath()
      ctx.moveTo(xt - 4, 0)
      ctx.lineTo(xt + 4, 0)
      ctx.lineTo(xt, 5)
      ctx.fill()
    }
    if (drag?.kind === 'select') {
      const a = Math.min(drag.x0, drag.x1)
      const b = Math.max(drag.x0, drag.x1)
      ctx.fillStyle = 'rgba(80, 160, 255, 0.25)'
      ctx.fillRect(a, 0, b - a, HEIGHT)
      ctx.strokeStyle = 'rgba(80, 160, 255, 0.9)'
      ctx.strokeRect(a + 0.5, 0.5, b - a, HEIGHT - 1)
    }
    // Label in the gutter
    ctx.fillStyle = DARK_THEME.axisText
    ctx.font = PLOT_FONT
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText('Overview', plotW + 6, HEIGHT / 2)
  })

  const localX = (e: React.PointerEvent) => e.clientX - wrapRef.current!.getBoundingClientRect().left
  const partAt = (x: number): 'start' | 'end' | 'move' | null => {
    const x0 = tToX(win.start)
    const x1 = tToX(win.end)
    if (Math.abs(x - x0) < EDGE_PX) return 'start'
    if (Math.abs(x - x1) < EDGE_PX) return 'end'
    // When the view shows (nearly) the whole record, dragging inside marks a new range instead
    if (x > x0 && x < x1 && x1 - x0 < plotW * 0.9) return 'move'
    return null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const x = localX(e)
    if (x > plotW) return
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    moved.current = false
    const part = partAt(x)
    if (part === 'move') setDrag({ kind: 'move', x0: x, win })
    else if (part) setDrag({ kind: part })
    else setDrag({ kind: 'select', x0: x, x1: x })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const x = Math.min(plotW, Math.max(0, localX(e)))
    if (!drag) {
      const part = partAt(x)
      setHoverPart(part === 'move' ? 'move' : part ? 'edge' : null)
      return
    }
    moved.current = true
    if (drag.kind === 'move') {
      const dt = ((x - drag.x0) / plotW) * recSpan
      onNavigate({ start: drag.win.start + dt, end: drag.win.end + dt }, 'pan')
    } else if (drag.kind === 'start') {
      const t = Math.min(xToT(x), win.end - minSpan)
      onNavigate({ start: t, end: win.end }, 'pan')
    } else if (drag.kind === 'end') {
      const t = Math.max(xToT(x), win.start + minSpan)
      onNavigate({ start: win.start, end: t }, 'pan')
    } else if (drag.kind === 'select') {
      setDrag({ ...drag, x1: x })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const x = Math.min(plotW, Math.max(0, localX(e)))
    if (drag?.kind === 'select') {
      if (Math.abs(drag.x1 - drag.x0) > 3) {
        const a = xToT(Math.min(drag.x0, drag.x1))
        const b = xToT(Math.max(drag.x0, drag.x1))
        const s = Math.max(b - a, minSpan)
        onNavigate({ start: (a + b) / 2 - s / 2, end: (a + b) / 2 + s / 2 }, 'zoom')
      } else {
        // click: centre the current window there
        const span = win.end - win.start
        const t = xToT(x)
        onNavigate({ start: t - span / 2, end: t + span / 2 }, 'zoom')
      }
    }
    setDrag(null)
  }

  // Wheel zooms around the pointed time
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const x = e.clientX - el.getBoundingClientRect().left
      const t = record.start + (Math.min(plotW, Math.max(0, x)) / plotW) * recSpan
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      const f = Math.min(4, Math.max(0.25, Math.pow(1.0022, delta)))
      onNavigate(zoomAround(win, t, f, minSpan, recSpan * 4), 'wheel')
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [win, record.start, recSpan, plotW, minSpan, onNavigate])

  const dpr = window.devicePixelRatio || 1
  const cursor = drag?.kind === 'move' ? 'grabbing' : drag ? 'ew-resize' : hoverPart === 'move' ? 'grab' : hoverPart === 'edge' ? 'ew-resize' : 'crosshair'
  return (
    <div
      ref={wrapRef}
      className="overview"
      style={{ cursor }}
      title="Overview: drag to mark a range to zoom into, drag the box to move it, drag its edges to resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => !drag && setHoverPart(null)}
    >
      <canvas ref={canvasRef} width={Math.round(width * dpr)} height={Math.round(HEIGHT * dpr)} style={{ width, height: HEIGHT, display: 'block' }} />
    </div>
  )
}
