import { measure, type MeasurementKey, type Measurements } from '../dsp/measure'
import { formatMeasurement } from '../dsp/measureDefs'
import { sampleAt } from '../math/signal'
import { si } from '../util/format'
import { channelName } from '../util/names'
import { SampleCache } from '../util/sampleCache'
import type { Callout } from './callouts'
import type { Waveform } from './types'

/** Short names of the measurements in region labels */
export const MEASURE_SHORT: Record<MeasurementKey, string> = {
  max: 'max',
  min: 'min',
  pkpk: 'pk-pk',
  mean: 'mean',
  rms: 'rms',
  top: 'top',
  base: 'base',
  amplitude: 'ampl',
  frequency: 'freq',
  period: 'period',
  riseTime: 'rise',
  fallTime: 'fall',
  posWidth: '+width',
  duty: 'duty',
}

/** What a region measures when a channel is chosen for it */
export const DEFAULT_REGION_KEYS: MeasurementKey[] = ['pkpk', 'mean']

/**
 * Measurements of the samples [i0, i1) of a waveform for the region or box `id`, or undefined
 * while they are being measured (on screen, long spans are measured in the compute worker)
 */
export type SpanMeasure = (w: Waveform, i0: number, i1: number, id: string) => Measurements | undefined

// Measurements of region spans per sample array: a region is measured again only when it moves.
// Dragging a region measures many spans: only the latest are kept
const cache = new SampleCache<Measurements>(32)

/** Measured at once, for exports, which cannot wait */
export const measureNow: SpanMeasure = (w, i0, i1, id) => cache.get(w.data, `${w.t0}:${w.dt}:${i0}:${i1}`, () => measure(w.data, i0, i1, w.t0, w.dt), id)

/**
 * The value line of a callout, or undefined when it has none: a note with `showValue` shows the
 * value of its trace at the anchor (only the time when it is not on a trace), a region or box with
 * `measure` the measurements of that channel over its time span (by `measureSpan`), a span with
 * `showValue` Δv between its ends (when both channels have the same unit) and 1/Δt.
 */
export function calloutValueText(c: Callout, waves: Waveform[], measureSpan: SpanMeasure = measureNow): string | undefined {
  if (c.type === 'note' && c.showValue) {
    const t = `t = ${si(c.t, 's', 5)}`
    const w = c.channel ? waves.find((x) => x.id === c.channel) : undefined
    return w ? `${channelName(w.id)} = ${si(sampleAt(w.data, w.t0, w.dt, c.t), w.yUnit, 4)} at ${t}` : t
  }
  if (c.type === 'span' && c.showValue) {
    const t2 = c.t2 ?? c.t
    const a = waves.find((x) => x.id === c.channel)
    const b = waves.find((x) => x.id === c.channel2)
    const parts = [`1/Δt ${si(1 / Math.abs(t2 - c.t), 'Hz')}`]
    if (a && b && a.yUnit === b.yUnit) parts.unshift(`Δv ${si(sampleAt(b.data, b.t0, b.dt, t2) - sampleAt(a.data, a.t0, a.dt, c.t), a.yUnit, 4)}`)
    return parts.join(' · ')
  }
  if ((c.type === 'region' || c.type === 'box') && c.measure?.keys.length) {
    const { channel, keys } = c.measure
    const w = waves.find((x) => x.id === channel)
    if (!w) return `${channelName(channel)}: no waveform`
    const t2 = c.t2 ?? c.t
    // The samples inside its time span
    const i0 = Math.max(0, Math.ceil((Math.min(c.t, t2) - w.t0) / w.dt - 1e-9))
    const i1 = Math.min(w.data.length, Math.floor((Math.max(c.t, t2) - w.t0) / w.dt + 1e-9) + 1)
    const m = measureSpan(w, i0, i1, c.id)
    if (!m) return `${channelName(w.id)}: measuring…`
    return `${channelName(w.id)}: ${keys.map((k) => `${MEASURE_SHORT[k]} ${formatMeasurement(k, m[k], w.yUnit)}`).join(' · ')}`
  }
  return undefined
}
