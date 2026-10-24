import type { MeasurementKey } from '../dsp/measure'
import { MEASUREMENT_DEFS } from '../dsp/measureDefs'

/**
 * User annotations on a session ("callouts", after the Tektronix feature of the same name).
 * Positions are stored in data coordinates (time, channel value) so callouts stay attached
 * to the waveform when zooming, panning or changing V/div.
 *
 * A note points at a trace with a text, a marker marks a moment, a region a time span. A box
 * frames a time span and a range of values of one channel (an event such as a glitch); a span
 * measures the time from a point on one trace to a point on another (a delay).
 */
export type CalloutType = 'note' | 'marker' | 'region' | 'box' | 'span'

export const CALLOUT_TYPES: CalloutType[] = ['note', 'marker', 'region', 'box', 'span']

/** How a box is drawn */
export type BoxShape = 'rect' | 'ellipse'

export interface Callout {
  id: string
  /** Running number shown when the callout has no text */
  n: number
  type: CalloutType
  /** Anchor time (s); start time of regions, boxes and spans */
  t: number
  /** End time of regions, boxes and spans (s) */
  t2?: number
  /** Note: channel whose trace it points at. Box: channel whose values frame it. Span: channel of its start */
  channel?: string
  /** Span: channel of its end */
  channel2?: string
  /** Box on a channel: its two levels, in the unit of the channel */
  v?: number
  v2?: number
  /** Note or box not attached to a trace: view index and vertical position(s) in divisions */
  view?: number
  div?: number
  div2?: number
  /** Note: offset of the text box from the anchor (px). Span: distance of its dimension line below its lower end (px) */
  dx?: number
  dy?: number
  text: string
  color: string
  /** Note: also show the value of its trace (or the time) at the anchor. Span: also show Δv and 1/Δt */
  showValue?: boolean
  /** Region or box: measurements of a channel over its time span, shown in its label */
  measure?: RegionMeasure
  /** Box: a rectangle (default) or an ellipse */
  shape?: BoxShape
}

export interface RegionMeasure {
  channel: string
  keys: MeasurementKey[]
}

export const CALLOUT_COLORS = ['#ffd84d', '#ff9d2e', '#ff5a6a', '#8fd43a', '#3fb6ff', '#c86bff', '#e6e9ee']

export const DEFAULT_CALLOUT_COLOR: Record<CalloutType, string> = {
  note: '#ffd84d',
  marker: '#e6e9ee',
  region: '#3fb6ff',
  box: '#ff9d2e',
  span: '#c86bff',
}

export const CALLOUT_TYPE_LABEL: Record<CalloutType, string> = { note: 'Note', marker: 'Marker', region: 'Region', box: 'Box', span: 'Span' }

/** Type and running number, e.g. "Marker 3" */
export function calloutName(c: Callout): string {
  return `${CALLOUT_TYPE_LABEL[c.type]} ${c.n}`
}

/** The first line of the text, or the name when there is none */
export function calloutTitle(c: Callout): string {
  return c.text.split('\n')[0].trim() || calloutName(c)
}

/** Regions, boxes and spans cover a time span; notes and markers a moment */
export function hasTimeSpan(c: Pick<Callout, 'type'>): boolean {
  return c.type === 'region' || c.type === 'box' || c.type === 'span'
}

/** Time span of a callout: a point for notes and markers */
export function calloutSpan(c: Callout): [number, number] {
  const t2 = c.t2 ?? c.t
  return hasTimeSpan(c) ? [Math.min(c.t, t2), Math.max(c.t, t2)] : [c.t, c.t]
}

export function newCalloutId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function nextCalloutNumber(list: Callout[]): number {
  return list.reduce((m, c) => Math.max(m, c.n), 0) + 1
}

export function sanitizeCallouts(list: unknown): Callout[] {
  if (!Array.isArray(list)) return []
  const out: Callout[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const c = item as Partial<Callout>
    if (!c.type || !CALLOUT_TYPES.includes(c.type)) continue
    if (num(c.t) === undefined) continue
    if (hasTimeSpan(c as Callout) && num(c.t2) === undefined) continue
    const box = c.type === 'box'
    // A box is framed by two values of its channel, or two levels of its view; a span joins two channels
    const onChannel = typeof c.channel === 'string' && num(c.v) !== undefined && num(c.v2) !== undefined
    if (box && !onChannel && (num(c.view) === undefined || num(c.div) === undefined || num(c.div2) === undefined)) continue
    if (c.type === 'span' && (typeof c.channel !== 'string' || typeof c.channel2 !== 'string')) continue
    out.push({
      id: typeof c.id === 'string' ? c.id : newCalloutId(),
      n: typeof c.n === 'number' ? c.n : out.length + 1,
      type: c.type,
      t: c.t!,
      t2: num(c.t2),
      channel: typeof c.channel === 'string' ? c.channel : undefined,
      channel2: c.type === 'span' ? c.channel2 : undefined,
      v: box ? num(c.v) : undefined,
      v2: box ? num(c.v2) : undefined,
      view: num(c.view),
      div: num(c.div),
      div2: box ? num(c.div2) : undefined,
      dx: num(c.dx),
      dy: num(c.dy),
      text: typeof c.text === 'string' ? c.text.slice(0, 2000) : '',
      color: typeof c.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.color) ? c.color : DEFAULT_CALLOUT_COLOR[c.type],
      showValue: (c.type === 'note' || c.type === 'span') && c.showValue === true ? true : undefined,
      measure: c.type === 'region' || box ? sanitizeMeasure(c.measure) : undefined,
      shape: box && c.shape === 'ellipse' ? 'ellipse' : undefined,
    })
  }
  return out
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function sanitizeMeasure(m: unknown): RegionMeasure | undefined {
  if (!m || typeof m !== 'object') return undefined
  const { channel, keys } = m as Partial<RegionMeasure>
  if (typeof channel !== 'string' || !Array.isArray(keys)) return undefined
  // Known keys only, in the order of the measurement list
  return { channel, keys: MEASUREMENT_DEFS.map((d) => d.key).filter((k) => keys.includes(k)) }
}
