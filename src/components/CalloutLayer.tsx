import { forwardRef, useEffect, useState } from 'react'
import { CALLOUT_COLORS, calloutTitle, type Callout } from '../model/callouts'
import { DIVS_Y, valueAt, valueToDiv } from '../render/draw'
import { si } from '../util/format'
import type { LiveChannel, TimeWindow } from './state'

const FONT_SIZE = 12
const FONT = `${FONT_SIZE}px system-ui, 'Segoe UI', Roboto, sans-serif`
const LINE_H = 16
const PAD = 6
const FLAG_Y = 18
const FLAG_H = 18

interface Props {
  callouts: Callout[]
  channels: LiveChannel[]
  views: string[][]
  win: TimeWindow
  plotW: number
  viewH: number
  selectedId?: string
  editingId?: string
  onSelect: (id: string | undefined) => void
  onUpdate: (id: string, patch: Partial<Callout>) => void
  onEdit: (id: string | null) => void
  onDelete: (id: string) => void
}

type Part = 'box' | 'anchor' | 'marker' | 'start' | 'end' | 'region'
interface Drag {
  id: string
  part: Part
  x0: number
  y0: number
  orig: Callout
}

let measureCtx: CanvasRenderingContext2D | null = null
function textWidth(s: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return s.length * 7
  measureCtx.font = FONT
  return measureCtx.measureText(s).width
}

interface NoteGeo {
  ax: number
  ay: number
  bx: number
  by: number
  bw: number
  bh: number
  lines: string[]
}

/** Screen geometry of a note, or null when its anchor is not visible. */
function noteGeometry(c: Callout, p: Props): NoteGeo | null {
  const span = p.win.end - p.win.start
  const ax = ((c.t - p.win.start) / span) * p.plotW
  if (ax < -1 || ax > p.plotW + 1) return null
  const divH = p.viewH / DIVS_Y
  let ay: number | undefined
  const ch = c.channel ? p.channels.find((x) => x.wave.id === c.channel) : undefined
  const vi = ch ? p.views.findIndex((v) => v.includes(ch.wave.id)) : -1
  if (ch && ch.display.visible && vi >= 0) {
    const v = valueAt(ch.wave, c.t)
    if (Number.isFinite(v)) ay = vi * p.viewH + p.viewH / 2 - valueToDiv(v, ch.display) * divH
  }
  if (ay === undefined) {
    if (c.view === undefined || c.div === undefined) return null
    const v = Math.min(p.views.length - 1, Math.max(0, c.view))
    ay = v * p.viewH + p.viewH / 2 - c.div * divH
  }
  const lines = (c.text || calloutTitle(c)).split('\n')
  const bw = Math.ceil(Math.max(...lines.map(textWidth))) + PAD * 2
  const bh = lines.length * LINE_H + PAD
  return { ax, ay, bx: ax + (c.dx ?? 24), by: ay + (c.dy ?? -46), bw, bh, lines }
}

function markerGeometry(c: Callout, p: Props) {
  const x = ((c.t - p.win.start) / (p.win.end - p.win.start)) * p.plotW
  if (x < -1 || x > p.plotW + 1) return null
  const label = calloutTitle(c)
  const w = textWidth(label) + 14
  return { x, fx: x + w > p.plotW ? x - w : x, w, label }
}

function regionGeometry(c: Callout, p: Props) {
  const tToX = (t: number) => ((t - p.win.start) / (p.win.end - p.win.start)) * p.plotW
  const t2 = c.t2 ?? c.t
  const xa = tToX(Math.min(c.t, t2))
  const xb = tToX(Math.max(c.t, t2))
  if (xb < -1 || xa > p.plotW + 1) return null
  const label = `${calloutTitle(c)}  Δt ${si(Math.abs(t2 - c.t), 's')}`
  const w = textWidth(label) + 14
  // Region labels sit at the bottom of the plot (markers use the top)
  const totalH = p.viewH * Math.max(1, p.views.length)
  return { xa, xb, lx: Math.min(Math.max(xa, 0) + 4, p.plotW - w - 2), ly: totalH - FLAG_H - 6, w, label }
}

/** Where the inline editor of a callout goes (below its label) */
function editorPosition(c: Callout, p: Props): { left: number; top: number } | null {
  if (c.type === 'note') {
    const g = noteGeometry(c, p)
    return g && { left: g.bx, top: g.by + g.bh + 4 }
  }
  if (c.type === 'marker') {
    const g = markerGeometry(c, p)
    return g && { left: g.fx, top: FLAG_Y + FLAG_H + 6 }
  }
  const g = regionGeometry(c, p)
  return g && { left: g.lx, top: g.ly - 112 }
}

