import type { Session } from '../model/types'
import { si } from './format'

/** Display names for channel ids: CH1 → "Ch 1", MATH2 → "Math 2" */
export function channelName(id: string): string {
  const m = /^(CH|MATH|REF)(\d+)$/i.exec(id)
  if (!m) return id
  const kind = m[1].toUpperCase()
  return `${kind === 'CH' ? 'Ch' : kind === 'MATH' ? 'Math' : 'Ref'} ${m[2]}`
}

/** Short tag used on the plot: CH1 → "C1", MATH2 → "M2" */
export function channelTag(id: string): string {
  return id.replace(/^CH/i, 'C').replace(/^MATH/i, 'M').replace(/^REF/i, 'R')
}

/** Arrow for a trigger slope as stored in the setup (RISE / FALL / EITHER, possibly shortened) */
export function slopeSymbol(slope: string | undefined): string {
  if (!slope) return ''
  if (/^RIS/i.test(slope)) return '↗'
  if (/^FALL/i.test(slope)) return '↘'
  if (/^EITH/i.test(slope)) return '↕'
  return slope.toLowerCase()
}

/** Unit of the channel a trigger (or cursor) source refers to; V for sources without a waveform (AUX, LINE) */
export function sourceUnit(channels: Session['channels'], source: string | undefined): string {
  return channels.find((c) => c.wave.id === source)?.wave.yUnit || 'V'
}

/** The trigger as the scope shows it, e.g. "Ch 1 ↗ 1.20 V"; empty without a trigger */
export function triggerText(session: Pick<Session, 'trigger' | 'channels'>, digits = 3): string {
  const t = session.trigger
  if (!t) return ''
  const level = t.level !== undefined ? si(t.level, sourceUnit(session.channels, t.source), digits) : ''
  return [channelName(t.source), slopeSymbol(t.slope), level].filter(Boolean).join(' ')
}
