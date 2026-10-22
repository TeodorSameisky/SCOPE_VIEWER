import { measure, type MeasurementKey, type Measurements } from '../dsp/measure'
import { formatMeasurement } from '../dsp/measureDefs'
import { sampleAt } from '../math/signal'
import { si } from '../util/format'
import { channelName } from '../util/names'
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

// Measurements of region spans per waveform: a region is measured again only when it moves
const cache = new WeakMap<Waveform, Map<string, Measurements>>()

function measureSpan(w: Waveform, ta: number, tb: number): Measurements {
  const i0 = Math.max(0, Math.ceil((ta - w.t0) / w.dt - 1e-9))
  const i1 = Math.min(w.data.length, Math.floor((tb - w.t0) / w.dt + 1e-9) + 1)
  const key = `${i0}:${i1}`
  let perWave = cache.get(w)
  if (!perWave) cache.set(w, (perWave = new Map()))
  let m = perWave.get(key)
  if (!m) {
    m = measure(w.data, i0, i1, w.t0, w.dt)
    perWave.set(key, m)
    // Dragging a region measures many spans: keep only the latest
    if (perWave.size > 32) perWave.delete(perWave.keys().next().value!)
  }
  return m
}

/**
 * The value line of a callout, or undefined when it has none: a note with `showValue` shows the
 * value of its trace at the anchor (only the time when it is not on a trace), a region with
 * `measure` the measurements of that channel over its time span.
 */
export function calloutValueText(c: Callout, waves: Waveform[]): string | undefined {
  if (c.type === 'note' && c.showValue) {
    const t = `t = ${si(c.t, 's', 5)}`
    const w = c.channel ? waves.find((x) => x.id === c.channel) : undefined
    return w ? `${channelName(w.id)} = ${si(sampleAt(w.data, w.t0, w.dt, c.t), w.yUnit, 4)} at ${t}` : t
  }
  if (c.type === 'region' && c.measure?.keys.length) {
    const { channel, keys } = c.measure
    const w = waves.find((x) => x.id === channel)
    if (!w) return `${channelName(channel)}: no waveform`
    const t2 = c.t2 ?? c.t
    const m = measureSpan(w, Math.min(c.t, t2), Math.max(c.t, t2))
    return `${channelName(w.id)}: ${keys.map((k) => `${MEASURE_SHORT[k]} ${formatMeasurement(k, m[k], w.yUnit)}`).join(' · ')}`
  }
  return undefined
}
