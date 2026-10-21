/**
 * Automatic waveform measurements over a sample range, modelled on the
 * definitions used by Tektronix scopes (top/base from histogram modes,
 * 10%/50%/90% reference levels).
 */

export interface Measurements {
  min: number
  max: number
  pkpk: number
  mean: number
  rms: number
  top: number
  base: number
  amplitude: number
  /** Hz, NaN if fewer than two rising edges */
  frequency: number
  period: number
  /** 10-90 % of the first rising edge (s) */
  riseTime: number
  /** 90-10 % of the first falling edge (s) */
  fallTime: number
  /** Time above 50 % of the first full positive pulse (s) */
  posWidth: number
  /** Positive duty cycle in % */
  duty: number
  count: number
}

export type MeasurementKey = Exclude<keyof Measurements, 'count'>

export const MEASUREMENT_DEFS: { key: MeasurementKey; label: string; unit: 'y' | 's' | 'Hz' | '%' }[] = [
  { key: 'max', label: 'Maximum', unit: 'y' },
  { key: 'min', label: 'Minimum', unit: 'y' },
  { key: 'pkpk', label: 'Peak-to-peak', unit: 'y' },
  { key: 'mean', label: 'Mean', unit: 'y' },
  { key: 'rms', label: 'RMS', unit: 'y' },
  { key: 'top', label: 'Top', unit: 'y' },
  { key: 'base', label: 'Base', unit: 'y' },
  { key: 'amplitude', label: 'Amplitude', unit: 'y' },
  { key: 'frequency', label: 'Frequency', unit: 'Hz' },
  { key: 'period', label: 'Period', unit: 's' },
  { key: 'riseTime', label: 'Rise time', unit: 's' },
  { key: 'fallTime', label: 'Fall time', unit: 's' },
  { key: 'posWidth', label: 'Positive width', unit: 's' },
  { key: 'duty', label: 'Duty cycle', unit: '%' },
]

/** Time of the crossing of `level` between samples i-1 and i, linearly interpolated. */
function crossTime(data: Float32Array, i: number, level: number, t0: number, dt: number): number {
  const a = data[i - 1]
  const b = data[i]
  const frac = b === a ? 0 : (level - a) / (b - a)
  return t0 + (i - 1 + frac) * dt
}

export function measure(data: Float32Array, i0: number, i1: number, t0: number, dt: number): Measurements {
  i0 = Math.max(0, Math.floor(i0))
  i1 = Math.min(data.length, Math.ceil(i1))
  const n = i1 - i0
  const nan = NaN
  if (n <= 0) {
    return { min: nan, max: nan, pkpk: nan, mean: nan, rms: nan, top: nan, base: nan, amplitude: nan, frequency: nan, period: nan, riseTime: nan, fallTime: nan, posWidth: nan, duty: nan, count: 0 }
  }

  let min = Infinity
  let max = -Infinity
  let sum = 0
  let sum2 = 0
  for (let i = i0; i < i1; i++) {
    const v = data[i]
    if (v < min) min = v
    if (v > max) max = v
    sum += v
    sum2 += v * v
  }
  const mean = sum / n
  const rms = Math.sqrt(sum2 / n)
  const pkpk = max - min

  // Top/base: modes of the upper and lower half of a histogram; fall back to max/min.
  let top = max
  let base = min
  if (pkpk > 0) {
    const bins = 256
    const hist = new Uint32Array(bins)
    const k = (bins - 1) / pkpk
    for (let i = i0; i < i1; i++) hist[Math.round((data[i] - min) * k)]++
    const half = bins / 2
    let lo = 0
    let hi = half
    for (let b = 1; b < half; b++) if (hist[b] > hist[lo]) lo = b
    for (let b = half + 1; b < bins; b++) if (hist[b] > hist[hi]) hi = b
    // Only trust the modes if they hold a meaningful share of samples (bi-level signal)
    if (hist[lo] > n * 0.02) base = min + lo / k
    if (hist[hi] > n * 0.02) top = min + hi / k
  }
  const amplitude = top - base

  let frequency = nan
  let period = nan
  let riseTime = nan
  let fallTime = nan
  let posWidth = nan
  let duty = nan

  if (amplitude > 0) {
    const l10 = base + 0.1 * amplitude
    const l50 = base + 0.5 * amplitude
    const l90 = base + 0.9 * amplitude

    // Edges with hysteresis: an edge only counts once the signal has moved from
    // below 10 % to above 90 % (or back); its time is the last 50 % crossing.
    const rising: number[] = []
    const falling: number[] = []
    let state: 'unknown' | 'low' | 'high' = 'unknown'
    let t10 = nan
    let t50 = nan
    let t90 = nan
    for (let i = i0; i < i1; i++) {
      const v = data[i]
      if (state === 'unknown') {
        if (v <= l10) state = 'low'
        else if (v >= l90) state = 'high'
        continue
      }
      const p = data[i - 1]
      if (state === 'low') {
        if (p < l10 && v >= l10) t10 = crossTime(data, i, l10, t0, dt)
        if (p < l50 && v >= l50) t50 = crossTime(data, i, l50, t0, dt)
        if (v >= l90) {
          if (Number.isNaN(riseTime) && !Number.isNaN(t10)) riseTime = crossTime(data, i, l90, t0, dt) - t10
          if (!Number.isNaN(t50)) rising.push(t50)
          state = 'high'
          t90 = t50 = nan
        }
      } else {
        if (p > l90 && v <= l90) t90 = crossTime(data, i, l90, t0, dt)
        if (p > l50 && v <= l50) t50 = crossTime(data, i, l50, t0, dt)
        if (v <= l10) {
          if (Number.isNaN(fallTime) && !Number.isNaN(t90)) fallTime = crossTime(data, i, l10, t0, dt) - t90
          if (!Number.isNaN(t50)) falling.push(t50)
          state = 'low'
          t10 = t50 = nan
        }
      }
    }

    if (rising.length >= 2) {
      period = (rising[rising.length - 1] - rising[0]) / (rising.length - 1)
      frequency = 1 / period
    }
    const r0 = rising[0]
    const f0 = falling.find((t) => t > r0)
    if (r0 !== undefined && f0 !== undefined) {
      posWidth = f0 - r0
      if (!Number.isNaN(period)) duty = (posWidth / period) * 100
    }
  }

  return { min, max, pkpk, mean, rms, top, base, amplitude, frequency, period, riseTime, fallTime, posWidth, duty, count: n }
}
