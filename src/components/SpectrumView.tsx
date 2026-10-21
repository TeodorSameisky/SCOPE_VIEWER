import { forwardRef, useDeferredValue, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Eye, EyeOff, Maximize2, Plus, X } from 'lucide-react'
import { MIN_FFT_SAMPLES, WINDOW_DEFS, computeSpectrum, findPeaks, windowDef, type Peak, type Spectrum, type WindowKind } from '../math/fft'
import { MAX_SPECTRA, PEAK_COUNTS, levelUnit, type FreqAxis, type SpectrumDef, type SpectrumOptions, type SpectrumScale } from '../model/spectrum'
import type { Waveform } from '../model/types'
import { AXIS_GUTTER } from '../render/draw'
import { FREQ_AXIS_H, drawSpectrum, levelValue, readLevel, xToF, type FreqMap, type FreqRange } from '../render/spectrum'
import { niceStep, si } from '../util/format'
import { channelName } from '../util/names'
import type { CursorState, LiveChannel, TimeWindow } from './state'

interface Props {
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
}

interface Result {
  def: SpectrumDef
  channel?: LiveChannel
  spec?: Spectrum
  error?: string
}
type Shown = Result & { channel: LiveChannel; spec: Spectrum }

export interface SpectrumExport {
  scale: SpectrumScale
  /** Unit of the level values, e.g. dBV or V RMS */
  levelUnit: string
  items: { name: string; color: string; window: string; spec: Spectrum; peaks: Peak[] }[]
}

export interface SpectrumViewHandle {
  /** The spectrum plot with a caption line, at `scale` × the screen size */
  renderImage: (scale: number) => HTMLCanvasElement | null
  /** The visible spectra with their peaks (in the current frequency view) */
  getData: () => SpectrumExport
}

type Drag = { kind: 'pan'; x0: number; y0: number; f: FreqRange; y: FreqRange } | { kind: 'band'; x0: number; x1: number }

const MIN_BAND_PX = 5

/**
 * Frequency-domain view below the time views: the FFT of channels or math channels over the
 * visible time window, between the cursors or over the whole record, with a peak list.
 */
