import { forwardRef, useEffect, useState } from 'react'
import { CALLOUT_COLORS, type Callout } from '../model/callouts'
import { calloutShapes, type CalloutGeo, type CalloutLayout, type CalloutPart } from '../render/callouts'
import { CalloutValueEditor } from './CalloutValueEditor'
import { DIVS_Y } from '../render/draw'
import { useTheme } from './ui/themeContext'

interface Props extends CalloutLayout {
  callouts: Callout[]
  /** Screen geometry of the callouts (layoutCallouts) */
  geo: Map<string, CalloutGeo>
  /** Time of an edge of the selected trace near t: markers and region edges snap to it */
  snap?: (t: number) => number | undefined
  selectedId?: string
  editingId?: string
  onSelect: (id: string | undefined) => void
  onUpdate: (id: string, patch: Partial<Callout>) => void
  onEdit: (id: string | null) => void
  onDelete: (id: string) => void
  onContextMenu?: (e: React.MouseEvent, c: Callout) => void
}

interface Drag {
  id: string
  part: CalloutPart
  x0: number
  y0: number
  orig: Callout
  /** Note box as shown when the drag started */
  box?: { ax: number; ay: number; bx: number; by: number; bw: number; bh: number }
}

/** Where the inline editor of a callout goes: below its label, above it for regions (labels at the bottom) */
function editorPosition(g: CalloutGeo | undefined): { left: number; top: number; above?: boolean } | null {
  if (!g) return null
  if (g.type === 'note') return { left: g.bx, top: g.by + g.bh + 4 }
  if (g.type === 'marker') return { left: g.fx, top: g.fy + g.h + 6 }
  return { left: g.lx, top: g.ly - 6, above: true }
}

/**
 * SVG overlay with all callouts. Only the callouts themselves take pointer events, so
 * panning/zooming still works everywhere else on the plot.
 */
export const CalloutLayer = forwardRef<SVGSVGElement, Props>(function CalloutLayer(p, ref) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const { theme } = useTheme()
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
      // Markers and region edges snap to edges of the selected trace; Alt moves them freely
      const snapped = (t: number) => (e.altKey ? t : (p.snap?.(t) ?? t))
      switch (drag.part) {
        case 'box': {
          // The box stays inside the plot, so the stored offset never runs past the edge either
          const b = drag.box
          if (!b) break
          const bx = Math.max(2, Math.min(p.plotW - b.bw - 2, b.bx + x - drag.x0))
          const by = Math.max(2, Math.min(totalH - b.bh - 2, b.by + y - drag.y0))
          p.onUpdate(o.id, { dx: bx - b.ax, dy: by - b.ay })
          break
        }
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
        case 'start':
          p.onUpdate(o.id, { t: snapped(o.t + dT) })
          break
        case 'end':
          p.onUpdate(o.id, { t2: snapped((o.t2 ?? o.t) + dT) })
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
  }, [drag, p, span, totalH, ref])

  const startDrag = (c: Callout, part: CalloutPart) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const svg = (ref as React.RefObject<SVGSVGElement | null>).current
    const r = svg?.getBoundingClientRect()
    p.onSelect(c.id)
    const g = p.geo.get(c.id)
    const box = g?.type === 'note' ? { ax: g.ax, ay: g.ay, bx: g.bx, by: g.by, bw: g.bw, bh: g.bh } : undefined
    setDrag({ id: c.id, part, x0: e.clientX - (r?.left ?? 0), y0: e.clientY - (r?.top ?? 0), orig: c, box })
  }
  const edit = (c: Callout) => (e: React.MouseEvent) => {
    e.stopPropagation()
    p.onEdit(c.id)
  }

  const items = calloutShapes(
    p.callouts,
    p,
    theme,
    p.selectedId,
    (c, part) => ({
      onPointerDown: startDrag(c, part),
      onDoubleClick: edit(c),
      onContextMenu: (e: React.MouseEvent) => {
        if (!p.onContextMenu) return
        e.stopPropagation()
        p.onSelect(c.id)
        p.onContextMenu(e, c)
      },
      style: { pointerEvents: 'auto' as const, cursor: part === 'box' || part === 'region' ? 'move' : part === 'anchor' ? 'pointer' : 'ew-resize' },
    }),
    p.geo,
  )

  const editing = p.callouts.find((c) => c.id === p.editingId)
  const pos = editing ? editorPosition(p.geo.get(editing.id)) : null

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
          style={{
            left: Math.max(4, Math.min(p.plotW - 250, pos.left)),
            ...(pos.above ? { top: pos.top, transform: 'translateY(-100%)' } : { top: Math.max(4, Math.min(totalH - 140, pos.top)) }),
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          // Done when the focus leaves the editor (not when it moves to the measure selection)
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && p.onEdit(null)}
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
          />
          <CalloutValueEditor callout={editing} sources={p.channels.map((c) => c.wave.id)} onUpdate={(patch) => p.onUpdate(editing.id, patch)} keepFocus />
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
          <div className="callout-editor-hint">Enter to finish · Shift+Enter for a new line · $…$ for math</div>
        </div>
      )}
    </>
  )
})
