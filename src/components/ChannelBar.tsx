import { useCallback, useRef, useState } from 'react'
import { AlertTriangle, AudioLines, Eye, EyeOff, Plus } from 'lucide-react'
import type { MathResult } from '../math/expr'
import { MAX_MATH, type MathDef } from '../model/math'
import type { ChannelDisplay, Session } from '../model/types'
import { si } from '../util/format'
import { channelName } from '../util/names'
import { ChannelSettings } from './ChannelSettings'
import { MathEditor } from './MathEditor'
import type { DisplayPatch, LiveChannel, TimeWindow } from './state'
import { useDismiss } from './ui/useDismiss'

export interface MathItem {
  def: MathDef
  display: ChannelDisplay
  result?: MathResult
}

interface Props {
  /** Input channels (not math) */
  channels: LiveChannel[]
  math: MathItem[]
  views: string[][]
  selected?: string
  setSelected: (id: string) => void
  onAdjust: (id: string, patch: DisplayPatch) => void
  onMoveToView: (id: string, view: number) => void
  onAutoscale: (id: string) => void
  onAddMath: () => string | undefined
  onChangeMath: (id: string, patch: Partial<MathDef>) => void
  onRemoveMath: (id: string) => void
  onOpenMathReference: () => void
  /** Channels that have a spectrum */
  spectrumSources: Set<string>
  canAddSpectrum: boolean
  onAddSpectrum: () => void
  onToggleSpectrum: (id: string) => void
  win: TimeWindow
  timePerDiv: number
  sampleRate: number
  recordLength: number
  trigger?: Session['trigger']
}

/**
 * Bottom settings bar, modelled on the badges of a Tektronix scope:
 * one compact badge per channel and math channel (click to select and open its
 * settings), followed by horizontal and trigger summaries.
 */
export function ChannelBar(p: Props) {
  // The popover is positioned fixed so it is never clipped
  const [open, setOpen] = useState<{ id: string; left: number; bottom: number } | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(null), [])
  useDismiss(popRef, open !== null, close)

  const openFor = (id: string, el: HTMLElement | undefined) => {
    if (!el) return
    const r = el.getBoundingClientRect()
    setOpen({ id, left: Math.max(8, Math.min(r.left, window.innerWidth - 356)), bottom: window.innerHeight - r.top + 6 })
  }

  const sources = [...p.channels.map((c) => c.wave.id), ...p.math.map((m) => m.def.id)]

  const badge = (id: string, d: ChannelDisplay, unit: string, sub: string, popover: React.ReactNode, error?: string) => {
    const isOpen = open?.id === id
    return (
      <div
        key={id}
        className={`ch-badge ${p.selected === id ? 'selected' : ''} ${d.visible ? '' : 'off'} ${error ? 'error' : ''}`}
        style={{ ['--ch' as string]: d.color }}
      >
        <div ref={isOpen ? popRef : undefined} className="ch-badge-inner">
          <button
            type="button"
            className="ch-main"
            title={`${channelName(id)}${d.label ? ` – ${d.label}` : ''}${error ? ` – ${error}` : ''}: click for settings`}
            aria-expanded={isOpen}
            onClick={(e) => {
              p.setSelected(id)
              if (isOpen) setOpen(null)
              else openFor(id, e.currentTarget.closest('.ch-badge') as HTMLElement)
            }}
          >
            <span className="ch-name">{channelName(id)}</span>
            <span className="ch-scale mono">{error ? <AlertTriangle size={12} aria-label="Error" /> : si(d.scale, `${unit || 'U'}/div`, 3)}</span>
            <span className="ch-label">{sub || ' '}</span>
          </button>
          <button
            type="button"
            className="ch-eye"
            title={d.visible ? 'Hide channel' : 'Show channel'}
            aria-label={d.visible ? `Hide ${channelName(id)}` : `Show ${channelName(id)}`}
            onClick={() => p.onAdjust(id, { visible: !d.visible })}
          >
            {d.visible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          {isOpen && open && (
            <div className="popover" style={{ position: 'fixed', left: open.left, bottom: open.bottom, maxHeight: `calc(100vh - ${open.bottom + 8}px)`, overflowY: 'auto' }}>
              {popover}
            </div>
          )}
        </div>
      </div>
    )
  }

  const settings = (d: ChannelDisplay, unit: string, children?: React.ReactNode) => (
    <ChannelSettings
      display={d}
      unit={unit}
      views={p.views}
      onAdjust={p.onAdjust}
      onMoveToView={p.onMoveToView}
      onAutoscale={p.onAutoscale}
      hasSpectrum={p.spectrumSources.has(d.id)}
      canAddSpectrum={p.canAddSpectrum}
      onToggleSpectrum={() => p.onToggleSpectrum(d.id)}
    >
      {children}
    </ChannelSettings>
  )

  return (
    <footer className="channel-bar">
      <div className="badges">
        {p.channels.map((c) => badge(c.wave.id, c.display, c.wave.yUnit, c.display.label, settings(c.display, c.wave.yUnit)))}
        {p.math.map((m) => {
          const unit = m.result?.wave?.yUnit ?? ''
          return badge(
            m.def.id,
            m.display,
            unit,
            m.display.label || m.def.expr,
            settings(
              m.display,
              unit,
              <MathEditor
                key={m.def.expr}
                def={m.def}
                result={m.result}
                sources={sources}
                onChange={(patch) => p.onChangeMath(m.def.id, patch)}
                onRemove={() => {
                  setOpen(null)
                  p.onRemoveMath(m.def.id)
                }}
                onOpenReference={() => {
                  setOpen(null)
                  p.onOpenMathReference()
                }}
              />,
            ),
            m.result?.error,
          )
        })}
        <button
          type="button"
          className="add-math"
          disabled={p.math.length >= MAX_MATH}
          title={p.math.length >= MAX_MATH ? `At most ${MAX_MATH} math channels` : 'Add a math channel (computed from other channels)'}
          onClick={(e) => {
            // The new badge takes the place of this button, so open its editor there
            const el = e.currentTarget
            const id = p.onAddMath()
            if (id) openFor(id, el)
          }}
        >
          <Plus size={14} aria-hidden /> Math
        </button>
        <button
          type="button"
          className="add-math"
          disabled={!p.canAddSpectrum}
          title={p.canAddSpectrum ? `Show the frequency spectrum (FFT) of ${p.selected ? channelName(p.selected) : 'a channel'}` : 'Too many spectra'}
          onClick={p.onAddSpectrum}
        >
          <AudioLines size={14} aria-hidden /> FFT
        </button>
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
