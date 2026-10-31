import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, ClipboardList, Copy, Info, ListChecks, Plus, TableProperties, X } from 'lucide-react'
import type { ComputeEngine } from '../compute/engine'
import type { MeasurementKey, Measurements } from '../dsp/measure'
import { MEASURE_GROUP_LABEL, MEASUREMENT_DEFS, formatMeasurement, measurementDef, missingReason, type MeasurementDef } from '../dsp/measureDefs'
import { channelName } from '../util/names'
import { measuredChannels, measurementTable } from '../export/measureRows'
import { MeasureInfo } from './MeasureInfo'
import { MEASURE_RANGES, RANGE_LABEL, sampleRange, type CursorState, type LiveChannel, type MeasureRange, type TimeWindow } from '../model/view'
import { rangeChoices } from './scopeCommands'
import { useContextMenu, type MenuEntry } from './ui/menuContext'
import { placeNear } from './ui/placement'
import { ResizeHandle } from './ui/ResizeHandle'
import { useDismiss } from './ui/useDismiss'
import { useTheme } from './ui/themeContext'

interface Props {
  /** Measures the channels (long ranges in its worker) */
  engine: Pick<ComputeEngine, 'measured' | 'subscribeMeasured' | 'measuredVersion'>
  channels: LiveChannel[]
  win: TimeWindow
  cursors: CursorState
  range: MeasureRange
  setRange: (r: MeasureRange) => void
  keys: MeasurementKey[]
  setKeys: (k: MeasurementKey[]) => void
  /** Channels left out of the table (it has a row for every other visible channel) */
  exclude: string[]
  setExclude: (ids: string[]) => void
  /** The table is as high as its rows need, but at most this high; null: at most a share of the window */
  height: number | null
  setHeight: (h: number | null) => void
  /** The selected channel: its row is marked, and a click on a row selects its channel */
  selected?: string
  onSelect: (id: string) => void
  /** Show a hidden channel (its row is left out of the table) */
  onShowChannel: (id: string) => void
  onClose: () => void
  /** Open the measurement reference, optionally at one measurement */
  onOpenReference: (key?: MeasurementKey) => void
  /** Channel commands for the context menu of a row */
  channelMenu?: (id: string) => MenuEntry[]
  /** Copy text to the clipboard; `what` describes it for the confirmation */
  onCopy: (text: string, what: string) => void
}

/** Width of the popovers (explanation, add a measurement, choose the channels) */
const POPUP_W = 340
type PopupKind = { kind: 'info'; key: MeasurementKey } | { kind: 'add' } | { kind: 'channels' }
type Popup = PopupKind & { style: React.CSSProperties }

