import { forwardRef, useDeferredValue, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ClipboardList, Copy, Eye, EyeOff, Maximize2, Plus, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { ComputeEngine } from '../compute/engine'
import { MIN_FFT_SAMPLES, WINDOW_DEFS, findPeaks, toDb, windowDef, type Peak, type Spectrum, type WindowKind } from '../math/fft'
import { MAX_SPECTRA, PEAK_COUNTS, levelUnit, type FreqAxis, type SpectrumDef, type SpectrumOptions, type SpectrumScale } from '../model/spectrum'
import { rangeChoices } from './scopeCommands'
import { ResizeHandle } from './ui/ResizeHandle'
import { panShare, wheelPan, wheelPixels, wheelZoomFactor } from './ui/wheel'
import { SampleCache } from '../util/sampleCache'
import type { SpectrumSource } from '../export/sessionExport'
import { AXIS_GUTTER } from '../render/draw'
import { FREQ_AXIS_H, drawSpectrum, levelValue, readLevel, xToF, type FreqMap, type FreqRange } from '../render/spectrum'
import { SANS, font } from '../render/fonts'
import type { Theme } from '../render/theme'
import { niceStep, si } from '../util/format'
import { channelName } from '../util/names'
import { MEASURE_RANGES, RANGE_LABEL, type CursorState, type LiveChannel, type TimeWindow } from '../model/view'
import { useContextMenu, type MenuEntry } from './ui/menuContext'
import { useTheme } from './ui/themeContext'

interface Props {
  /** Computes the spectra in its worker */
  engine: Pick<ComputeEngine, 'spectrum'>
  defs: SpectrumDef[]
  options: SpectrumOptions
  setOptions: (patch: Partial<SpectrumOptions>) => void
  /** All channels with a waveform (inputs and math) */
  channels: LiveChannel[]
  win: TimeWindow
  cursors: CursorState
  /** Height of the plot (the bar above wraps as needed) */
  height: number
  setHeight: (h: number) => void
  onAdd: () => void
  onChange: (id: string, patch: Partial<SpectrumDef>) => void
  onRemove: (id: string) => void
  /** Remove all spectra */
  onClose: () => void
  onOpenReference: () => void
  /** Copy text to the clipboard; `what` describes it for the confirmation */
  onCopy: (text: string, what: string) => void
}

interface Result {
  def: SpectrumDef
  channel?: LiveChannel
  spec?: Spectrum
  error?: string
  /** Being computed (`spec` is then the previous spectrum of the same channel and window, if any) */
  pending?: boolean
}

/** A spectrum being computed in the worker, or computed (`spec` undefined: too few samples) */
interface SpectrumJob {
  done: boolean
  spec?: Spectrum
}
type Shown = Result & { channel: LiveChannel; spec: Spectrum }

export type SpectrumViewHandle = SpectrumSource

type Drag = { kind: 'pan'; x0: number; y0: number; f: FreqRange; y: FreqRange } | { kind: 'band'; x0: number; x1: number }

const MIN_BAND_PX = 5

/**
 * Frequency-domain view below the time views: the FFT of channels or math channels over the
 * visible time window, between the cursors or over the whole record, with a peak list.
 */
export const SpectrumView = forwardRef<SpectrumViewHandle, Props>(function SpectrumView(p, ref) {
  // Deferred so panning the time views stays smooth while the spectra follow
  const win = useDeferredValue(p.win)
  // Named apart from the `theme` of exports (renderImage)
  const { theme: screenTheme } = useTheme()
  const cursors = useDeferredValue(p.cursors)
  const { range, scale, axis } = p.options

  // Spectra are computed in the worker and cached per spectrum, sample array, window and range:
  // changing a colour, label or unit recomputes nothing. A finished job renders again (`done`); while
  // one is computed, the previous spectrum of that channel and window stays (no flicker when zooming).
  // Each spectrum is its own slot in the worker's queue: while panning, only its latest range waits.
  const [cache] = useState(() => new SampleCache<SpectrumJob>(8))
  const [done, setDone] = useState(0)
  const previous = useRef(new Map<string, { source: string; window: WindowKind; spec: Spectrum }>())
  const job = (id: string, w: LiveChannel['wave'], i0: number, i1: number, window: WindowKind): SpectrumJob => {
    const key = `${id}:${window}:${w.dt}:${i0}:${i1}`
    return cache.get(w.data, key, () => {
      const j: SpectrumJob = { done: false }
      void p.engine.spectrum(w.data, w.dt, i0, i1, window, `spectrum:${id}`).then((r) => {
        // Not computed (a newer range of this spectrum took its place, samples replaced meanwhile,
        // worker stopped): asked again on the next change
        if (!r) return cache.delete(w.data, key)
        j.done = true
        j.spec = r.spec
        setDone((n) => n + 1)
      })
      return j
    })
  }
  const results: Result[] = useMemo(
    () =>
      p.defs.map((def) => {
        const channel = p.channels.find((c) => c.wave.id === def.source)
        if (!channel) return { def, error: `${channelName(def.source)} has no waveform` }
        const w = channel.wave
        let t0 = -Infinity
        let t1 = Infinity
        if (range === 'screen') {
          t0 = win.start
          t1 = win.end
        } else if (range === 'cursors') {
          t0 = Math.min(cursors.a, cursors.b)
          t1 = Math.max(cursors.a, cursors.b)
        }
        const i0 = Math.max(0, Math.ceil((t0 - w.t0) / w.dt - 1e-9))
        const i1 = Math.min(w.data.length, Math.floor((t1 - w.t0) / w.dt + 1e-9) + 1)
        const j = job(def.id, w, i0, i1, def.window)
        if (!j.done) {
          const prev = previous.current.get(def.id)
          return { def, channel, spec: prev?.source === def.source && prev.window === def.window ? prev.spec : undefined, pending: true }
        }
        if (!j.spec) return { def, channel, error: `Fewer than ${MIN_FFT_SAMPLES} samples in the range` }
        previous.current.set(def.id, { source: def.source, window: def.window, spec: j.spec })
        return { def, channel, spec: j.spec }
      }),
    // `job` reads the engine and the cache; `done` counts the jobs that finished
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.defs, p.channels, range, win, cursors, cache, p.engine, done],
  )
  const shown = useMemo(() => results.filter((r): r is Shown => !!r.spec && r.def.visible), [results])
  // Each spectrum is read in the unit of its channel; the level axis has a unit when all shown spectra share it
  const units = [...new Set(shown.map((r) => r.channel.wave.yUnit))]
  const unit = units.length === 1 ? units[0] : ''
  const mixedUnits = units.length > 1

  // ---------- axes ----------
  const fullF = useMemo<FreqRange>(() => {
    if (!shown.length) return axis === 'log' ? { lo: 1, hi: 1e6 } : { lo: 0, hi: 1e6 }
    const hi = Math.max(...shown.map((r) => r.spec.sampleRate / 2))
    return { lo: axis === 'log' ? Math.min(...shown.map((r) => r.spec.df)) : 0, hi }
  }, [shown, axis])
  const autoY = useMemo(() => autoLevelRange(shown, scale, axis === 'linear'), [shown, scale, axis])
  // Zoomed ranges belong to an axis type / scale; switching them shows the full range again
  const [fZoom, setFZoom] = useState<(FreqRange & { axis: FreqAxis }) | null>(null)
  const [yZoom, setYZoom] = useState<(FreqRange & { scale: SpectrumScale }) | null>(null)
  const fr = fZoom && fZoom.axis === axis ? clampRange(fZoom, fullF, axis) : fullF
  const yr = yZoom && yZoom.scale === scale ? yZoom : autoY
  const zoomed = fr.lo !== fullF.lo || fr.hi !== fullF.hi || yr !== autoY

  const peaks = useMemo(() => {
    const m = new Map<string, Peak[]>()
    for (const r of shown) m.set(r.def.id, findPeaks(r.spec, p.options.peaks, fr.lo / r.spec.df, fr.hi / r.spec.df))
    return m
  }, [shown, p.options.peaks, fr.lo, fr.hi])

  // ---------- canvas ----------
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 800, h: 200 })
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const plotW = Math.max(10, size.w - AXIS_GUTTER)
  const plotH = Math.max(10, size.h - FREQ_AXIS_H)
  const map: FreqMap = { axis, lo: fr.lo, hi: fr.hi, width: plotW }
  const hoverF = hover && hover.x <= plotW && hover.y <= plotH ? xToF(map, hover.x) : undefined

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx) return
      drawSpectrum(ctx, {
        width: size.w,
        height: size.h,
        dpr: window.devicePixelRatio || 1,
        map: { axis, lo: fr.lo, hi: fr.hi, width: plotW },
        scale,
        yLo: yr.lo,
        yHi: yr.hi,
        yUnit: scale === 'db' ? levelUnit('db', unit) : unit,
        traces: shown.map((r) => ({ spec: r.spec, color: r.channel.display.color, peaks: peaks.get(r.def.id) ?? [] })),
        hoverF: drag ? undefined : hoverF,
        band: drag?.kind === 'band' ? drag : undefined,
        theme: screenTheme,
      })
    })
    return () => cancelAnimationFrame(id)
  }, [shown, peaks, size, axis, fr.lo, fr.hi, plotW, scale, yr, unit, hoverF, drag, screenTheme])

  useImperativeHandle(ref, () => ({
    renderImage: (k: number, theme: Theme) => {
      if (!shown.length) return null
      const CAPTION = 20
      const out = document.createElement('canvas')
      out.width = Math.round(size.w * k)
      out.height = Math.round((size.h + CAPTION) * k)
      const ctx = out.getContext('2d')!
      ctx.setTransform(k, 0, 0, k, 0, 0)
      ctx.fillStyle = theme.page
      ctx.fillRect(0, 0, size.w, CAPTION)
      ctx.font = font(12, SANS, 600)
      ctx.fillStyle = theme.text
      ctx.textBaseline = 'middle'
      let x = 8
      ctx.fillText('Spectrum', x, CAPTION / 2)
      x += ctx.measureText('Spectrum').width + 14
      ctx.font = font(12, SANS)
      for (const r of shown) {
        const label = `${channelName(r.def.source)} · ${windowDef(r.def.window).label}${mixedUnits ? ` (${levelUnit(scale, r.channel.wave.yUnit)})` : ''}`
        ctx.fillStyle = theme.ink(r.channel.display.color)
        ctx.fillRect(x, CAPTION / 2 - 4, 8, 8)
        ctx.fillStyle = theme.textDim
        ctx.fillText(label, x + 12, CAPTION / 2)
        x += ctx.measureText(label).width + 26
      }
      const cv = document.createElement('canvas')
      cv.width = out.width
      cv.height = Math.round(size.h * k)
      drawSpectrum(cv.getContext('2d')!, {
        width: size.w,
        height: size.h,
        dpr: k,
        map: { axis, lo: fr.lo, hi: fr.hi, width: plotW },
        scale,
        yLo: yr.lo,
        yHi: yr.hi,
        yUnit: scale === 'db' ? levelUnit('db', unit) : unit,
        traces: shown.map((r) => ({ spec: r.spec, color: r.channel.display.color, peaks: peaks.get(r.def.id) ?? [] })),
        theme,
      })
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(cv, 0, Math.round(CAPTION * k))
      return out
    },
    getData: () => ({
      scale,
      items: shown.map((r) => ({
        name: channelName(r.def.source),
        levelUnit: levelUnit(scale, r.channel.wave.yUnit),
        color: r.channel.display.color,
        window: windowDef(r.def.window).label,
        spec: r.spec,
        peaks: peaks.get(r.def.id) ?? [],
      })),
    }),
  }))

  // ---------- mouse ----------
  // Positions along the frequency axis are handled in axis units (log10 f on a log axis)
  const toU = (f: number) => (axis === 'log' ? Math.log10(f) : f)
  const fromU = (u: number) => (axis === 'log' ? Math.pow(10, u) : u)
  const setF = (lo: number, hi: number) => setFZoom({ ...clampRange({ lo, hi }, fullF, axis), axis })

  /** Zoom frequency by `factor` (>1 = out) keeping the frequency at x in place */
  const zoomF = (x: number, factor: number) => {
    const uLo = toU(fr.lo)
    const uHi = toU(fr.hi)
    const frac = Math.min(1, Math.max(0, x / plotW))
    const uAt = uLo + frac * (uHi - uLo)
    const df = Math.min(...shown.map((r) => r.spec.df), Infinity)
    const fAt = fromU(uAt)
    // Do not zoom in further than about 8 bins
    const minSpan = Number.isFinite(df) ? toU(fAt + 8 * df) - toU(fAt) : 0
    const span = Math.min(toU(fullF.hi) - toU(fullF.lo), Math.max(minSpan, (uHi - uLo) * factor))
    setF(fromU(uAt - frac * span), fromU(uAt - frac * span + span))
  }
  const zoomY = (y: number, factor: number) => {
    const frac = Math.min(1, Math.max(0, y / plotH))
    const at = yr.hi - frac * (yr.hi - yr.lo)
    const span = (yr.hi - yr.lo) * factor
    setYZoom({ hi: at + frac * span, lo: at + frac * span - span, scale })
  }

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    // As in the plot: the wheel zooms (Ctrl: the level axis), Shift+wheel or a sideways swipe pans
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const factor = wheelZoomFactor(wheelPixels(e).y)
      const pan = e.ctrlKey ? undefined : wheelPan(e)
      if (pan !== undefined) {
        const du = (toU(fr.hi) - toU(fr.lo)) * panShare(pan)
        if (du) setF(fromU(toU(fr.lo) + du), fromU(toU(fr.hi) + du))
      } else if (e.ctrlKey) zoomY(e.clientY - r.top, factor)
      else zoomF(e.clientX - r.left, factor)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const local = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const { x, y } = local(e)
    if (x > plotW) return
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // synthetic events have no active pointer
    }
    // Shift+drag or a drag along the frequency axis marks a range to zoom into
    if (e.shiftKey || y > plotH) setDrag({ kind: 'band', x0: x, x1: x })
    else setDrag({ kind: 'pan', x0: x, y0: y, f: fr, y: yr })
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = local(e)
    setHover({ x, y })
    if (!drag) return
    if (drag.kind === 'band') {
      setDrag({ ...drag, x1: Math.min(plotW, Math.max(0, x)) })
      return
    }
    const du = ((x - drag.x0) / plotW) * (toU(drag.f.hi) - toU(drag.f.lo))
    setF(fromU(toU(drag.f.lo) - du), fromU(toU(drag.f.hi) - du))
    if (Math.abs(y - drag.y0) > 2 || yZoom) {
      const dv = ((y - drag.y0) / plotH) * (drag.y.hi - drag.y.lo)
      setYZoom({ lo: drag.y.lo + dv, hi: drag.y.hi + dv, scale })
    }
  }
  const onPointerUp = () => {
    const d = drag
    setDrag(null)
    if (d?.kind === 'band' && Math.abs(d.x1 - d.x0) >= MIN_BAND_PX) {
      setF(xToF(map, Math.min(d.x0, d.x1)), xToF(map, Math.max(d.x0, d.x1)))
    }
  }
  const resetZoom = () => {
    setFZoom(null)
    setYZoom(null)
  }

  const sources = p.channels.map((c) => c.wave.id)
  /** A channel's colour as drawn; the muted text colour for a source that is gone */
  const colorOf = (id: string) => {
    const color = p.channels.find((c) => c.wave.id === id)?.display.color
    return color ? screenTheme.ink(color) : screenTheme.muted
  }
  /** A level in the unit of its spectrum's channel */
  const lvl = (rms: number, u: string) => (scale === 'db' ? `${levelValue('db', rms).toFixed(1)} ${levelUnit('db', u)}` : si(rms, u))
  const lvlOf = (r: Shown, rms: number) => lvl(rms, r.channel.wave.yUnit)
  const hoverLevels =
    hoverF === undefined || drag
      ? []
      : shown.flatMap((r) => {
          const x = hover!.x
          const v = readLevel(r.spec, hoverF, xToF(map, x - 0.5), xToF(map, x + 0.5))
          return v ? [{ r, v }] : []
        })

  // ---------- context menus ----------
  const menu = useContextMenu()
  const peakLines = (rs: Shown[]) => [
    ['Spectrum', '#', 'Frequency', 'Level'].join('\t'),
    ...rs.flatMap((r) => (peaks.get(r.def.id) ?? []).map((pk, i) => [channelName(r.def.source), i + 1, si(pk.freq, 'Hz', 5), lvlOf(r, pk.rms)].join('\t'))),
  ]
  const hasPeaks = shown.some((r) => peaks.get(r.def.id)?.length)
  const options: MenuEntry[] = [
    {
      kind: 'choices',
      label: 'Level',
      options: (['db', 'linear'] as const).map((sc) => ({ label: levelUnit(sc, unit), checked: scale === sc, onClick: () => p.setOptions({ scale: sc }) })),
    },
    {
      kind: 'choices',
      label: 'Freq.',
      options: (['log', 'linear'] as const).map((a) => ({ label: a === 'log' ? 'Log' : 'Linear', title: `${a === 'log' ? 'Logarithmic' : 'Linear'} frequency axis`, checked: axis === a, onClick: () => p.setOptions({ axis: a }) })),
    },
    {
      kind: 'choices',
      label: 'Peaks',
      options: PEAK_COUNTS.map((n) => ({ label: n ? String(n) : 'Off', title: n ? `List the ${n} highest peaks` : 'No peak list', checked: p.options.peaks === n, onClick: () => p.setOptions({ peaks: n }) })),
    },
    rangeChoices(range, (r) => p.setOptions({ range: r })),
    '-',
    { label: 'Copy peak list', icon: ClipboardList, disabled: !hasPeaks, onClick: () => p.onCopy(peakLines(shown).join('\n'), 'Peak list') },
    { label: 'Add spectrum', icon: Plus, disabled: p.defs.length >= MAX_SPECTRA, onClick: p.onAdd },
    { label: 'Spectrum reference', icon: BookOpen, onClick: p.onOpenReference },
  ]
  const plotMenu = (e: React.MouseEvent) => {
    const r = wrapRef.current!.getBoundingClientRect()
    const x = Math.min(plotW, Math.max(0, e.clientX - r.left))
    const inPlot = e.clientX - r.left <= plotW && e.clientY - r.top <= plotH
    const f = xToF(map, x)
    const levels = inPlot
      ? shown.flatMap((s) => {
          const v = readLevel(s.spec, f, xToF(map, x - 0.5), xToF(map, x + 0.5))
          return v ? [{ s, v }] : []
        })
      : []
    const readout = [si(f, 'Hz', 5), ...levels.map(({ s, v }) => `${channelName(s.def.source)}: ${lvlOf(s, v.rms)} at ${si(v.freq, 'Hz', 5)}`)]
    menu(e, [
      inPlot && { kind: 'heading', label: 'Frequency', detail: si(f, 'Hz', 5) },
      levels.length > 0 && { label: 'Copy frequency and levels', icon: Copy, onClick: () => p.onCopy(readout.join('\n'), 'Spectrum readout') },
      { label: 'Zoom in here', icon: ZoomIn, onClick: () => zoomF(x, 0.5) },
      { label: 'Zoom out', icon: ZoomOut, onClick: () => zoomF(x, 2) },
      { label: 'Full span', icon: Maximize2, disabled: !zoomed, onClick: resetZoom },
      '-',
      ...options,
    ])
  }
  const peakMenu = (e: React.MouseEvent, r: Shown, i: number) => {
    const pk = peaks.get(r.def.id)![i]
    menu(e, [
      { kind: 'heading', label: `${channelName(r.def.source)} · peak ${i + 1}`, color: r.channel.display.color, detail: si(pk.freq, 'Hz', 5) },
      { label: 'Copy peak', icon: Copy, onClick: () => p.onCopy(`${si(pk.freq, 'Hz', 5)}\t${lvlOf(r, pk.rms)}`, `Peak ${i + 1} of ${channelName(r.def.source)}`) },
      { label: `Copy peaks of ${channelName(r.def.source)}`, icon: ClipboardList, onClick: () => p.onCopy(peakLines([r]).join('\n'), `Peaks of ${channelName(r.def.source)}`) },
      '-',
      ...options,
    ])
  }

  return (
    <section className="spectrum" aria-label="Spectrum" onContextMenu={(e) => menu(e, options)}>
      <ResizeHandle height={p.height} setHeight={p.setHeight} />
      <div className="spectrum-bar">
        <span className="section-title">Spectrum</span>
        <div className="spec-chips">
          {p.defs.map((d) => (
            <div key={d.id} className={`spec-chip ${d.visible ? '' : 'off'}`} style={{ ['--ch' as string]: colorOf(d.source) }}>
              <select value={d.source} aria-label="Source" title="Source channel" onChange={(e) => p.onChange(d.id, { source: e.target.value })}>
                {!sources.includes(d.source) && <option value={d.source}>{channelName(d.source)}</option>}
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {channelName(s)}
                  </option>
                ))}
              </select>
              <select
                value={d.window}
                aria-label="Window"
                title={windowDef(d.window).use}
                onChange={(e) => p.onChange(d.id, { window: e.target.value as WindowKind })}
              >
                {WINDOW_DEFS.map((w) => (
                  <option key={w.key} value={w.key}>
                    {w.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="chip-btn"
                title={d.visible ? 'Hide spectrum' : 'Show spectrum'}
                aria-label={d.visible ? 'Hide spectrum' : 'Show spectrum'}
                onClick={() => p.onChange(d.id, { visible: !d.visible })}
              >
                {d.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button type="button" className="chip-btn" title="Remove spectrum" aria-label="Remove spectrum" onClick={() => p.onRemove(d.id)}>
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="icon-btn"
            title="Add a spectrum"
            aria-label="Add a spectrum"
            disabled={p.defs.length >= MAX_SPECTRA}
            onClick={p.onAdd}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="spec-options">
          <select
            className="range-select"
            value={range}
            aria-label="Range"
            title="Samples the spectrum is computed from"
            onChange={(e) => p.setOptions({ range: e.target.value as SpectrumOptions['range'] })}
          >
            {MEASURE_RANGES.map((r) => (
              <option key={r} value={r}>
                {RANGE_LABEL[r]}
              </option>
            ))}
          </select>
          <div className="segmented" role="group" aria-label="Level scale" title={mixedUnits ? 'Level scale (each spectrum in the unit of its channel)' : 'Level scale'}>
            {(['db', 'linear'] as const).map((sc) => (
              <button key={sc} type="button" className={scale === sc ? 'active' : ''} aria-pressed={scale === sc} onClick={() => p.setOptions({ scale: sc })}>
                {levelUnit(sc, unit)}
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Frequency axis" title="Frequency axis">
            {(['log', 'linear'] as const).map((a) => (
              <button key={a} type="button" className={axis === a ? 'active' : ''} aria-pressed={axis === a} onClick={() => p.setOptions({ axis: a })}>
                {a === 'log' ? 'Log f' : 'Linear f'}
              </button>
            ))}
          </div>
          <label className="inline-field">
            Peaks
            <select value={p.options.peaks} onChange={(e) => p.setOptions({ peaks: Number(e.target.value) })}>
              {PEAK_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n || 'Off'}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="icon-btn" title="Full span (double-click)" aria-label="Full span" disabled={!zoomed} onClick={resetZoom}>
            <Maximize2 size={16} />
          </button>
          <button type="button" className="icon-btn" title="Windows and dB scale explained" aria-label="Spectrum reference" onClick={p.onOpenReference}>
            <BookOpen size={16} />
          </button>
          <button type="button" className="icon-btn" title="Close the spectrum view (removes all spectra)" aria-label="Close spectrum view" onClick={p.onClose}>
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="spectrum-body" style={{ height: p.height }}>
        <div
          ref={wrapRef}
          className="spectrum-plot"
          style={{ cursor: drag?.kind === 'pan' ? 'grabbing' : drag?.kind === 'band' ? 'col-resize' : 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={resetZoom}
          onContextMenu={plotMenu}
          title="Wheel: zoom frequency · Ctrl+wheel: zoom level · Drag: pan · Shift+drag: zoom to range · Double-click: full span"
        >
          <canvas
            ref={canvasRef}
            width={Math.round(size.w * (window.devicePixelRatio || 1))}
            height={Math.round(size.h * (window.devicePixelRatio || 1))}
            style={{ width: size.w, height: size.h, display: 'block' }}
          />
          {hoverF !== undefined && hoverLevels.length > 0 && (
            <div className="spec-readout" style={hover!.x > plotW - 200 ? { right: size.w - hover!.x + 12 } : { left: hover!.x + 12 }}>
              <div className="mono">{si(hoverF, 'Hz', 5)}</div>
              {hoverLevels.map(({ r, v }) => (
                <div key={r.def.id} className="mono">
                  <span className="dot" style={{ background: screenTheme.ink(r.channel.display.color) }} />
                  {lvlOf(r, v.rms)}
                </div>
              ))}
            </div>
          )}
          {!shown.length && (
            <div className="spec-empty">{results.find((r) => r.error)?.error ?? (results.some((r) => r.pending) ? 'Computing the spectrum…' : 'All spectra are hidden')}</div>
          )}
        </div>

        <aside className="spec-side" aria-label="Spectrum details and peaks">
          {results.map((r) => (
            <div key={r.def.id} className={`spec-block ${r.def.visible ? '' : 'off'}`}>
              <div className="spec-block-head">
                <span className="dot" style={{ background: colorOf(r.def.source) }} />
                <strong>{channelName(r.def.source)}</strong>
                <span className="muted">{windowDef(r.def.window).label}</span>
              </div>
              {r.error ? (
                <div className="expr-msg error">{r.error}</div>
              ) : r.pending && !r.spec ? (
                <div className="expr-msg">Computing…</div>
              ) : (
                r.spec && (
                  <div className="spec-meta mono" title={metaTitle(r.spec)}>
                    {si(r.spec.samples, 'pts', 3)} · RBW {si(r.spec.rbw, 'Hz', 3)}
                    {r.spec.decimation > 1 && ` · ÷${r.spec.decimation}`}
                  </div>
                )
              )}
              {r.def.visible && !!peaks.get(r.def.id)?.length && (
                <table className="data-table compact peaks">
                  <tbody>
                    {peaks.get(r.def.id)!.map((pk, i) => (
                      <tr key={i} onContextMenu={(e) => r.spec && peakMenu(e, r as Shown, i)}>
                        <td className="muted">{i + 1}</td>
                        <td className="mono">{si(pk.freq, 'Hz', 5)}</td>
                        <td className="mono">{r.channel ? lvl(pk.rms, r.channel.wave.yUnit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {r.def.visible && r.spec && p.options.peaks > 0 && !peaks.get(r.def.id)?.length && (
                <div className="muted small">No peaks above the noise in view</div>
              )}
            </div>
          ))}
        </aside>
      </div>
    </section>
  )
})

function metaTitle(s: Spectrum): string {
  const lines = [
    `${s.samples.toLocaleString()} samples${s.decimation > 1 ? `, averaged in blocks of ${s.decimation} → ${s.used.toLocaleString()}` : ''}`,
    `FFT length ${s.n.toLocaleString()}${s.n > s.used ? ' (zero-padded)' : ''}`,
    `Sample rate ${si(s.sampleRate, 'S/s', 4)} → up to ${si(s.sampleRate / 2, 'Hz', 4)}`,
    `Bin spacing Δf ${si(s.df, 'Hz', 4)}`,
    `Resolution bandwidth (ENBW) ${si(s.rbw, 'Hz', 4)}`,
  ]
  return lines.join('\n')
}

/** Keep a frequency range inside the full span (shifting it rather than shrinking where possible) */
function clampRange(r: FreqRange, full: FreqRange, axis: FreqAxis): FreqRange {
  const toU = (f: number) => (axis === 'log' ? Math.log10(f) : f)
  const fromU = (u: number) => (axis === 'log' ? Math.pow(10, u) : u)
  let lo = toU(r.lo)
  let hi = toU(r.hi)
  const fLo = toU(full.lo)
  const fHi = toU(full.hi)
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return full
  if (hi - lo >= fHi - fLo) return full
  if (lo < fLo) {
    hi += fLo - lo
    lo = fLo
  }
  if (hi > fHi) {
    lo -= hi - fHi
    hi = fHi
  }
  return { lo: fromU(lo), hi: fromU(hi) }
}

/** Level range that shows the highest peak with some headroom down to below the noise floor (DC only counts if it is shown) */
function autoLevelRange(shown: Shown[], scale: SpectrumScale, withDc: boolean): FreqRange {
  if (!shown.length) return scale === 'db' ? { lo: -120, hi: 0 } : { lo: 0, hi: 1 }
  let max = 0
  const sample: number[] = []
  for (const r of shown) {
    const a = r.spec.rms
    for (let k = withDc ? 0 : 1; k < a.length; k++) if (a[k] > max) max = a[k]
    const stride = Math.max(1, Math.floor(a.length / 2000))
    for (let k = 1; k < a.length; k += stride) sample.push(a[k])
  }
  if (!(max > 0)) return scale === 'db' ? { lo: -120, hi: 0 } : { lo: 0, hi: 1 }
  if (scale === 'linear') {
    const step = niceStep((max * 1.05) / 8)
    return { lo: 0, hi: Math.ceil((max * 1.05) / step) * step }
  }
  sample.sort((x, y) => x - y)
  // Top: 10 dB steps with a little headroom; bottom: below the median (the noise floor), 60…140 dB in all
  const top = Math.ceil((toDb(max) + 3) / 10) * 10
  const floor = toDb(Math.max(sample[Math.floor(sample.length / 2)], max * 1e-12))
  const bottom = Math.floor((floor - 15) / 10) * 10
  return { lo: Math.min(top - 60, Math.max(top - 140, bottom)), hi: top }
}
