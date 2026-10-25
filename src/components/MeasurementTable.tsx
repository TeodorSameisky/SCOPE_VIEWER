import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, ClipboardList, Copy, Info, Plus, TableProperties, X } from 'lucide-react'
import { measure, type MeasurementKey, type Measurements } from '../dsp/measure'
import { MEASURE_GROUP_LABEL, MEASUREMENT_DEFS, formatMeasurement, measurementDef, type MeasurementDef } from '../dsp/measureDefs'
import { SampleCache } from '../util/sampleCache'
import { channelName } from '../util/names'
import { measurementTable } from '../export/measureRows'
import { MeasureInfo } from './MeasureInfo'
import { MEASURE_RANGES, RANGE_LABEL, sampleRange, type CursorState, type LiveChannel, type MeasureRange, type TimeWindow } from '../model/view'
import { rangeChoices } from './scopeCommands'
import { useContextMenu, type MenuEntry } from './ui/menuContext'
import { placeNear } from './ui/placement'
import { ResizeHandle } from './ui/ResizeHandle'
import { useDismiss } from './ui/useDismiss'
import { useTheme } from './ui/themeContext'

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
  /** Channel commands for the context menu of a row */
  channelMenu?: (id: string) => MenuEntry[]
  /** Copy text to the clipboard; `what` describes it for the confirmation */
  onCopy: (text: string, what: string) => void
}

/** Width of the popovers (explanation, add a measurement) */
const POPUP_W = 340
type Popup = ({ kind: 'info'; key: MeasurementKey } | { kind: 'add' }) & { style: React.CSSProperties }

