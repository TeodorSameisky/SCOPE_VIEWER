import { useEffect, useRef } from 'react'
import { CALLOUT_COLORS, CALLOUT_ICON, calloutTitle, type Callout } from '../model/callouts'
import { si } from '../util/format'
import { CalloutValueEditor } from './CalloutValueEditor'
import type { LiveChannel, Tool } from './state'

interface Props {
  callouts: Callout[]
  channels: LiveChannel[]
  selectedId?: string
  tool: Tool
  setTool: (t: Tool) => void
  onSelect: (id: string) => void
  onUpdate: (id: string, patch: Partial<Callout>) => void
  onDelete: (id: string) => void
  onJump: (c: Callout) => void
  onClear: () => void
  onContextMenu?: (e: React.MouseEvent, c: Callout) => void
}

export function CalloutPanel(p: Props) {
  const sorted = [...p.callouts].sort((a, b) => a.t - b.t)
  // A callout selected in the plot is scrolled into view in the list
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (p.selectedId) listRef.current?.querySelector(`[data-id="${CSS.escape(p.selectedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [p.selectedId])
  return (
    <div className="panel-body" ref={listRef}>
      <div className="callout-tools">
        {(['note', 'marker', 'region'] as const).map((t) => (
          <button key={t} className={p.tool === t ? 'active' : ''} onClick={() => p.setTool(p.tool === t ? 'pan' : t)}>
            {CALLOUT_ICON[t]} {t === 'note' ? 'Note' : t === 'marker' ? 'Marker' : 'Region'}
          </button>
        ))}
      </div>
      <p className="hint">
        {p.tool === 'note'
          ? 'Click on a trace to attach a note.'
          : p.tool === 'marker'
            ? 'Click in the plot to place a marker.'
            : p.tool === 'region'
              ? 'Drag in the plot to mark a time region.'
              : 'Pick a callout type, then click (or drag, for a region) in the plot. Double-click a callout to edit it. Write TeX math between $…$.'}
      </p>

      {sorted.length === 0 && <div className="empty">No callouts yet.</div>}
      {sorted.map((c) => {
        const ch = c.channel ? p.channels.find((x) => x.wave.id === c.channel) : undefined
        return (
          <div
            key={c.id}
            data-id={c.id}
            className={`callout-card ${c.id === p.selectedId ? 'selected' : ''}`}
            style={{ ['--co' as string]: c.color }}
            onClick={() => p.onSelect(c.id)}
            onContextMenu={(e) => {
              if (!p.onContextMenu || (e.target as HTMLElement).closest('textarea')) return
              p.onSelect(c.id)
              p.onContextMenu(e, c)
            }}
          >
            <div className="callout-card-head">
              <span className="callout-icon">{CALLOUT_ICON[c.type]}</span>
              <span className="mono">{si(c.t, 's', 5)}</span>
              {c.type === 'region' && c.t2 !== undefined && <span className="mono muted">Δt {si(Math.abs(c.t2 - c.t), 's')}</span>}
              {ch && (
                <span className="chip" style={{ ['--ch' as string]: ch.display.color }}>
                  {ch.wave.id}
                </span>
              )}
              <span className="spacer" />
              <button className="text-btn" title="Show in plot" onClick={(e) => (e.stopPropagation(), p.onJump(c))}>
                Go to
              </button>
              <button className="text-btn danger" title="Delete" onClick={(e) => (e.stopPropagation(), p.onDelete(c.id))}>
                ✕
              </button>
            </div>
            <textarea
              rows={Math.min(4, Math.max(1, c.text.split('\n').length))}
              value={c.text}
              placeholder={calloutTitle({ ...c, text: '' })}
              onChange={(e) => p.onUpdate(c.id, { text: e.target.value })}
            />
            <CalloutValueEditor callout={c} sources={p.channels.map((x) => x.wave.id)} onUpdate={(patch) => p.onUpdate(c.id, patch)} />
            <div className="callout-editor-row">
              {CALLOUT_COLORS.map((col) => (
                <button
                  key={col}
                  className={`swatch ${c.color === col ? 'active' : ''}`}
                  style={{ background: col }}
                  title="Colour"
                  onClick={() => p.onUpdate(c.id, { color: col })}
                />
              ))}
            </div>
          </div>
        )
      })}

      <div className="row wrap">
        <span className="spacer" />
        <button className="text-btn danger" disabled={!p.callouts.length} onClick={p.onClear}>
          Delete all
        </button>
      </div>
      <p className="hint">Callouts are saved with the session and included in image and report exports. To share them, use File → Save analysis file.</p>
    </div>
  )
}
