import { useCallback, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { Session } from '../model/types'
import { si } from '../util/format'
import { ChannelSettings } from './ChannelSettings'
import type { DisplayPatch, LiveChannel, TimeWindow } from './state'
import { useDismiss } from './ui/useDismiss'

interface Props {
  channels: LiveChannel[]
  views: string[][]
  selected?: string
  setSelected: (id: string) => void
  onAdjust: (id: string, patch: DisplayPatch) => void
  onMoveToView: (id: string, view: number) => void
  onAutoscale: (id: string) => void
  win: TimeWindow
  timePerDiv: number
  sampleRate: number
  recordLength: number
  trigger?: Session['trigger']
}

/**
 * Bottom settings bar, modelled on the badges of a Tektronix scope:
 * one compact badge per channel (click to select and open its settings),
 * followed by horizontal and trigger summaries.
 */
export function ChannelBar(p: Props) {
  // The popover is positioned fixed so the scrollable badge row does not clip it
  const [open, setOpen] = useState<{ id: string; left: number; bottom: number } | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(null), [])
  useDismiss(popRef, open !== null, close)

  return (
    <footer className="channel-bar">
      <div className="badges">
        {p.channels.map((c) => {
          const d = c.display
          const id = c.wave.id
          const isOpen = open?.id === id
          return (
            <div
              key={id}
              ref={isOpen ? popRef : undefined}
              className={`ch-badge ${p.selected === id ? 'selected' : ''} ${d.visible ? '' : 'off'}`}
              style={{ ['--ch' as string]: d.color }}
            >
              <button
                type="button"
                className="ch-main"
                title={`${id}${d.label ? ` – ${d.label}` : ''}: click for settings`}
                aria-expanded={isOpen}
                onClick={(e) => {
                  p.setSelected(id)
                  const r = (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect()
                  setOpen(isOpen ? null : { id, left: Math.max(8, Math.min(r.left, window.innerWidth - 336)), bottom: window.innerHeight - r.top + 6 })
                }}
              >
                <span className="ch-name">{id.replace(/^CH/, 'Ch ')}</span>
                <span className="ch-scale mono">{si(d.scale, `${c.wave.yUnit}/div`, 3)}</span>
                <span className="ch-label">{d.label || ' '}</span>
              </button>
              <button
                type="button"
                className="ch-eye"
                title={d.visible ? 'Hide channel' : 'Show channel'}
                aria-label={d.visible ? `Hide ${id}` : `Show ${id}`}
                onClick={() => p.onAdjust(id, { visible: !d.visible })}
              >
                {d.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              {isOpen && (
                <div className="popover" style={{ position: 'fixed', left: open.left, bottom: open.bottom }}>
                  <ChannelSettings channel={c} views={p.views} onAdjust={p.onAdjust} onMoveToView={p.onMoveToView} onAutoscale={p.onAutoscale} />
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="spacer" />
      <div className="info-box" title={`Window ${si(p.win.start, 's')} … ${si(p.win.end, 's')}`}>
        <span className="info-title">Horizontal</span>
        <span className="info-main mono">{si(p.timePerDiv, 's/div', 3)}</span>
        <span className="info-sub mono">
          {si(p.sampleRate, 'S/s', 3)} · {si(p.recordLength, 'pts', 3)}
        </span>
      </div>
      {p.trigger && (
        <div className="info-box trigger">
          <span className="info-title">Trigger</span>
          <span className="info-main mono">
            {p.trigger.source} {p.trigger.slope === 'FALL' ? '↘' : '↗'}
          </span>
          <span className="info-sub mono">{p.trigger.level !== undefined ? si(p.trigger.level, 'V', 3) : ''}</span>
        </div>
      )}
    </footer>
  )
}
