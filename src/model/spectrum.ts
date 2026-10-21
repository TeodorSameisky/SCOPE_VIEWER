import { DEFAULT_WINDOW, isWindowKind, type WindowKind } from '../math/fft'

/** An FFT spectrum of one channel or math channel; its colour follows the source. */
export interface SpectrumDef {
  id: string
  source: string
  window: WindowKind
  visible: boolean
}

/** Samples the spectra are computed from */
export type SpectrumRange = 'screen' | 'cursors' | 'record'
/** dB relative to 1 unit RMS (dBV), or linear RMS */
export type SpectrumScale = 'db' | 'linear'
export type FreqAxis = 'log' | 'linear'

/** Settings shared by all spectra of a session */
export interface SpectrumOptions {
  range: SpectrumRange
  scale: SpectrumScale
  axis: FreqAxis
  /** Peaks listed per spectrum (0 = off) */
  peaks: number
}

export const DEFAULT_SPECTRUM_OPTIONS: SpectrumOptions = { range: 'screen', scale: 'db', axis: 'log', peaks: 5 }
export const PEAK_COUNTS = [0, 3, 5, 10]
export const MAX_SPECTRA = 8

export function nextSpectrumId(defs: SpectrumDef[]): string {
  for (let n = 1; ; n++) {
    const id = `FFT${n}`
    if (!defs.some((d) => d.id === id)) return id
  }
}

export function newSpectrum(defs: SpectrumDef[], source: string): SpectrumDef {
  // A new spectrum uses the same window as the last one, so comparisons are like for like
  return { id: nextSpectrumId(defs), source, window: defs[defs.length - 1]?.window ?? DEFAULT_WINDOW, visible: true }
}

/** Unit of the level axis: dBV for volts, dB(A) for amps etc. */
export function levelUnit(scale: SpectrumScale, unit: string): string {
  if (scale === 'linear') return unit ? `${unit} RMS` : 'RMS'
  return unit === 'V' ? 'dBV' : unit ? `dB(${unit})` : 'dB'
}

// ---------- persistence per session file ----------

export interface StoredSpectra {
  defs: SpectrumDef[]
  options: SpectrumOptions
}

const PREFIX = 'scope-viewer:spectra:'

/** Validate what was stored (it may come from an older version or be edited by hand). */
export function parseStoredSpectra(raw: unknown): StoredSpectra {
  const empty = { defs: [], options: { ...DEFAULT_SPECTRUM_OPTIONS } }
  if (!raw || typeof raw !== 'object') return empty
  const r = raw as { defs?: unknown; options?: Partial<Record<keyof SpectrumOptions, unknown>> }
  const defs = (Array.isArray(r.defs) ? r.defs : [])
    .filter(
      (d): d is SpectrumDef =>
        d && typeof d.id === 'string' && /^FFT\d+$/.test(d.id) && typeof d.source === 'string' && isWindowKind(d.window) && typeof d.visible === 'boolean',
    )
    .slice(0, MAX_SPECTRA)
    .map((d) => ({ id: d.id, source: d.source, window: d.window, visible: d.visible }))
  const o = r.options ?? {}
  const options: SpectrumOptions = {
    range: o.range === 'screen' || o.range === 'cursors' || o.range === 'record' ? o.range : DEFAULT_SPECTRUM_OPTIONS.range,
    scale: o.scale === 'db' || o.scale === 'linear' ? o.scale : DEFAULT_SPECTRUM_OPTIONS.scale,
    axis: o.axis === 'log' || o.axis === 'linear' ? o.axis : DEFAULT_SPECTRUM_OPTIONS.axis,
    peaks: typeof o.peaks === 'number' && PEAK_COUNTS.includes(o.peaks) ? o.peaks : DEFAULT_SPECTRUM_OPTIONS.peaks,
  }
  return { defs, options }
}

export function loadSpectra(fingerprint: string | undefined): StoredSpectra {
  if (!fingerprint) return parseStoredSpectra(null)
  try {
    const raw = localStorage.getItem(PREFIX + fingerprint)
    return parseStoredSpectra(raw ? JSON.parse(raw) : null)
  } catch {
    return parseStoredSpectra(null)
  }
}
