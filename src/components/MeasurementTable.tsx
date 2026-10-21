import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import { BookOpen, Info, Plus, X } from 'lucide-react'
import { measure, type MeasurementKey, type Measurements } from '../dsp/measure'
import { MEASURE_GROUP_LABEL, MEASUREMENT_DEFS, measurementDef, type MeasurementDef } from '../dsp/measureDefs'
import type { Waveform } from '../model/types'
import { si } from '../util/format'
import { channelName } from '../util/names'
import { MeasureInfo } from './MeasureInfo'
import { sampleRange, type CursorState, type LiveChannel, type MeasureRange, type TimeWindow } from './state'
import { useDismiss } from './ui/useDismiss'

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
  /** Open the measurement reference, optionally at one measurement */
  onOpenReference: (key?: MeasurementKey) => void
}

interface Anchor {
  left: number
  /** just below the clicked element */
  top: number
  /** just above the clicked element */
  above: number
}
type Popup = ({ kind: 'info'; key: MeasurementKey } | { kind: 'add' }) & Anchor

export function MeasurementTable(p: Props) {
  // Deferred so panning/zooming stays smooth on long records
  const win = useDeferredValue(p.win)
  const cursors = useDeferredValue(p.cursors)
  const visible = p.channels.filter((c) => c.display.visible)

  // Results are cached per waveform and sample range, so changing a colour or label
  // (which creates new channel objects) does not recompute anything.
  const [cache] = useState(() => new WeakMap<Waveform, { key: string; m: Measurements }>())
  const results = useMemo(() => {
    const out = new Map<string, Measurements>()
    for (const c of p.channels) {
      if (!c.display.visible) continue
      const w = c.wave
      const [i0, i1] = sampleRange(w, p.range, win, cursors)
      const key = `${Math.max(0, Math.floor(i0))}:${Math.min(w.data.length, Math.ceil(i1))}`
      const hit = cache.get(w)
      if (hit?.key === key) out.set(w.id, hit.m)
      else {
        const m = measure(w.data, i0, i1, w.t0, w.dt)
        cache.set(w, { key, m })
        out.set(w.id, m)
      }
    }
    return out
  }, [p.channels, p.range, win, cursors, cache])

  const defs = p.keys.map(measurementDef)
  const unused = MEASUREMENT_DEFS.filter((d) => !p.keys.includes(d.key))

  // Popovers (measurement info, add picker), positioned fixed so the scroll area does not clip them
  const [popup, setPopup] = useState<Popup | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const closePopup = useCallback(() => setPopup(null), [])
  useDismiss(popRef, popup !== null, closePopup)
  const openAt = (e: React.MouseEvent, popup: { kind: 'info'; key: MeasurementKey } | { kind: 'add' }) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const width = 340
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    setPopup({ ...popup, left, top: r.bottom + 6, above: r.top - 6 })
  }

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

  const popupStyle = (pp: Popup): React.CSSProperties => {
    // open on the side with more room; scroll inside if it still does not fit
    const below = window.innerHeight - pp.top - 8
    const above = pp.above - 8
    return below >= 360 || below >= above
      ? { left: pp.left, top: pp.top, maxHeight: below, overflowY: 'auto' }
      : { left: pp.left, bottom: window.innerHeight - pp.above, maxHeight: above, overflowY: 'auto' }
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
        <button type="button" className="icon-btn with-label" disabled={!unused.length} onClick={(e) => openAt(e, { kind: 'add' })}>
          <Plus size={16} aria-hidden />
          <span>Add measurement</span>
        </button>
        <span className="spacer" />
        <button type="button" className="icon-btn" title="How measurements work" aria-label="Measurement reference" onClick={() => p.onOpenReference()}>
          <BookOpen size={16} />
        </button>
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
                  <button
                    type="button"
                    className="th-btn"
                    title={`${d.short} Click for details.`}
                    onClick={(e) => openAt(e, { kind: 'info', key: d.key })}
                  >
                    {d.label}
                    <Info size={12} aria-hidden />
                  </button>
                  <button className="x" title="Remove" aria-label={`Remove ${d.label}`} onClick={() => p.setKeys(p.keys.filter((k) => k !== d.key))}>
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
                    {channelName(c.wave.id)}
                    {c.display.label && <span className="muted"> {c.display.label}</span>}
                  </td>
                  {defs.map((d) => {
                    const v = m?.[d.key]
                    return (
                      <td key={d.key} className="mono" title={m && v !== undefined && !Number.isFinite(v) ? whyMissing(d, m) : undefined}>
                        {m && v !== undefined ? fmt(v, d.unit, c.wave.yUnit) : ''}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {popup && (
        <div ref={popRef} className="popover" style={{ position: 'fixed', width: 340, ...popupStyle(popup) }}>
          {popup.kind === 'info' ? (
            <>
              <MeasureInfo def={measurementDef(popup.key)} compact />
              <button
                type="button"
                className="text-btn"
                onClick={() => {
                  p.onOpenReference(popup.key)
                  setPopup(null)
                }}
              >
                Open measurement reference
              </button>
            </>
          ) : (
            <div className="add-list">
              {(['amplitude', 'timing'] as const).map((g) => {
                const list = unused.filter((d) => d.group === g)
                if (!list.length) return null
                return (
                  <div key={g}>
                    <div className="add-group">{MEASURE_GROUP_LABEL[g]}</div>
                    {list.map((d) => (
                      <button
                        key={d.key}
                        type="button"
                        className="add-item"
                        onClick={() => {
                          p.setKeys([...p.keys, d.key])
                          if (unused.length <= 1) setPopup(null)
                        }}
                      >
                        <strong>{d.label}</strong>
                        <span>{d.short}</span>
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function whyMissing(d: MeasurementDef, m: Measurements): string {
  if (m.count === 0) return 'No samples of this channel in the range'
  if (d.group === 'timing' && !m.levelsOk) return 'No clear signal levels in the range (only noise or a flat line)'
  if (d.group === 'timing') return 'Not enough edges in the range — zoom out or measure the whole record'
  return 'Not available'
}

function fmt(v: number, unit: 'y' | 's' | 'Hz' | '%', yUnit: string): string {
  if (unit === '%') return Number.isFinite(v) ? `${v.toFixed(2)} %` : '—'
  return si(v, unit === 'y' ? yUnit : unit)
}
