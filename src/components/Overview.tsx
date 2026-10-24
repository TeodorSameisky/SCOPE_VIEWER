import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { calloutSpan, calloutTitle, hasTimeSpan, type Callout } from '../model/callouts'
import { AXIS_GUTTER, DIVS_Y, valueToDiv } from '../render/draw'
import { PLOT_FONT } from '../render/fonts'
import { useTheme } from './ui/themeContext'
import { panShare, wheelPan, wheelPixels, wheelZoomFactor } from './ui/wheel'
import { zoomAround, type LiveChannel, type NavKind, type TimeWindow } from '../model/view'

const HEIGHT = 46
const EDGE_PX = 6
/** Strip at the bottom with the callouts */
const BAND = 8
const HIT_PX = 5

interface Props {
  channels: LiveChannel[]
  views: string[][]
  record: TimeWindow
  win: TimeWindow
  minSpan: number
  onNavigate: (w: TimeWindow, kind: NavKind) => void
  /** Right-click, with the time at the pointer */
  onContextMenu?: (e: React.MouseEvent, t: number) => void
  /** Shown as ticks along the bottom; a click on one goes there */
  callouts: Callout[]
  selectedCallout?: string
  onJumpToCallout: (c: Callout) => void
}

type Drag =
  | { kind: 'move'; x0: number; win: TimeWindow }
  | { kind: 'start' | 'end' }
  | { kind: 'select'; x0: number; x1: number }
  | { kind: 'callout'; callout: Callout }

/**
 * Navigator above the plot: the whole record in miniature with the visible window
 * as a box. Drag the box to pan, drag its edges to resize, drag elsewhere to mark
 * a new range to zoom into, click to centre the view.
 */
