import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AlertTriangle, AudioLines, ChevronLeft, ChevronRight, Eye, EyeOff, Plus } from 'lucide-react'
import type { MathResult } from '../math/expr'
import { MAX_MATH, type MathDef } from '../model/math'
import { badgeItems, inputSummary } from '../model/input'
import type { ChannelDisplay, ChannelInput, Session } from '../model/types'
import { si } from '../util/format'
import { channelName, perDiv, slopeSymbol, sourceUnit } from '../util/names'
import { ChannelSettings } from './ChannelSettings'
import { MathEditor } from './MathEditor'
import type { DisplayPatch, LiveChannel, TimeWindow } from '../model/view'
import { placeNear } from './ui/placement'
import { useDismiss } from './ui/useDismiss'
import { useTheme } from './ui/themeContext'

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
  /** Right-click on a badge */
  onChannelMenu?: (e: React.MouseEvent, id: string) => void
  /** Right-click on the horizontal / trigger summary */
  onTimebaseMenu?: (e: React.MouseEvent) => void
}

export interface ChannelBarHandle {
  /** Open the settings popover of a channel (as a click on its badge does) */
  openSettings: (id: string) => void
}

/** Badges closer than this to the edge of the scrolling row are under the fade */
const EDGE_PX = 30
/** Width of the settings popover */
const POPOVER_W = 340

/**
 * Bottom settings bar, modelled on the badges of a Tektronix scope:
 * one compact badge per channel and math channel (click to select and open its
 * settings), followed by horizontal and trigger summaries. The badges stay in one row;
 * when they do not fit, the row scrolls sideways (wheel, the arrows at its edges).
 */
