import type { Channel } from '../model/types'
import { valueAt } from '../render/draw'

/**
 * CSV of the given channels between tStart and tEnd at the time base of the
 * first channel (other channels are interpolated if their time base differs).
 */
export function buildCsv(channels: Channel[], tStart: number, tEnd: number): Blob {
  const ref = channels[0].wave
  const i0 = Math.max(0, Math.ceil((tStart - ref.t0) / ref.dt))
  const i1 = Math.min(ref.data.length - 1, Math.floor((tEnd - ref.t0) / ref.dt))
  const same = channels.map((c) => c.wave.t0 === ref.t0 && c.wave.dt === ref.dt && c.wave.data.length === ref.data.length)
  const header = ['Time (s)', ...channels.map((c) => `${c.wave.id}${c.display.label ? ` ${c.display.label}` : ''} (${c.wave.yUnit})`)]
  const parts: string[] = [header.map((h) => `"${h.replace(/"/g, '""')}"`).join(',') + '\n']
  const CHUNK = 20000
  for (let s = i0; s <= i1; s += CHUNK) {
    const lines: string[] = []
    for (let i = s; i <= Math.min(i1, s + CHUNK - 1); i++) {
      const t = ref.t0 + i * ref.dt
      let line = t.toExponential(9)
      for (let k = 0; k < channels.length; k++) {
        const v = same[k] ? channels[k].wave.data[i] : valueAt(channels[k].wave, t)
        line += ',' + (Number.isFinite(v) ? v.toPrecision(7) : '')
      }
      lines.push(line)
    }
    parts.push(lines.join('\n') + '\n')
  }
  return new Blob(parts, { type: 'text/csv' })
}