export function MeasurementTable(p: Props) {
  // Deferred so panning/zooming stays smooth on long records
  const win = useDeferredValue(p.win)
  const cursors = useDeferredValue(p.cursors)
  const visible = p.channels.filter((c) => c.display.visible)
  const { ink } = useTheme().theme

  // Results are cached per sample array and range, so changing a colour, label or unit
  // (which creates new channel objects) does not recompute anything.
  const [cache] = useState(() => new SampleCache<Measurements>(4))
  const results = useMemo(() => {
    const out = new Map<string, Measurements>()
    for (const c of p.channels) {
      if (!c.display.visible) continue
      const w = c.wave
      const [i0, i1] = sampleRange(w, p.range, win, cursors)
      const key = `${w.t0}:${w.dt}:${Math.max(0, Math.floor(i0))}:${Math.min(w.data.length, Math.ceil(i1))}`
      out.set(w.id, cache.get(w.data, key, () => measure(w.data, i0, i1, w.t0, w.dt)))
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
    openAtRect((e.currentTarget as HTMLElement).getBoundingClientRect(), popup)
  }
  const openAtRect = (r: DOMRect, popup: { kind: 'info'; key: MeasurementKey } | { kind: 'add' }) => {
    setPopup({ ...popup, style: placeNear(r, POPUP_W, 'below') })
  }

  // ---------- drag a column header to move the column ----------
  const [colDrag, setColDrag] = useState<{ key: MeasurementKey; to: number } | null>(null)
  const colPress = useRef<{ key: MeasurementKey; x0: number; pointerId: number; el: HTMLElement } | null>(null)
  const headRef = useRef<HTMLTableRowElement>(null)
  /** Insertion index (0 … number of columns) for the pointer at x */
  const dropIndex = (x: number) =>
    [...(headRef.current?.querySelectorAll<HTMLElement>('th[data-key]') ?? [])].filter((th) => {
      const r = th.getBoundingClientRect()
      return x > r.left + r.width / 2
    }).length
  const onColDown = (e: React.PointerEvent<HTMLElement>, key: MeasurementKey) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.x')) return
    colPress.current = { key, x0: e.clientX, pointerId: e.pointerId, el: e.currentTarget }
  }
  const onColMove = (e: React.PointerEvent) => {
    const press = colPress.current
    if (!press) return
    if (e.buttons === 0) {
      colPress.current = null
      return
    }
    // A click still opens the explanation: the drag starts after a few pixels
    if (!colDrag) {
      if (Math.abs(e.clientX - press.x0) < 5) return
      try {
        press.el.setPointerCapture(press.pointerId)
      } catch {
        // synthetic events have no active pointer
      }
    }
    setColDrag({ key: press.key, to: dropIndex(e.clientX) })
  }
  const onColUp = () => {
    const d = colDrag
    colPress.current = null
    setColDrag(null)
    if (!d) return
    const from = p.keys.indexOf(d.key)
    const k = p.keys.filter((x) => x !== d.key)
    k.splice(d.to > from ? d.to - 1 : d.to, 0, d.key)
    if (k.join() !== p.keys.join()) p.setKeys(k)
  }
  /** The dragged header is dimmed; a line before or after a header shows where it would land */
  const dropClass = (i: number) => {
    if (!colDrag) return undefined
    const from = p.keys.indexOf(colDrag.key)
    const moves = colDrag.to !== from && colDrag.to !== from + 1
    return [
      p.keys[i] === colDrag.key && 'dragging',
      moves && colDrag.to === i && 'drop-before',
      moves && colDrag.to === p.keys.length && i === p.keys.length - 1 && 'drop-after',
    ]
      .filter(Boolean)
      .join(' ')
  }

  // ---------- context menus ----------
  const menu = useContextMenu()
  const rows = visible.flatMap((c) => {
    const m = results.get(c.wave.id)
    return m ? [{ channel: c, m }] : []
  })
  /** Tab separated, as shown (pastes into a spreadsheet or a document table) */
  const tsv = (lines: string[][]) => lines.map((l) => l.join('\t')).join('\n')
  const copyTable = () => {
    const t = measurementTable(rows, p.keys)
    p.onCopy(tsv([t.columns, ...t.rows.map((r) => r.cells)]), 'Measurement table')
  }
  const copyRow = (c: LiveChannel) => {
    const t = measurementTable(rows.filter((r) => r.channel === c), p.keys)
    p.onCopy(tsv([t.columns, ...t.rows.map((r) => r.cells)]), `Measurements of ${channelName(c.wave.id)}`)
  }
  const moveKey = (key: MeasurementKey, dir: -1 | 1) => {
    const k = [...p.keys]
    const i = k.indexOf(key)
    if (i + dir < 0 || i + dir >= k.length) return
    ;[k[i], k[i + dir]] = [k[i + dir], k[i]]
    p.setKeys(k)
  }
  const pointRect = (e: React.MouseEvent) => new DOMRect(e.clientX, e.clientY, 0, 0)
  const common = (e: React.MouseEvent): MenuEntry[] => {
    const at = pointRect(e)
    return [
      '-',
      { label: 'Copy table', icon: ClipboardList, disabled: !rows.length || !p.keys.length, onClick: copyTable },
      { label: 'Add measurement…', icon: Plus, disabled: !unused.length, onClick: () => openAtRect(at, { kind: 'add' }) },
      rangeChoices(p.range, p.setRange),
      { label: 'Hide measurements', icon: X, hint: 'T', onClick: p.onClose },
    ]
  }
  const columnItems = (d: MeasurementDef, rect: DOMRect): MenuEntry[] => {
    const i = p.keys.indexOf(d.key)
    return [
      { label: `About ${d.label}…`, icon: Info, onClick: () => openAtRect(rect, { kind: 'info', key: d.key }) },
      { label: 'Move column left', icon: ArrowLeft, disabled: i <= 0, onClick: () => moveKey(d.key, -1) },
      { label: 'Move column right', icon: ArrowRight, disabled: i >= p.keys.length - 1, onClick: () => moveKey(d.key, 1) },
      { label: 'Remove column', icon: X, onClick: () => p.setKeys(p.keys.filter((k) => k !== d.key)) },
    ]
  }
  const headerMenu = (e: React.MouseEvent, d: MeasurementDef) => {
    const th = (e.currentTarget as HTMLElement).getBoundingClientRect()
    menu(e, [{ kind: 'heading', label: d.label }, ...columnItems(d, th), ...common(e)])
  }
  const channelLabel = (c: LiveChannel) => `${channelName(c.wave.id)}${c.display.label ? ` ${c.display.label}` : ''}`
  const rowMenu = (e: React.MouseEvent, c: LiveChannel) => {
    menu(e, [
      { kind: 'heading', label: channelLabel(c), color: c.display.color },
      { label: 'Copy row', icon: Copy, disabled: !p.keys.length, onClick: () => copyRow(c) },
      '-',
      ...(p.channelMenu?.(c.wave.id) ?? []),
      ...common(e),
    ])
  }
  const cellMenu = (e: React.MouseEvent, c: LiveChannel, d: MeasurementDef, text: string) => {
    const th = (e.currentTarget as HTMLElement).closest('table')?.querySelector(`th[data-key="${d.key}"]`)?.getBoundingClientRect() ?? pointRect(e)
    menu(e, [
      { kind: 'heading', label: `${d.label} · ${channelName(c.wave.id)}`, color: c.display.color, detail: text },
      { label: 'Copy value', icon: Copy, onClick: () => p.onCopy(text, `${d.label} of ${channelName(c.wave.id)}`) },
      { label: 'Copy row', icon: TableProperties, onClick: () => copyRow(c) },
      '-',
      ...columnItems(d, th),
      ...common(e),
    ])
  }


  return (
    <div className="measure" style={{ height: p.height }} onContextMenu={(e) => menu(e, common(e))}>
      <ResizeHandle height={p.height} setHeight={p.setHeight} />
      <div className="measure-bar">
        <span className="section-title">Measurements</span>
        <div className="segmented">
          {MEASURE_RANGES.map((r) => (
            <button key={r} type="button" className={p.range === r ? 'active' : ''} aria-pressed={p.range === r} onClick={() => p.setRange(r)}>
              {RANGE_LABEL[r]}
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
          <thead className={colDrag ? 'col-dragging' : undefined}>
            <tr ref={headRef}>
              <th>Channel</th>
              {defs.map((d, i) => (
                <th
                  key={d.key}
                  data-key={d.key}
                  className={dropClass(i)}
                  onContextMenu={(e) => headerMenu(e, d)}
                  onPointerDown={(e) => onColDown(e, d.key)}
                  onPointerMove={onColMove}
                  onPointerUp={onColUp}
                  onPointerCancel={() => {
                    colPress.current = null
                    setColDrag(null)
                  }}
                >
                  <button
                    type="button"
                    className="th-btn"
                    title={`${d.short} Click for details, drag to move the column.`}
                    onClick={(e) => openAt(e, { kind: 'info', key: d.key })}
                  >
                    {d.label}
                    <Info size={12} aria-hidden />
                  </button>
                  <button type="button" className="x" title="Remove" aria-label={`Remove ${d.label}`} onClick={() => p.setKeys(p.keys.filter((k) => k !== d.key))}>
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
                  <td onContextMenu={(e) => rowMenu(e, c)}>
                    <span className="dot" style={{ background: ink(c.display.color) }} />
                    {channelName(c.wave.id)}
                    {c.display.label && <span className="muted"> {c.display.label}</span>}
                  </td>
                  {defs.map((d) => {
                    const v = m?.[d.key]
                    const text = m && v !== undefined ? formatMeasurement(d.key, v, c.wave.yUnit) : ''
                    return (
                      <td
                        key={d.key}
                        className="mono"
                        title={m && v !== undefined && !Number.isFinite(v) ? whyMissing(d, m) : undefined}
                        onContextMenu={(e) => cellMenu(e, c, d, text)}
                      >
                        {text}
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
        <div ref={popRef} className="popover" style={{ width: POPUP_W, ...popup.style }}>
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
