import { useDeferredValue, useMemo, useRef } from 'react'
import { X } from 'lucide-react'
import { MEASUREMENT_DEFS, measure, type MeasurementKey, type Measurements } from '../dsp/measure'
import { si } from '../util/format'
import type { CursorState, LiveChannel, MeasureRange, TimeWindow } from './state'

interface Props {
  channels: LiveChannel[]
  win: TimeWindow
  cursors: CursorState
  range: MeasureRange
  setRange: (r: MeasureRange) => void
  keys: MeasurementKey[]
  setKeys: (k: MeasurementKey[]) => void
  height: number
  setHeight: (h: number) => void
  onClose: () => void
}

export function MeasurementTable(p: Props) {
  // Deferred so panning/zooming stays smooth on long records
  const win = useDeferredValue(p.win)
  const cursors = useDeferredValue(p.cursors)
  const visible = p.channels.filter((c) => c.display.visible)

  const results = useMemo(() => {
    const out = new Map<string, Measurements>()
    for (const c of p.channels) {
      if (!c.display.visible) continue
      const w = c.wave
      let i0 = 0
      let i1 = w.data.length
      if (p.range === 'screen') {
        i0 = (win.start - w.t0) / w.dt
        i1 = (win.end - w.t0) / w.dt + 1
      } else if (p.range === 'cursors') {
        i0 = (Math.min(cursors.a, cursors.b) - w.t0) / w.dt
        i1 = (Math.max(cursors.a, cursors.b) - w.t0) / w.dt + 1
      }
      out.set(w.id, measure(w.data, i0, i1, w.t0, w.dt))
    }
    return out
  }, [p.channels, p.range, win, cursors])

  const defs = p.keys.map((k) => MEASUREMENT_DEFS.find((d) => d.key === k)!)
  const unused = MEASUREMENT_DEFS.filter((d) => !p.keys.includes(d.key))

  // Drag the top edge to resize the panel
  const resize = useRef<{ y0: number; h0: number } | null>(null)
  const onResizeDown = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    resize.current = { y0: e.clientY, h0: p.height }
  }
  const onResizeMove = (e: React.PointerEvent) => {
    if (!resize.current) return
    p.setHeight(Math.round(Math.min(window.innerHeight * 0.6, Math.max(90, resize.current.h0 - (e.clientY - resize.current.y0)))))
  }

  return (
    <div className="measure" style={{ height: p.height }}>
      <div
        className="resize-handle"
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={() => (resize.current = null)}
      />
      <div className="measure-bar">
        <span className="section-title">Measurements</span>
        <div className="segmented">
          {(['screen', 'cursors', 'record'] as const).map((r) => (
            <button key={r} className={p.range === r ? 'active' : ''} onClick={() => p.setRange(r)}>
              {r === 'screen' ? 'On screen' : r === 'cursors' ? 'Between cursors' : 'Whole record'}
            </button>
          ))}
        </div>
        <select
          value=""
          onChange={(e) => e.target.value && p.setKeys([...p.keys, e.target.value as MeasurementKey])}
          disabled={!unused.length}
        >
          <option value="">+ Add measurement</option>
          {unused.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button type="button" className="icon-btn" title="Hide measurements (T)" aria-label="Hide measurements" onClick={p.onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="measure-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Channel</th>
              {defs.map((d) => (
                <th key={d.key}>
                  {d.label}
                  <button className="x" title="Remove" onClick={() => p.setKeys(p.keys.filter((k) => k !== d.key))}>
                    ×
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => {
              const m = results.get(c.wave.id)
              return (
                <tr key={c.wave.id}>
                  <td>
                    <span className="dot" style={{ background: c.display.color }} />
                    {c.wave.id}
                    {c.display.label && <span className="muted"> {c.display.label}</span>}
                  </td>
                  {defs.map((d) => (
                    <td key={d.key} className="mono">
                      {m ? fmt(m[d.key], d.unit, c.wave.yUnit) : ''}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function fmt(v: number, unit: 'y' | 's' | 'Hz' | '%', yUnit: string): string {
  if (unit === '%') return Number.isFinite(v) ? `${v.toFixed(2)} %` : '—'
  return si(v, unit === 'y' ? yUnit : unit)
}
