import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AlertTriangle, AudioLines, ChevronLeft, ChevronRight, Eye, EyeOff, Plus } from 'lucide-react'
import type { MathResult } from '../math/expr'
import { MAX_MATH, type MathDef } from '../model/math'
import { badgeItems, inputSummary } from '../model/input'
import type { ChannelDisplay, ChannelInput, Session } from '../model/types'
import { shownViews } from '../model/view'
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
  /** The view whose channels the pointer is on (or whose settings are open), for the plot to outline it */
  onHighlightView?: (view: number | undefined) => void
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

  const badgeEl = useCallback((id: string) => scrollRef.current?.querySelector<HTMLElement>(`.ch-badge[data-id="${CSS.escape(id)}"]`) ?? null, [])
  /** Scroll a badge fully into view (clear of the edge fades) and return it */
  const reveal = useCallback(
    (id: string) => {
      const row = scrollRef.current
      const b = badgeEl(id)
      if (!row || !b || row.scrollWidth <= row.clientWidth) return b
      const s = row.getBoundingClientRect()
      const r = b.getBoundingClientRect()
      if (r.left < s.left + EDGE_PX) row.scrollLeft -= s.left + EDGE_PX - r.left
      else if (r.right > s.right - EDGE_PX) row.scrollLeft += r.right - (s.right - EDGE_PX)
      return b
    },
    [badgeEl],
  )
  // The selected channel (e.g. by clicking its trace) is always visible in the row
  useEffect(() => {
    if (p.selected) reveal(p.selected)
  }, [p.selected, reveal])
  // A resized window moves the badge: the open settings follow it (and stay inside the window)
  const openId = open?.id
  const placeOpen = useCallback(
    (id: string) => {
      const el = reveal(id)
      if (el) setOpen({ id, style: placeNear(el.getBoundingClientRect(), POPOVER_W, 'above') })
    },
    [reveal],
  )
  useEffect(() => {
    if (!openId) return
    const place = () => placeOpen(openId)
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [openId, placeOpen])

  // A badge dragged to another view: pressed on the badge (not yet moved far enough to be a drag), then
  // dragged with the view under the pointer as its target (`views.length`: a new view of its own)
  const [drag, setDrag] = useState<{ id: string; target?: number } | null>(null)
  const [ghost, setGhost] = useState({ x: 0, y: 0 })
  const press = useRef<{ id: string; x0: number; y0: number } | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const justDragged = useRef(false)
  /** Where the badge `id` would go if it were dropped at (x, y); not where it already is */
  const targetAt = (id: string, x: number, y: number): number | undefined => {
    const drop = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]')?.dataset.drop
    const target = drop === 'new' ? p.views.length : drop === undefined ? undefined : Number(drop)
    return target !== undefined && !p.views[target]?.includes(id) && !(target === p.views.length && p.views.some((v) => v.length === 1 && v[0] === id)) ? target : undefined
  }
  const cancelDrag = () => {
    press.current = null
    setDrag(null)
  }
  // The row scrolls while a badge is held near its edge
  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    let raf = 0
    const tick = () => {
      const row = scrollRef.current
      const id = press.current?.id
      if (row && id) {
        const r = row.getBoundingClientRect()
        const { x, y } = pointer.current
        const edge = 48
        if (x < r.left + edge) row.scrollLeft -= Math.ceil((r.left + edge - x) / 4)
        else if (x > r.right - edge) row.scrollLeft += Math.ceil((x - (r.right - edge)) / 4)
        // What is under the pointer changes as the row scrolls
        const target = targetAt(id, x, y)
        setDrag((d) => (d && d.target !== target ? { ...d, target } : d))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      cancelDrag()
    }
    window.addEventListener('keydown', key, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', key, true)
    }
    // targetAt and cancelDrag only read props and refs of this render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])

  // The view of the channels the pointer is on, or of the open settings: outlined in the plot
  const [hoverView, setHoverView] = useState<number | undefined>()
  const openView = openId ? p.views.findIndex((v) => v.includes(openId)) : -1
  const litView = drag ? drag.target : (hoverView ?? (openView >= 0 ? openView : undefined))
  const { onHighlightView } = p
  useEffect(() => {
    onHighlightView?.(litView)
  }, [litView, onHighlightView])
  useEffect(() => () => onHighlightView?.(undefined), [onHighlightView])
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
  // The FFT button acts on the selected channel (the first one when none is selected, or it has no waveform)
  const hasWave = (id: string) => p.channels.some((c) => c.wave.id === id) || p.math.some((m) => m.def.id === id && m.result?.wave)
  const fftId = p.selected && hasWave(p.selected) ? p.selected : p.channels[0]?.wave.id
  const fftOn = fftId !== undefined && p.spectrumSources.has(fftId)
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
        className={`ch-badge ${p.selected === id ? 'selected' : ''} ${d.visible ? '' : 'off'} ${error ? 'error' : ''} ${drag?.id === id ? 'dragging' : ''}`}
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
            title={`${channelName(id)}${d.label ? ` – ${d.label}` : ''}${error ? ` – ${error}` : ''}${input ? `\n${inputSummary(input)}` : ''}\nClick for settings · drag to another view`}
            aria-expanded={isOpen}
            onPointerDown={(e) => {
              // A mouse or pen drags the badge; a finger scrolls the row (the settings have buttons for the views)
              if (e.button !== 0 || e.pointerType === 'touch') return
              press.current = { id, x0: e.clientX, y0: e.clientY }
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              const pr = press.current
              if (!pr || pr.id !== id) return
              pointer.current = { x: e.clientX, y: e.clientY }
              if (!drag) {
                // A click stays a click until the pointer has moved a few pixels
                if (Math.hypot(e.clientX - pr.x0, e.clientY - pr.y0) < 6) return
                p.setSelected(id)
                setOpen(null)
              }
              setGhost({ x: e.clientX, y: e.clientY })
              const target = targetAt(id, e.clientX, e.clientY)
              setDrag((d) => (d && d.id === id && d.target === target ? d : { id, target }))
            }}
            onPointerUp={() => {
              const target = drag?.target
              press.current = null
              if (!drag) return
              // The click that follows the release is not a click on the badge
              justDragged.current = true
              setTimeout(() => (justDragged.current = false))
              setDrag(null)
              if (target !== undefined) {
                p.onMoveToView(id, target)
                requestAnimationFrame(() => reveal(id))
              }
            }}
            onPointerCancel={cancelDrag}
            onClick={(e) => {
              if (justDragged.current) return
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
      onPreviewView={setHoverView}
      onMoveToView={(id, view) => {
        p.onMoveToView(id, view)
        // The badge now sits in another group: the settings follow it
        requestAnimationFrame(() => placeOpen(id))
      }}
      onAutoscale={p.onAutoscale}
      hasSpectrum={p.spectrumSources.has(d.id)}
      canAddSpectrum={p.canAddSpectrum}
      onToggleSpectrum={() => p.onToggleSpectrum(d.id)}
    >
      {children}
    </ChannelSettings>
  )

  // One badge per channel (inputs, then math). With several views they are grouped by view, each group
  // numbered like its view in the plot; a view whose channels are all hidden is marked as left out
  const nodes = new Map<string, React.ReactNode>()
  for (const c of p.channels) {
    nodes.set(c.wave.id, badge(c.wave.id, c.display, c.wave.yUnit, c.display.label, settings(c.display, c.wave.yUnit, true, undefined, c.input), undefined, c.input))
  }
  for (const m of p.math) {
    const unit = m.result?.wave?.yUnit ?? ''
    nodes.set(
      m.def.id,
      badge(
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
      ),
    )
  }
  const grouped = p.views.length > 1
  const visible = (id: string) => !!(p.channels.find((c) => c.wave.id === id) ?? p.math.find((m) => m.def.id === id))?.display.visible
  const shown = shownViews(p.views, visible)
  const order = [...nodes.keys()]
  const groups = p.views
    .map((v, view) => ({ view, ids: order.filter((id) => v.includes(id)), shown: shown[view], selected: p.selected !== undefined && v.includes(p.selected) }))
    .filter((g) => g.ids.length > 0)
  const strays = order.filter((id) => !p.views.some((v) => v.includes(id)))
  // While a badge is dragged: a place to drop it for a view of its own (not for the only channel of a view)
  const newView =
    drag && !p.views.some((v) => v.length === 1 && v[0] === drag.id) ? (
      <div key="new-view" data-drop="new" className={`ch-newview ${drag.target === p.views.length ? 'drop' : ''}`}>
        <Plus size={14} aria-hidden /> New view
      </div>
    ) : null
  const dragTarget = drag?.target === undefined ? '' : drag.target === p.views.length ? ' → new view' : ` → view ${drag.target + 1}`
  const dragColor = (p.channels.find((c) => c.wave.id === drag?.id) ?? p.math.find((m) => m.def.id === drag?.id))?.display.color

  return (
    <footer className={`channel-bar ${drag ? 'dragging' : ''}`}>
      {drag && (
        <div className="ch-ghost" style={{ left: ghost.x + 14, top: ghost.y + 14, ['--ch' as string]: ink(dragColor ?? '#888') }}>
          {channelName(drag.id)}
          {dragTarget}
        </div>
      )}
      <div className="badges-wrap">
        {edges.left && (
          <button type="button" className="badges-scroll left" tabIndex={-1} aria-label="Scroll the channels left" onClick={() => scrollBy(-1)}>
            <ChevronLeft size={16} />
          </button>
        )}
        <div ref={scrollRef} className="badges" onScroll={onScroll}>
          <div ref={trackRef} className="badges-track">
            {grouped
              ? [
                  ...groups.map((g) => (
                    <div
                      key={`view${g.view}`}
                      role="group"
                      aria-label={`View ${g.view + 1}`}
                      data-drop={g.view}
                      className={`ch-group ${g.shown ? '' : 'off'} ${g.selected ? 'selected' : ''} ${drag?.target === g.view ? 'drop' : ''}`}
                      onPointerEnter={() => setHoverView(g.view)}
                      onPointerLeave={() => setHoverView(undefined)}
                      onFocus={() => setHoverView(g.view)}
                      onBlur={() => setHoverView(undefined)}
                    >
                      <span
                        className="ch-group-num"
                        title={
                          g.shown
                            ? `View ${g.view + 1}: ${g.ids.length === 1 ? 'one channel has' : `${g.ids.length} channels share`} its grid and scale. Drag a channel tag in the plot onto another view to move it`
                            : `View ${g.view + 1}: all its channels are hidden, so the plot leaves it out`
                        }
                      >
                        {g.view + 1}
                        {!g.shown && <EyeOff size={11} aria-label="Hidden" />}
                      </span>
                      {g.ids.map((id) => nodes.get(id))}
                    </div>
                  )),
                  ...strays.map((id) => nodes.get(id)),
                  newView,
                ]
              : [...nodes.values(), newView]}
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
          aria-label="Add a math channel"
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
          <Plus size={14} aria-hidden /> <span className="add-label">Math</span>
        </button>
        <button
          type="button"
          className={`add-math ${fftOn ? 'active' : ''}`}
          aria-pressed={fftOn}
          aria-label={fftId ? `${fftOn ? 'Remove' : 'Show'} the spectrum of ${channelName(fftId)}` : 'Show a spectrum'}
          disabled={fftId === undefined || (!fftOn && !p.canAddSpectrum)}
          title={
            fftId === undefined
              ? 'No channel'
              : fftOn
                ? `Remove the frequency spectrum (FFT) of ${channelName(fftId)}`
                : p.canAddSpectrum
                  ? `Show the frequency spectrum (FFT) of ${channelName(fftId)}, the selected channel`
                  : 'Too many spectra'
          }
          onClick={() => fftId && p.onToggleSpectrum(fftId)}
        >
          <AudioLines size={14} aria-hidden />
          <span className="add-label">
            FFT
            {fftId && <small>{channelName(fftId)}</small>}
          </span>
        </button>
      </div>
      <div className="spacer" />
      <div className="info-box" title={`Window ${si(p.win.start, 's')} … ${si(p.win.end, 's')}`} onContextMenu={p.onTimebaseMenu}>
        <span className="info-title">Horizontal</span>
        {/* The window next to the time per division, as on the scope: zoomed freely, it is not always 10 divisions */}
        <span className="info-main mono">
          {si(p.timePerDiv, 's/div', 3)} <span className="info-window">{si(p.win.end - p.win.start, 's', 3)}</span>
        </span>
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