export function Overview({ channels, views, record, win, minSpan, onNavigate, onContextMenu, callouts, selectedCallout, onJumpToCallout }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tracesRef = useRef<HTMLCanvasElement | null>(null)
  const [width, setWidth] = useState(800)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [hoverPart, setHoverPart] = useState<'move' | 'edge' | null>(null)
  const [hoverCallout, setHoverCallout] = useState<Callout | null>(null)
  const moved = useRef(false)
  const { theme } = useTheme()

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
    ctx.fillStyle = theme.overviewBg
    ctx.fillRect(0, 0, width, HEIGHT)
    const nViews = Math.max(1, views.length)
    const laneH = HEIGHT / nViews
    const cols = Math.ceil(plotW * dpr)
    const mm: [number, number] = [0, 0]
    views.forEach((ids, vi) => {
      const top = vi * laneH
      if (vi > 0) {
        ctx.fillStyle = theme.grid
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
        ctx.strokeStyle = theme.ink(d.color)
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
  }, [channels, views, width, plotW, record.start, recSpan, theme])

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
    ctx.fillStyle = theme.shade
    ctx.fillRect(0, 0, Math.max(0, x0), HEIGHT)
    ctx.fillRect(x1, 0, Math.max(0, plotW - x1), HEIGHT)
    ctx.strokeStyle = theme.windowBox
    ctx.lineWidth = 1.5
    ctx.strokeRect(x0 + 0.75, 0.75, Math.max(2, x1 - x0 - 1.5), HEIGHT - 1.5)
    // trigger position
    const xt = tToX(0)
    if (xt >= 0 && xt <= plotW) {
      ctx.fillStyle = theme.trigger
      ctx.beginPath()
      ctx.moveTo(xt - 4, 0)
      ctx.lineTo(xt + 4, 0)
      ctx.lineTo(xt, 5)
      ctx.fill()
    }
    if (drag?.kind === 'select') {
      const a = Math.min(drag.x0, drag.x1)
      const b = Math.max(drag.x0, drag.x1)
      ctx.fillStyle = theme.bandFill
      ctx.fillRect(a, 0, b - a, HEIGHT)
      ctx.strokeStyle = theme.band
      ctx.strokeRect(a + 0.5, 0.5, b - a, HEIGHT - 1)
    }
    // Callouts along the bottom: regions, boxes and spans as bars, markers as lines, notes as dots
    for (const c of callouts) {
      const [ta, tb] = calloutSpan(c)
      const selected = c.id === selectedCallout
      ctx.fillStyle = theme.ink(c.color)
      ctx.strokeStyle = theme.ink(c.color)
      if (hasTimeSpan(c)) {
        const xa = tToX(ta)
        ctx.globalAlpha = selected ? 0.9 : 0.6
        ctx.fillRect(xa, HEIGHT - BAND + 2, Math.max(2, tToX(tb) - xa), BAND - 3)
      } else {
        const x = Math.round(tToX(ta)) + 0.5
        if (c.type === 'marker') {
          ctx.globalAlpha = 0.45
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x, HEIGHT)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        ctx.beginPath()
        ctx.arc(x, HEIGHT - BAND / 2, selected ? 3.5 : 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
      if (selected) {
        ctx.globalAlpha = 1
        ctx.strokeStyle = theme.selection
        ctx.lineWidth = 1
        const xa = tToX(ta)
        ctx.strokeRect(Math.round(xa - 4) + 0.5, HEIGHT - BAND - 0.5, Math.max(8, tToX(tb) - xa + 8), BAND)
      }
    }
    ctx.globalAlpha = 1
    // Label in the gutter
    ctx.fillStyle = theme.axisText
    ctx.font = PLOT_FONT
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText('Overview', plotW + 6, HEIGHT / 2)
  })

  const localX = (e: React.PointerEvent) => e.clientX - wrapRef.current!.getBoundingClientRect().left
  const localY = (e: React.PointerEvent) => e.clientY - wrapRef.current!.getBoundingClientRect().top
  const partAt = (x: number): 'start' | 'end' | 'move' | null => {
    const x0 = tToX(win.start)
    const x1 = tToX(win.end)
    if (Math.abs(x - x0) < EDGE_PX) return 'start'
    if (Math.abs(x - x1) < EDGE_PX) return 'end'
    // When the view shows (nearly) the whole record, dragging inside marks a new range instead
    if (x > x0 && x < x1 && x1 - x0 < plotW * 0.9) return 'move'
    return null
  }

  /** The callout whose tick is at (x, y): only in the strip at the bottom, points before regions */
  const calloutAt = (x: number, y: number): Callout | null => {
    if (y < HEIGHT - BAND - 2) return null
    let best: Callout | null = null
    let bestD = HIT_PX
    for (const c of callouts) {
      const [ta, tb] = calloutSpan(c)
      const xa = tToX(ta)
      const xb = tToX(tb)
      // Inside a time span counts as near, but any point within reach wins over it
      const d = x >= xa && x <= xb ? (hasTimeSpan(c) ? HIT_PX - 0.5 : 0) : Math.min(Math.abs(x - xa), Math.abs(x - xb))
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    return best
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
    const hit = calloutAt(x, localY(e))
    if (hit) {
      setDrag({ kind: 'callout', callout: hit })
      return
    }
    const part = partAt(x)
    if (part === 'move') setDrag({ kind: 'move', x0: x, win })
    else if (part) setDrag({ kind: part })
    else setDrag({ kind: 'select', x0: x, x1: x })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const x = Math.min(plotW, Math.max(0, localX(e)))
    if (!drag) {
      const hit = calloutAt(x, localY(e))
      setHoverCallout(hit)
      const part = hit ? null : partAt(x)
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
    if (drag?.kind === 'callout') {
      if (!moved.current) onJumpToCallout(drag.callout)
    } else if (drag?.kind === 'select') {
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

  // As in the plot: the wheel zooms around the pointed time, Shift+wheel or a sideways swipe pans
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const pan = wheelPan(e)
      if (pan !== undefined) {
        const shift = (win.end - win.start) * panShare(pan)
        if (shift) onNavigate({ start: win.start + shift, end: win.end + shift }, 'pan')
        return
      }
      const x = e.clientX - el.getBoundingClientRect().left
      const t = record.start + (Math.min(plotW, Math.max(0, x)) / plotW) * recSpan
      onNavigate(zoomAround(win, t, wheelZoomFactor(wheelPixels(e).y), minSpan, recSpan * 4), 'wheel')
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [win, record.start, recSpan, plotW, minSpan, onNavigate])

  const dpr = window.devicePixelRatio || 1
  const cursor =
    drag?.kind === 'move'
      ? 'grabbing'
      : drag?.kind === 'callout' || (!drag && hoverCallout)
        ? 'pointer'
        : drag
          ? 'ew-resize'
          : hoverPart === 'move'
            ? 'grab'
            : hoverPart === 'edge'
              ? 'ew-resize'
              : 'crosshair'
  return (
    <div
      ref={wrapRef}
      className="overview"
      style={{ cursor }}
      title={
        hoverCallout
          ? `${calloutTitle(hoverCallout)}: click to go there`
          : 'Overview: drag to mark a range to zoom into, drag the box to move it, drag its edges to resize. Callouts are marked along the bottom.'
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => {
        if (drag) return
        setHoverPart(null)
        setHoverCallout(null)
      }}
      onContextMenu={(e) => onContextMenu?.(e, xToT(Math.min(plotW, Math.max(0, e.clientX - e.currentTarget.getBoundingClientRect().left))))}
    >
      <canvas ref={canvasRef} width={Math.round(width * dpr)} height={Math.round(HEIGHT * dpr)} style={{ width, height: HEIGHT, display: 'block' }} />
    </div>
  )
}
