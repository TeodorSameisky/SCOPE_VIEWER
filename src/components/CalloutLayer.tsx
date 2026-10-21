import { forwardRef, useEffect, useState } from 'react'
import { CALLOUT_COLORS, type Callout } from '../model/callouts'
import { FLAG_H, FLAG_Y, calloutShapes, markerGeometry, noteGeometry, regionGeometry, type CalloutLayout, type CalloutPart } from '../render/callouts'
import { DIVS_Y } from '../render/draw'
import { DARK_THEME } from '../render/theme'

interface Props extends CalloutLayout {
  callouts: Callout[]
  selectedId?: string
  editingId?: string
  onSelect: (id: string | undefined) => void
  onUpdate: (id: string, patch: Partial<Callout>) => void
  onEdit: (id: string | null) => void
  onDelete: (id: string) => void
}

interface Drag {
  id: string
  part: CalloutPart
  x0: number
  y0: number
  orig: Callout
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

  const startDrag = (c: Callout, part: CalloutPart) => (e: React.PointerEvent) => {
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

  const items = calloutShapes(p.callouts, p, DARK_THEME, p.selectedId, (c, part) => ({
    onPointerDown: startDrag(c, part),
    onDoubleClick: edit(c),
    style: { pointerEvents: 'auto' as const, cursor: part === 'box' || part === 'region' ? 'move' : part === 'anchor' ? 'pointer' : 'ew-resize' },
  }))

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