export const ChannelBar = forwardRef<ChannelBarHandle, Props>(function ChannelBar(p, ref) {
  // The popover is positioned fixed so it is never clipped
  const [open, setOpen] = useState<{ id: string; style: React.CSSProperties } | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(null), [])
  useDismiss(popRef, open !== null, close)

  const openFor = (id: string, el: HTMLElement | null | undefined) => {
    if (!el) return
    setOpen({ id, style: placeNear(el.getBoundingClientRect(), POPOVER_W, 'above') })
  }

  // ---------- one scrolling row ----------
  const [edges, setEdges] = useState({ left: false, right: false })
  const updateEdges = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }))
  }, [])
  useLayoutEffect(() => {
    // The row or its content changed size (window, badges added, longer labels)
    const ro = new ResizeObserver(updateEdges)
    if (scrollRef.current) ro.observe(scrollRef.current)
    if (trackRef.current) ro.observe(trackRef.current)
    return () => ro.disconnect()
  }, [updateEdges])
  // A vertical wheel scrolls the row sideways when it does not fit
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if ((e.target as Element).closest('.popover') || el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  const badgeEl = (id: string) => scrollRef.current?.querySelector<HTMLElement>(`.ch-badge[data-id="${CSS.escape(id)}"]`) ?? null
  /** Scroll a badge fully into view (clear of the edge fades) and return it */
  const reveal = (id: string) => {
    const row = scrollRef.current
    const b = badgeEl(id)
    if (!row || !b || row.scrollWidth <= row.clientWidth) return b
    const s = row.getBoundingClientRect()
    const r = b.getBoundingClientRect()
    if (r.left < s.left + EDGE_PX) row.scrollLeft -= s.left + EDGE_PX - r.left
    else if (r.right > s.right - EDGE_PX) row.scrollLeft += r.right - (s.right - EDGE_PX)
    return b
  }
  // The selected channel (e.g. by clicking its trace) is always visible in the row
  useEffect(() => {
    if (p.selected) reveal(p.selected)
    // reveal only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.selected])
  const onScroll = () => {
    updateEdges()
    // The open settings stay attached to their badge
    if (open) openFor(open.id, badgeEl(open.id))
  }
  const scrollBy = (dir: -1 | 1) => scrollRef.current?.scrollBy({ left: dir * scrollRef.current.clientWidth * 0.7, behavior: 'smooth' })

  useImperativeHandle(ref, () => ({
    openSettings: (id) => {
      p.setSelected(id)
      openFor(id, reveal(id))
    },
  }))

  const sources = [...p.channels.map((c) => c.wave.id), ...p.math.map((m) => m.def.id)]
  // Trace colours as shown on the current background (pale ones are darkened on light)
  const { ink } = useTheme().theme
  const triggerColor = p.channels.find((c) => c.wave.id === p.trigger?.source)?.display.color

  const badge = (id: string, d: ChannelDisplay, unit: string, sub: string, popover: React.ReactNode, error?: string, input?: ChannelInput) => {
    const isOpen = open?.id === id
    // Termination and bandwidth as on the scope's badge; settings that differ from DC into a high impedance are marked
    const items = badgeItems(input)
    return (
      <div
        key={id}
        data-id={id}
        className={`ch-badge ${p.selected === id ? 'selected' : ''} ${d.visible ? '' : 'off'} ${error ? 'error' : ''}`}
        style={{ ['--ch' as string]: ink(d.color) }}
        onContextMenu={(e) => {
          if (!p.onChannelMenu || (e.target as HTMLElement).closest('.popover')) return
          p.setSelected(id)
          p.onChannelMenu(e, id)
        }}
      >
        <div ref={isOpen ? popRef : undefined} className="ch-badge-inner">
          <button
            type="button"
            className="ch-main"
            title={`${channelName(id)}${d.label ? ` – ${d.label}` : ''}${error ? ` – ${error}` : ''}${input ? `\n${inputSummary(input)}` : ''}\nClick for settings`}
            aria-expanded={isOpen}
            onClick={(e) => {
              p.setSelected(id)
              if (isOpen) setOpen(null)
              else openFor(id, e.currentTarget.closest('.ch-badge') as HTMLElement)
            }}
          >
            <span className="ch-name">{channelName(id)}</span>
            <span className="ch-scale mono">{error ? <AlertTriangle size={12} aria-label="Error" /> : perDiv(d.scale, unit)}</span>
            {items.length > 0 && (
              <span className="ch-input mono">
                {items.map(({ text, flag }) => (
                  <span key={text} className={flag ? 'ch-flag' : undefined}>
                    {text}
                  </span>
                ))}
              </span>
            )}
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
            <div className="popover" style={open.style}>
              {popover}
            </div>
          )}
        </div>
      </div>
    )
  }

  const settings = (d: ChannelDisplay, unit: string, hasWave: boolean, children?: React.ReactNode, input?: ChannelInput) => (
    <ChannelSettings
      display={d}
      unit={unit}
      input={input}
      hasWave={hasWave}
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
      <div className="badges-wrap">
        {edges.left && (
          <button type="button" className="badges-scroll left" tabIndex={-1} aria-label="Scroll the channels left" onClick={() => scrollBy(-1)}>
            <ChevronLeft size={16} />
          </button>
        )}
        <div ref={scrollRef} className="badges" onScroll={onScroll}>
          <div ref={trackRef} className="badges-track">
            {p.channels.map((c) =>
              badge(c.wave.id, c.display, c.wave.yUnit, c.display.label, settings(c.display, c.wave.yUnit, true, undefined, c.input), undefined, c.input),
            )}
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
                  !!m.result?.wave,
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
          </div>
        </div>
        {edges.right && (
          <button type="button" className="badges-scroll right" tabIndex={-1} aria-label="Scroll the channels right" onClick={() => scrollBy(1)}>
            <ChevronRight size={16} />
          </button>
        )}
      </div>
      <div className="badge-actions">
        <button
          type="button"
          className="add-math"
          disabled={p.math.length >= MAX_MATH}
          title={p.math.length >= MAX_MATH ? `At most ${MAX_MATH} math channels` : 'Add a math channel (computed from other channels)'}
          onClick={() => {
            // Render the new badge right away, then open its editor at it
            let id: string | undefined
            flushSync(() => {
              id = p.onAddMath()
            })
            if (id) openFor(id, reveal(id))
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
      <div className="info-box" title={`Window ${si(p.win.start, 's')} … ${si(p.win.end, 's')}`} onContextMenu={p.onTimebaseMenu}>
        <span className="info-title">Horizontal</span>
        <span className="info-main mono">{si(p.timePerDiv, 's/div', 3)}</span>
        <span className="info-sub mono">
          {si(p.sampleRate, 'S/s', 3)} · {si(p.recordLength, 'pts', 3)}
        </span>
      </div>
      {p.trigger && (
        <div className="info-box trigger" onContextMenu={p.onTimebaseMenu}>
          <span className="info-title">Trigger</span>
          {/* In the colour of the source channel; orange (CSS) for sources without a trace, e.g. AUX */}
          <span className="info-main mono" style={{ color: triggerColor && ink(triggerColor) }}>
            {channelName(p.trigger.source)} {slopeSymbol(p.trigger.slope)}
          </span>
          <span className="info-sub mono">{p.trigger.level !== undefined ? si(p.trigger.level, sourceUnit(p.channels, p.trigger.source), 3) : ''}</span>
        </div>
      )}
    </footer>
  )
})