export function MeasurementTable(p: Props) {
  // Deferred so panning/zooming stays smooth on long records
  const win = useDeferredValue(p.win)
  const cursors = useDeferredValue(p.cursors)
  const excluded = useMemo(() => new Set(p.exclude), [p.exclude])
  const measured = measuredChannels(p.channels, p.exclude)
  const leftOut = p.channels.filter((c) => excluded.has(c.wave.id))
  const { ink } = useTheme().theme
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Long ranges are measured in the worker, so the page stays responsive; the engine remembers
  // results per sample array and range, so changing a colour, label or unit (which creates new
  // channel objects) does not measure again. While a channel is measured, its previous values
  // stay, dimmed (`pending`), so the table does not flicker while panning.
  const measuredVersion = useSyncExternalStore(p.engine.subscribeMeasured, p.engine.measuredVersion)
  const previous = useRef(new Map<string, Measurements>())
  const results = useMemo(() => {
    const out = new Map<string, { m: Measurements; pending: boolean }>()
    for (const c of p.channels) {
      if (!c.display.visible || excluded.has(c.wave.id)) continue
      const w = c.wave
      const [i0, i1] = sampleRange(w, p.range, win, cursors)
      const m = p.engine.measured(w, Math.max(0, Math.floor(i0)), Math.min(w.data.length, Math.ceil(i1)), `table:${w.id}`)
      if (m) previous.current.set(w.id, m)
      const shown = m ?? previous.current.get(w.id)
      if (shown) out.set(w.id, { m: shown, pending: !m })
    }
    return out
    // measuredVersion: measurements that were being computed may have arrived
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.channels, excluded, p.range, win, cursors, p.engine, measuredVersion])

  const defs = p.keys.map(measurementDef)
  const unused = MEASUREMENT_DEFS.filter((d) => !p.keys.includes(d.key))

  // A column that was added (here, by the command palette or by an undo) is scrolled into sight: in a
  // narrow window it lands beyond the right edge of the table
  const shownKeys = useRef(p.keys)
  useEffect(() => {
    const added = p.keys.find((k) => !shownKeys.current.includes(k))
    shownKeys.current = p.keys
    if (added) scrollRef.current?.querySelector(`th[data-key="${added}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [p.keys])

  // Popovers (measurement info, add picker), positioned fixed so the scroll area does not clip them
  const [popup, setPopup] = useState<Popup | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const closePopup = useCallback(() => setPopup(null), [])
  useDismiss(popRef, popup !== null, closePopup)
  const openAt = (e: React.MouseEvent, popup: PopupKind) => {
    openAtRect((e.currentTarget as HTMLElement).getBoundingClientRect(), popup)
  }
  const openAtRect = (r: DOMRect, popup: PopupKind) => {
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
  const rows = measured.flatMap((c) => {
    const r = results.get(c.wave.id)
    return r ? [{ channel: c, m: r.m }] : []
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
      { label: 'Channels to measure…', icon: ListChecks, onClick: () => openAtRect(at, { kind: 'channels' }) },
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
  const setMeasured = (id: string, on: boolean) => p.setExclude(on ? p.exclude.filter((x) => x !== id) : [...p.exclude, id])
  /** Bring a channel into the table: measure it, and show it if it is hidden */
  const bringIn = (c: LiveChannel) => {
    if (excluded.has(c.wave.id)) setMeasured(c.wave.id, true)
    if (!c.display.visible) p.onShowChannel(c.wave.id)
  }
  /** The height the table would have without a limit: the bar and all its rows */
  const contentHeight = () => {
    const root = rootRef.current
    const scroll = scrollRef.current
    return root && scroll ? root.offsetHeight - scroll.clientHeight + scroll.scrollHeight : 0
  }
  const rowMenu = (e: React.MouseEvent, c: LiveChannel) => {
    p.onSelect(c.wave.id)
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
    p.onSelect(c.wave.id)
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
    <div
      ref={rootRef}
      className="measure"
      style={p.height === null ? undefined : { maxHeight: p.height }}
      onContextMenu={(e) => menu(e, common(e))}
    >
      <ResizeHandle
        height={p.height}
        setHeight={(h) => p.setHeight(h >= contentHeight() - 2 ? null : h)}
        getHeight={() => rootRef.current?.offsetHeight ?? 0}
        maxHeight={contentHeight}
        onReset={() => p.setHeight(null)}
      />
      <div className="measure-bar">
        <span className="section-title">Measurements</span>
        <div className="segmented">
          {MEASURE_RANGES.map((r) => (
            <button key={r} type="button" className={p.range === r ? 'active' : ''} aria-pressed={p.range === r} onClick={() => p.setRange(r)}>
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn with-label" title="Choose the channels to measure" onClick={(e) => openAt(e, { kind: 'channels' })}>
          <ListChecks size={16} aria-hidden />
          <span>{leftOut.length ? `Channels ${p.channels.length - leftOut.length}/${p.channels.length}` : 'Channels'}</span>
        </button>
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
      <div ref={scrollRef} className="measure-scroll">
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
                    <Info size={12} aria-hidden />
                    {d.label}
                  </button>
                  <button type="button" className="x" title="Remove" aria-label={`Remove ${d.label}`} onClick={() => p.setKeys(p.keys.filter((k) => k !== d.key))}>
                    ×
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {measured.map((c) => {
              const r = results.get(c.wave.id)
              const m = r?.m
              const isSelected = c.wave.id === p.selected
              return (
                <tr
                  key={c.wave.id}
                  className={[r?.pending && 'pending', isSelected && 'selected'].filter(Boolean).join(' ') || undefined}
                  aria-busy={!r || r.pending || undefined}
                  onClick={() => p.onSelect(c.wave.id)}
                >
                  <td onContextMenu={(e) => rowMenu(e, c)}>
                    <button type="button" className="row-btn" aria-current={isSelected || undefined} title={`Select ${channelName(c.wave.id)}`}>
                      <span className="dot" style={{ background: ink(c.display.color) }} />
                      {channelName(c.wave.id)}
                      {c.display.label && <span className="muted"> {c.display.label}</span>}
                    </button>
                    <button
                      type="button"
                      className="x row-x"
                      title={`Stop measuring ${channelName(c.wave.id)}`}
                      aria-label={`Stop measuring ${channelName(c.wave.id)}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setMeasured(c.wave.id, false)
                      }}
                    >
                      ×
                    </button>
                  </td>
                  {defs.map((d) => {
                    const v = m?.[d.key]
                    const text = m && v !== undefined ? formatMeasurement(d.key, v, c.wave.yUnit) : ''
                    const missing = m !== undefined && v !== undefined && !Number.isFinite(v)
                    return (
                      <td
                        key={d.key}
                        className={missing ? 'mono na' : 'mono'}
                        title={missing ? missingReason(d, m, p.range) : undefined}
                        onContextMenu={(e) => cellMenu(e, c, d, text)}
                      >
                        {text}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {measured.length === 0 && (
              <tr className="empty-note">
                <td colSpan={defs.length + 1}>
                  {/* Nothing to show: a click on a channel brings it in (measures it, shows it) */}
                  <div className="empty-list">
                    <span className="muted">No channel is measured. Click one to measure it:</span>
                    {p.channels.map((c) => (
                      <button key={c.wave.id} type="button" className="chip-link" title={`Measure ${channelName(c.wave.id)}`} onClick={() => bringIn(c)}>
                        <span className="dot" style={{ background: ink(c.display.color) }} />
                        {channelName(c.wave.id)}
                        {c.display.label && <span className="muted"> {c.display.label}</span>}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            )}
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
          ) : popup.kind === 'channels' ? (
            <div className="pick-list">
              <div className="pick-head">
                <span className="add-group">Channels to measure</span>
                <span className="spacer" />
                <button type="button" className="text-btn" onClick={() => p.setExclude([])}>
                  All
                </button>
                {p.selected && (
                  <button type="button" className="text-btn" onClick={() => p.setExclude(p.channels.filter((c) => c.wave.id !== p.selected).map((c) => c.wave.id))}>
                    Only {channelName(p.selected)}
                  </button>
                )}
                <button type="button" className="text-btn" onClick={() => p.setExclude(p.channels.map((c) => c.wave.id))}>
                  None
                </button>
              </div>
              {p.channels.map((c) => (
                <label key={c.wave.id} className="pick-item">
                  <input type="checkbox" checked={!excluded.has(c.wave.id)} onChange={(e) => setMeasured(c.wave.id, e.target.checked)} />
                  <span className="dot" style={{ background: ink(c.display.color) }} />
                  <span>
                    {channelName(c.wave.id)}
                    {c.display.label && <span className="muted"> {c.display.label}</span>}
                  </span>
                  {!c.display.visible && <span className="tag">hidden</span>}
                </label>
              ))}
            </div>
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
