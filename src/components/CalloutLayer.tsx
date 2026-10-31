import { forwardRef, memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Callout } from '../model/callouts'
import { SPAN_DY, calloutShapes, type CalloutGeo, type CalloutLayout, type CalloutPart } from '../render/callouts'
import { CalloutValueEditor } from './CalloutValueEditor'
import { ColorSwatches } from './ColorSwatches'
import { DIVS_Y, viewAt, viewsHeight } from '../render/draw'
import { useTheme } from './ui/themeContext'

interface Props extends CalloutLayout {
  callouts: Callout[]
  /** Screen geometry of the callouts (layoutCallouts) */
  geo: Map<string, CalloutGeo>
  /** Time of an edge of the selected trace near t: markers and region edges snap to it */
  snap?: (t: number) => number | undefined
  /** The same for any channel: box edges snap to edges of their channel, span ends to those of their trace */
  snapOn?: (channel: string | undefined) => (t: number) => number | undefined
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

/** Height of the inline editor until it has been measured (px) */
const EDITOR_H = 150

/**
 * Where the inline editor of a callout (`h` px high) goes: below it, above the label for regions
 * (labels at the bottom). Boxes and spans get it on the side with room, else the roomier side.
 */
function editorPosition(g: CalloutGeo | undefined, totalH: number, h: number): { left: number; top: number; above?: boolean } | null {
  if (!g) return null
  if (g.type === 'note') return { left: g.bx, top: g.by + g.bh + 4 }
  if (g.type === 'marker') return { left: g.fx, top: g.fy + g.h + 6 }
  if (g.type === 'box' || g.type === 'span') {
    const [below, above] = g.type === 'box' ? [Math.max(g.y + g.h, g.ly + g.lh) + 6, Math.min(g.y, g.ly) - 6] : [g.y + 8, g.ly - 6]
    const left = g.type === 'box' ? g.x : g.lx
    const useBelow = below + h <= totalH || (above - h < 0 && totalH - below >= above)
    return useBelow ? { left, top: below } : { left, top: Math.max(h + 4, above), above: true }
  }
  return { left: g.lx, top: g.ly - 6, above: true }
}

const PART_CURSOR: Record<CalloutPart, string> = {
  box: 'move',
  region: 'move',
  rect: 'move',
  anchor: 'pointer',
  marker: 'ew-resize',
  start: 'ew-resize',
  end: 'ew-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  dim: 'ns-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
}

/**
 * SVG overlay with all callouts. Only the callouts themselves take pointer events, so
 * panning/zooming still works everywhere else on the plot. Memoized: moving the pointer over the
 * plot re-renders the plot, but not the callouts.
 */
export const CalloutLayer = memo(forwardRef<SVGSVGElement, Props>(function CalloutLayer(p, ref) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const { theme } = useTheme()
  const span = p.win.end - p.win.start
  const totalH = viewsHeight(p.boxes)

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
      // Upwards in divisions of the callout's view, and in the unit of a box's channel
      const vi = o.channel ? p.views.findIndex((v) => v.includes(o.channel!)) : (o.view ?? 0)
      const dDiv = -(y - drag.y0) / (p.boxes.heights[Math.min(p.views.length - 1, Math.max(0, vi))] / DIVS_Y)
      // Markers and region edges snap to edges of the selected trace, box edges and span ends to
      // those of their own channel; Alt moves them freely
      const snapped = (t: number) => (e.altKey ? t : (p.snap?.(t) ?? t))
      const snappedOn = (channel: string | undefined, t: number) => (e.altKey ? t : (p.snapOn?.(channel)(t) ?? t))
      const scale = p.channels.find((c) => c.wave.id === o.channel)?.display.scale
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
            const at = viewAt(p.boxes, y)
            p.onUpdate(o.id, { t, view: at, div: DIVS_Y / 2 - (y - p.boxes.tops[at]) / (p.boxes.heights[at] / DIVS_Y) })
          }
          break
        }
        case 'marker':
        case 'start':
          p.onUpdate(o.id, { t: o.type === 'span' ? snappedOn(o.channel, o.t + dT) : snapped(o.t + dT) })
          break
        case 'end': {
          const t2 = (o.t2 ?? o.t) + dT
          p.onUpdate(o.id, { t2: o.type === 'span' ? snappedOn(o.channel2, t2) : snapped(t2) })
          break
        }
        case 'region':
          p.onUpdate(o.id, { t: o.t + dT, t2: (o.t2 ?? o.t) + dT })
          break
        case 'dim':
          p.onUpdate(o.id, { dy: (o.dy ?? SPAN_DY) + y - drag.y0 })
          break
        case 'rect':
          // A box moves in time and in value
          p.onUpdate(o.id, {
            t: o.t + dT,
            t2: (o.t2 ?? o.t) + dT,
            ...(o.v !== undefined && o.v2 !== undefined && scale !== undefined
              ? { v: o.v + dDiv * scale, v2: o.v2 + dDiv * scale }
              : { div: (o.div ?? 0) + dDiv, div2: (o.div2 ?? 0) + dDiv }),
          })
          break
        default: {
          // An edge or a corner of a box: the letters of the compass direction say which edges move
          const part = drag.part
          const t2 = o.t2 ?? o.t
          const patch: Partial<Callout> = { t: Math.min(o.t, t2), t2: Math.max(o.t, t2) }
          if (part.includes('w')) patch.t = snappedOn(o.channel, patch.t! + dT)
          if (part.includes('e')) patch.t2 = snappedOn(o.channel, patch.t2! + dT)
          if (part.includes('n') || part.includes('s')) {
            // Levels: the upper one first; in the channel's unit, or in divisions for a free box
            const onChannel = o.v !== undefined && o.v2 !== undefined && scale !== undefined
            const [a, b] = onChannel ? [o.v!, o.v2!] : [o.div ?? 0, o.div2 ?? 0]
            const step = onChannel ? dDiv * scale : dDiv
            const upper = Math.max(a, b) + (part.includes('n') ? step : 0)
            const lower = Math.min(a, b) + (part.includes('s') ? step : 0)
            Object.assign(patch, onChannel ? { v: upper, v2: lower } : { div: upper, div2: lower })
          }
          p.onUpdate(o.id, patch)
        }
      }
    }
    const up = () => {
      const c = p.callouts.find((x) => x.id === drag.id)
      if ((c?.type === 'region' || c?.type === 'box') && c.t2 !== undefined && c.t2 < c.t) p.onUpdate(c.id, { t: c.t2, t2: c.t })
      setDrag(null)
    }
    // Esc (or a cancelled pointer) puts the callout back where it was
    const cancel = () => {
      // Fields the drag may have added are cleared, then the callout as it was is restored
      p.onUpdate(drag.id, { t2: undefined, v: undefined, v2: undefined, view: undefined, div: undefined, div2: undefined, dx: undefined, dy: undefined, ...drag.orig })
      setDrag(null)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      cancel()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
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
      style: { pointerEvents: 'auto' as const, cursor: PART_CURSOR[part] },
    }),
    p.geo,
  )

  const editing = p.callouts.find((c) => c.id === p.editingId)
  // The editor is placed by its height, measured once it is shown (it grows with the measurement choice)
  const editorRef = useRef<HTMLDivElement>(null)
  const [editorH, setEditorH] = useState(EDITOR_H)
  useLayoutEffect(() => {
    const h = editorRef.current?.offsetHeight
    if (h && Math.abs(h - editorH) > 2) setEditorH(h)
  }, [editing, editorH])
  const pos = editing ? editorPosition(p.geo.get(editing.id), totalH, editorH) : null

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
          ref={editorRef}
          className="callout-editor"
          style={{
            left: Math.max(4, Math.min(p.plotW - 250, pos.left)),
            ...(pos.above ? { top: pos.top, transform: 'translateY(-100%)' } : { top: Math.max(4, Math.min(totalH - editorH, pos.top)) }),
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
          <CalloutValueEditor
            callout={editing}
            sources={p.channels.map((c) => c.wave.id)}
            displays={p.channels.map((c) => c.display)}
            onUpdate={(patch) => p.onUpdate(editing.id, patch)}
            keepFocus
          />
          <div className="callout-editor-row">
            <ColorSwatches value={editing.color} onChange={(color) => p.onUpdate(editing.id, { color })} keepFocus />
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
}))
