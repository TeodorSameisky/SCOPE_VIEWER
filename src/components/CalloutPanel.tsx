import { useEffect, useRef, useState } from 'react'
import { CALLOUT_TYPES, CALLOUT_TYPE_LABEL, calloutName, calloutSpan, calloutTitle, hasTimeSpan, type Callout, type CalloutType } from '../model/callouts'
import { si } from '../util/format'
import { channelName } from '../util/names'
import { CalloutValueEditor } from './CalloutValueEditor'
import { ColorSwatches } from './ColorSwatches'
import { TOOLS } from './keymap'
import type { Action } from './ui/action'
import { chipStyle, useTheme } from './ui/themeContext'
import type { LiveChannel, Tool } from '../model/view'

interface Props {
  callouts: Callout[]
  channels: LiveChannel[]
  selectedId?: string
  /** The mouse tools (as in the toolbar) and the active one */
  tools: Record<Tool, Action>
  tool: Tool
  onSelect: (id: string) => void
  onUpdate: (id: string, patch: Partial<Callout>) => void
  onDelete: (id: string) => void
  onJump: (c: Callout) => void
  onClear: () => void
  onContextMenu?: (e: React.MouseEvent, c: Callout) => void
}

export function CalloutPanel(p: Props) {
  // Search in the text, the title and the type ("marker" lists all markers)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const { ink, onInk } = useTheme().theme
  const sorted = [...p.callouts]
    .filter((c) => !q || `${calloutTitle(c)} ${c.text} ${CALLOUT_TYPE_LABEL[c.type]}`.toLowerCase().includes(q))
    .sort((a, b) => calloutSpan(a)[0] - calloutSpan(b)[0])
  // A callout selected in the plot is scrolled into view in the list
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (p.selectedId) listRef.current?.querySelector(`[data-id="${CSS.escape(p.selectedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [p.selectedId])
  return (
    <div className="panel-body" ref={listRef}>
      <div className="callout-tools" role="group" aria-label="Callout tools">
        {CALLOUT_TYPES.map((t) => {
          const a = p.tools[t]
          const Icon = TOOLS[t].icon
          return (
            <button key={t} type="button" className={a.checked ? 'active' : ''} aria-pressed={!!a.checked} title={`${a.label} (${a.hint})`} onClick={a.run}>
              <Icon size={14} strokeWidth={1.8} aria-hidden /> {a.label}
            </button>
          )
        })}
      </div>
      <p className="hint">{TOOLS[p.tool].tip ?? 'Pick a callout type, then click (or drag) in the plot. Double-click a callout to edit it. Write TeX math between $…$.'}</p>

      {p.callouts.length > 1 && (
        <div className="callout-search">
          <input type="search" value={query} placeholder="Search callouts" aria-label="Search callouts" onChange={(e) => setQuery(e.target.value)} />
          {q && (
            <span className="muted">
              {sorted.length} of {p.callouts.length}
            </span>
          )}
        </div>
      )}
      {p.callouts.length === 0 && <div className="empty">No callouts yet.</div>}
      {p.callouts.length > 0 && sorted.length === 0 && <div className="empty">No callout matches “{query.trim()}”.</div>}
      {sorted.map((c) => {
        const ch = c.channel ? p.channels.find((x) => x.wave.id === c.channel) : undefined
        const ch2 = c.channel2 ? p.channels.find((x) => x.wave.id === c.channel2) : undefined
        return (
          <div
            key={c.id}
            data-id={c.id}
            className={`callout-card ${c.id === p.selectedId ? 'selected' : ''}`}
            style={{ ['--co' as string]: ink(c.color) }}
            onClick={() => p.onSelect(c.id)}
            onContextMenu={(e) => {
              if (!p.onContextMenu || (e.target as HTMLElement).closest('textarea')) return
              p.onSelect(c.id)
              p.onContextMenu(e, c)
            }}
          >
            <div className="callout-card-head">
              <TypeIcon type={c.type} />
              <span className="mono">{si(c.type === 'span' ? c.t : calloutSpan(c)[0], 's', 5)}</span>
              {hasTimeSpan(c) && c.t2 !== undefined && <span className="mono muted">Δt {si(c.type === 'span' ? c.t2 - c.t : Math.abs(c.t2 - c.t), 's')}</span>}
              {[ch, ch2].map(
                (x, i) =>
                  x && (
                    <span key={i} className="chip" style={chipStyle(ink(x.display.color), onInk)} title={c.type === 'span' ? (i ? 'End' : 'Start') : undefined}>
                      {channelName(x.wave.id)}
                    </span>
                  ),
              )}
              <span className="spacer" />
              <button type="button" className="text-btn" title="Show in plot" onClick={(e) => (e.stopPropagation(), p.onJump(c))}>
                Go to
              </button>
              <button type="button" className="text-btn danger" title="Delete" aria-label={`Delete ${calloutTitle(c)}`} onClick={(e) => (e.stopPropagation(), p.onDelete(c.id))}>
                ✕
              </button>
            </div>
            <textarea
              rows={Math.min(4, Math.max(1, c.text.split('\n').length))}
              value={c.text}
              placeholder={calloutName(c)}
              aria-label={`Text of ${calloutName(c)}`}
              onChange={(e) => p.onUpdate(c.id, { text: e.target.value })}
            />
            <CalloutValueEditor
              callout={c}
              sources={p.channels.map((x) => x.wave.id)}
              displays={p.channels.map((x) => x.display)}
              onUpdate={(patch) => p.onUpdate(c.id, patch)}
            />
            <div className="callout-editor-row">
              <ColorSwatches value={c.color} onChange={(color) => p.onUpdate(c.id, { color })} />
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

/** The icon of a callout type: the one of its tool in the toolbar */
function TypeIcon({ type }: { type: CalloutType }) {
  const Icon = TOOLS[type].icon
  return (
    <span className="callout-icon" title={CALLOUT_TYPE_LABEL[type]}>
      <Icon size={14} strokeWidth={1.8} aria-label={CALLOUT_TYPE_LABEL[type]} />
    </span>
  )
}