export const SpectrumView = forwardRef<SpectrumViewHandle, Props>(function SpectrumView(p, ref) {
  // Deferred so panning the time views stays smooth while the spectra follow
  const win = useDeferredValue(p.win)
  const cursors = useDeferredValue(p.cursors)
  const { range, scale, axis } = p.options

  // One cached spectrum per waveform and window: changing a colour or label recomputes nothing
  const [cache] = useState(() => new WeakMap<Waveform, Map<WindowKind, { key: string; spec?: Spectrum }>>())
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
        const key = `${i0}:${i1}`
        let perWave = cache.get(w)
        if (!perWave) cache.set(w, (perWave = new Map()))
        let hit = perWave.get(def.window)
        if (hit?.key !== key) {
          hit = { key, spec: computeSpectrum(w.data, i0, i1, w.dt, def.window) }
          perWave.set(def.window, hit)
        }
        if (!hit.spec) return { def, channel, error: `Fewer than ${MIN_FFT_SAMPLES} samples in the range` }
        return { def, channel, spec: hit.spec }
      }),
    [p.defs, p.channels, range, win, cursors, cache],
  )
  const shown = useMemo(() => results.filter((r): r is Shown => !!r.spec && r.def.visible), [results])
  const unit = shown[0]?.channel.wave.yUnit ?? p.channels.find((c) => c.wave.id === p.defs[0]?.source)?.wave.yUnit ?? 'V'

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
      })
    })
    return () => cancelAnimationFrame(id)
  }, [shown, peaks, size, axis, fr.lo, fr.hi, plotW, scale, yr, unit, hoverF, drag])

  useImperativeHandle(ref, () => ({
    renderImage: (k: number) => {
      if (!shown.length) return null
      const CAPTION = 20
      const out = document.createElement('canvas')
      out.width = Math.round(size.w * k)
      out.height = Math.round((size.h + CAPTION) * k)
      const ctx = out.getContext('2d')!
      ctx.setTransform(k, 0, 0, k, 0, 0)
      ctx.fillStyle = '#0b0e13'
      ctx.fillRect(0, 0, size.w, CAPTION)
      ctx.font = '600 12px system-ui, sans-serif'
      ctx.fillStyle = '#d7dce4'
      ctx.textBaseline = 'middle'
      let x = 8
      ctx.fillText('Spectrum', x, CAPTION / 2)
      x += ctx.measureText('Spectrum').width + 14
      ctx.font = '12px system-ui, sans-serif'
      for (const r of shown) {
        const label = `${channelName(r.def.source)} · ${windowDef(r.def.window).label}`
        ctx.fillStyle = r.channel.display.color
        ctx.fillRect(x, CAPTION / 2 - 4, 8, 8)
        ctx.fillStyle = '#b9c1cd'
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
      })
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(cv, 0, Math.round(CAPTION * k))
      return out
    },
    getData: () => ({
      scale,
      levelUnit: levelUnit(scale, unit),
      items: shown.map((r) => ({
        name: channelName(r.def.source),
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
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      const factor = Math.min(4, Math.max(0.25, Math.pow(1.0022, delta)))
      if (e.ctrlKey) zoomY(e.clientY - r.top, factor)
      else if (e.shiftKey) {
        const du = (toU(fr.hi) - toU(fr.lo)) * 0.1 * (delta > 0 ? 1 : -1)
        setF(fromU(toU(fr.lo) + du), fromU(toU(fr.hi) + du))
      } else zoomF(e.clientX - r.left, factor)
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

  // Drag the top edge to resize the panel
  const resize = useRef<{ y0: number; h0: number } | null>(null)
  const onResizeDown = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    resize.current = { y0: e.clientY, h0: p.height }
  }
  const onResizeMove = (e: React.PointerEvent) => {
    if (!resize.current) return
    p.setHeight(Math.round(Math.min(window.innerHeight * 0.65, Math.max(100, resize.current.h0 - (e.clientY - resize.current.y0)))))
  }

  const sources = p.channels.map((c) => c.wave.id)
  const colorOf = (id: string) => p.channels.find((c) => c.wave.id === id)?.display.color ?? '#888'
  const lvl = (rms: number) => (scale === 'db' ? `${levelValue('db', rms).toFixed(1)} ${levelUnit('db', unit)}` : si(rms, unit))
  const hoverLevels =
    hoverF === undefined || drag
      ? []
      : shown.flatMap((r) => {
          const x = hover!.x
          const v = readLevel(r.spec, hoverF, xToF(map, x - 0.5), xToF(map, x + 0.5))
          return v ? [{ r, v }] : []
        })

  return (
    <section className="spectrum" aria-label="Spectrum">
      <div
        className="resize-handle"
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={() => (resize.current = null)}
      />
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
            <option value="screen">On screen</option>
            <option value="cursors">Between cursors</option>
            <option value="record">Whole record</option>
          </select>
          <div className="segmented" title="Level scale">
            <button className={scale === 'db' ? 'active' : ''} onClick={() => p.setOptions({ scale: 'db' })}>
              {levelUnit('db', unit)}
            </button>
            <button className={scale === 'linear' ? 'active' : ''} onClick={() => p.setOptions({ scale: 'linear' })}>
              {levelUnit('linear', unit)}
            </button>
          </div>
          <div className="segmented" title="Frequency axis">
            <button className={axis === 'log' ? 'active' : ''} onClick={() => p.setOptions({ axis: 'log' })}>
              Log f
            </button>
            <button className={axis === 'linear' ? 'active' : ''} onClick={() => p.setOptions({ axis: 'linear' })}>
              Linear f
            </button>
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
          onPointerLeave={() => setHover(null)}
          onDoubleClick={resetZoom}
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
                  <span className="dot" style={{ background: r.channel.display.color }} />
                  {lvl(v.rms)}
                </div>
              ))}
            </div>
          )}
          {!shown.length && <div className="spec-empty">{results.find((r) => r.error)?.error ?? 'All spectra are hidden'}</div>}
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
                      <tr key={i}>
                        <td className="muted">{i + 1}</td>
                        <td className="mono">{si(pk.freq, 'Hz', 5)}</td>
                        <td className="mono">{lvl(pk.rms)}</td>
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
  const top = Math.ceil((20 * Math.log10(max) + 3) / 10) * 10
  const floor = 20 * Math.log10(Math.max(sample[Math.floor(sample.length / 2)], max * 1e-12))
  const bottom = Math.floor((floor - 15) / 10) * 10
  return { lo: Math.min(top - 60, Math.max(top - 140, bottom)), hi: top }
}