/**
 * SVG overlay with all callouts. Only the callouts themselves take pointer events, so
 * panning/zooming still works everywhere else on the plot.
 */
export const CalloutLayer = forwardRef<SVGSVGElement, Props>(function CalloutLayer(p, ref) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const span = p.win.end - p.win.start
  const totalH = p.viewH * Math.max(1, p.views.length)

  // Dragging uses window listeners so it keeps working when the pointer leaves the element
  useEffect(() => {
    if (!drag) return
    const svg = (ref as React.RefObject<SVGSVGElement | null>).current
    const move = (e: PointerEvent) => {
      if (!svg) return
      const r = svg.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      const dT = ((x - drag.x0) / p.plotW) * span
      const o = drag.orig
      switch (drag.part) {
        case 'box':
          p.onUpdate(o.id, { dx: (o.dx ?? 24) + (x - drag.x0), dy: (o.dy ?? -46) + (y - drag.y0) })
          break
        case 'anchor': {
          const t = p.win.start + (Math.min(p.plotW, Math.max(0, x)) / p.plotW) * span
          if (o.channel) p.onUpdate(o.id, { t })
          else {
            const vi = Math.min(p.views.length - 1, Math.max(0, Math.floor(y / p.viewH)))
            p.onUpdate(o.id, { t, view: vi, div: DIVS_Y / 2 - (y - vi * p.viewH) / (p.viewH / DIVS_Y) })
          }
          break
        }
        case 'marker':
          p.onUpdate(o.id, { t: o.t + dT })
          break
        case 'start':
          p.onUpdate(o.id, { t: o.t + dT })
          break
        case 'end':
          p.onUpdate(o.id, { t2: (o.t2 ?? o.t) + dT })
          break
        case 'region':
          p.onUpdate(o.id, { t: o.t + dT, t2: (o.t2 ?? o.t) + dT })
          break
      }
    }
    const up = () => {
      const c = p.callouts.find((x) => x.id === drag.id)
      if (c?.type === 'region' && c.t2 !== undefined && c.t2 < c.t) p.onUpdate(c.id, { t: c.t2, t2: c.t })
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, p, span, ref])

  const startDrag = (c: Callout, part: Part) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const svg = (ref as React.RefObject<SVGSVGElement | null>).current
    const r = svg?.getBoundingClientRect()
    p.onSelect(c.id)
    setDrag({ id: c.id, part, x0: e.clientX - (r?.left ?? 0), y0: e.clientY - (r?.top ?? 0), orig: c })
  }
  const edit = (c: Callout) => (e: React.MouseEvent) => {
    e.stopPropagation()
    p.onEdit(c.id)
  }

  // Draw regions first, then markers, then notes on top
  const order = { region: 0, marker: 1, note: 2 }
  const sorted = [...p.callouts].sort((a, b) => order[a.type] - order[b.type])

  const items = sorted.map((c) => {
    const selected = c.id === p.selectedId
    const handlers = (part: Part) => ({
      onPointerDown: startDrag(c, part),
      onDoubleClick: edit(c),
      style: { pointerEvents: 'auto' as const, cursor: part === 'box' || part === 'region' ? 'move' : part === 'anchor' ? 'pointer' : 'ew-resize' },
    })

    if (c.type === 'note') {
      const g = noteGeometry(c, p)
      if (!g) return null
      const lx = Math.min(Math.max(g.ax, g.bx), g.bx + g.bw)
      const ly = Math.min(Math.max(g.ay, g.by), g.by + g.bh)
      return (
        <g key={c.id}>
          <line x1={g.ax} y1={g.ay} x2={lx} y2={ly} stroke={c.color} strokeWidth={1.2} />
          <rect x={g.bx} y={g.by} width={g.bw} height={g.bh} rx={4} fill="rgba(12,15,20,0.92)" stroke={c.color} strokeWidth={1.2} {...handlers('box')} />
          {selected && <rect data-ui="selection" x={g.bx - 3} y={g.by - 3} width={g.bw + 6} height={g.bh + 6} rx={6} fill="none" stroke="#fff" strokeDasharray="3 3" />}
          <text x={g.bx + PAD} y={g.by + PAD / 2 + LINE_H - 4} fill={c.text ? '#e8ecf2' : '#8a94a3'} fontSize={FONT_SIZE} fontFamily="system-ui, 'Segoe UI', Roboto, sans-serif" style={{ pointerEvents: 'none' }}>
            {g.lines.map((l, i) => (
              <tspan key={i} x={g.bx + PAD} dy={i === 0 ? 0 : LINE_H}>
                {l || ' '}
              </tspan>
            ))}
          </text>
          <circle cx={g.ax} cy={g.ay} r={selected ? 5 : 4} fill={c.color} stroke="#000" strokeWidth={1} {...handlers('anchor')} />
        </g>
      )
    }

    if (c.type === 'marker') {
      const g = markerGeometry(c, p)
      if (!g) return null
      const { x, fx, w, label } = g
      return (
        <g key={c.id}>
          <line x1={x} y1={0} x2={x} y2={totalH} stroke={c.color} strokeWidth={selected ? 2 : 1.2} strokeDasharray="6 4" />
          <line x1={x} y1={0} x2={x} y2={totalH} stroke="transparent" strokeWidth={10} {...handlers('marker')} />
          <rect x={fx} y={FLAG_Y} width={w} height={FLAG_H} rx={3} fill={c.color} {...handlers('marker')} />
          {selected && <rect data-ui="selection" x={fx - 3} y={FLAG_Y - 3} width={w + 6} height={FLAG_H + 6} rx={5} fill="none" stroke="#fff" strokeDasharray="3 3" />}
          <text x={fx + 7} y={FLAG_Y + 13} fill="#000" fontSize={FONT_SIZE} fontWeight={600} fontFamily="system-ui, 'Segoe UI', Roboto, sans-serif" style={{ pointerEvents: 'none' }}>
            {label}
          </text>
        </g>
      )
    }

    // region
    const g = regionGeometry(c, p)
    if (!g) return null
    const { xa, xb, lx, ly, w, label } = g
    const [startPart, endPart]: Part[] = c.t <= (c.t2 ?? c.t) ? ['start', 'end'] : ['end', 'start']
    return (
      <g key={c.id}>
        <rect x={xa} y={0} width={Math.max(1, xb - xa)} height={totalH} fill={c.color} fillOpacity={selected ? 0.18 : 0.11} />
        <line x1={xa} y1={0} x2={xa} y2={totalH} stroke={c.color} strokeWidth={1.2} />
        <line x1={xb} y1={0} x2={xb} y2={totalH} stroke={c.color} strokeWidth={1.2} />
        <line x1={xa} y1={0} x2={xa} y2={totalH} stroke="transparent" strokeWidth={10} {...handlers(startPart)} />
        <line x1={xb} y1={0} x2={xb} y2={totalH} stroke="transparent" strokeWidth={10} {...handlers(endPart)} />
        <rect x={lx} y={ly} width={w} height={FLAG_H} rx={3} fill="rgba(12,15,20,0.9)" stroke={c.color} {...handlers('region')} />
        {selected && <rect data-ui="selection" x={lx - 3} y={ly - 3} width={w + 6} height={FLAG_H + 6} rx={5} fill="none" stroke="#fff" strokeDasharray="3 3" />}
        <text x={lx + 7} y={ly + 13} fill={c.color} fontSize={FONT_SIZE} fontFamily="system-ui, 'Segoe UI', Roboto, sans-serif" style={{ pointerEvents: 'none' }}>
          {label}
        </text>
      </g>
    )
  })

  const editing = p.callouts.find((c) => c.id === p.editingId)
  const pos = editing ? editorPosition(editing, p) : null

  return (
    <>
      <svg
        ref={ref}
        className="callout-layer"
        xmlns="http://www.w3.org/2000/svg"
        width={p.plotW}
        height={totalH}
        viewBox={`0 0 ${p.plotW} ${totalH}`}
      >
        {items}
      </svg>
      {editing && pos && (
        <div
          className="callout-editor"
          style={{ left: Math.max(4, Math.min(p.plotW - 250, pos.left)), top: Math.max(4, Math.min(totalH - 110, pos.top)) }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <textarea
            autoFocus
            rows={2}
            value={editing.text}
            placeholder={editing.type === 'note' ? 'Describe the event…' : 'Label (optional)'}
            onChange={(e) => p.onUpdate(editing.id, { text: e.target.value })}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
                e.preventDefault()
                p.onEdit(null)
              }
            }}
            onBlur={() => p.onEdit(null)}
          />
          <div className="callout-editor-row">
            {CALLOUT_COLORS.map((col) => (
              <button
                key={col}
                className={`swatch ${editing.color === col ? 'active' : ''}`}
                style={{ background: col }}
                title="Colour"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => p.onUpdate(editing.id, { color: col })}
              />
            ))}
            <span className="spacer" />
            <button className="text-btn danger" onMouseDown={(e) => e.preventDefault()} onClick={() => p.onDelete(editing.id)}>
              Delete
            </button>
          </div>
          <div className="callout-editor-hint">Enter to finish · Shift+Enter for a new line</div>
        </div>
      )}
    </>
  )
})
