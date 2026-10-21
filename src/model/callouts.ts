/**
 * User annotations on a session ("callouts", after the Tektronix feature of the same name).
 * Positions are stored in data coordinates (time, channel value) so callouts stay attached
 * to the waveform when zooming, panning or changing V/div.
 */
export type CalloutType = 'note' | 'marker' | 'region'

export interface Callout {
  id: string
  /** Running number shown when the callout has no text */
  n: number
  type: CalloutType
  /** Anchor time (s); start time for regions */
  t: number
  /** End time for regions (s) */
  t2?: number
  /** Note: channel whose trace the note points at */
  channel?: string
  /** Note not attached to a trace: view index and vertical position in divisions */
  view?: number
  div?: number
  /** Note: offset of the text box from the anchor (px) */
  dx?: number
  dy?: number
  text: string
  color: string
}

export const CALLOUT_COLORS = ['#ffd84d', '#ff9d2e', '#ff5a6a', '#8fd43a', '#3fb6ff', '#c86bff', '#e6e9ee']

export const DEFAULT_CALLOUT_COLOR: Record<CalloutType, string> = {
  note: '#ffd84d',
  marker: '#e6e9ee',
  region: '#3fb6ff',
}

export const CALLOUT_ICON: Record<CalloutType, string> = { note: '✎', marker: '⚑', region: '↔' }

export function calloutTitle(c: Callout): string {
  const first = c.text.split('\n')[0].trim()
  if (first) return first
  return `${c.type === 'note' ? 'Note' : c.type === 'marker' ? 'Marker' : 'Region'} ${c.n}`
}

export function newCalloutId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function nextCalloutNumber(list: Callout[]): number {
  return list.reduce((m, c) => Math.max(m, c.n), 0) + 1
}

// ---------- persistence (per browser, keyed by a hash of the session file) ----------

const STORAGE_PREFIX = 'scope-viewer:callouts:'

export function loadCallouts(fingerprint: string | undefined): Callout[] {
  if (!fingerprint) return []
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + fingerprint)
    return raw ? sanitize(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function saveCallouts(fingerprint: string | undefined, list: Callout[]): void {
  if (!fingerprint) return
  try {
    if (list.length) localStorage.setItem(STORAGE_PREFIX + fingerprint, JSON.stringify(list))
    else localStorage.removeItem(STORAGE_PREFIX + fingerprint)
  } catch {
    // storage full or unavailable (private mode): callouts then live only for this page view
  }
}

// ---------- file export / import ----------

interface CalloutFile {
  app: 'scope-viewer'
  kind: 'callouts'
  version: 1
  sessionFile: string
  fingerprint?: string
  callouts: Callout[]
}

export function calloutsToJson(sessionFile: string, fingerprint: string | undefined, list: Callout[]): string {
  const file: CalloutFile = { app: 'scope-viewer', kind: 'callouts', version: 1, sessionFile, fingerprint, callouts: list }
  return JSON.stringify(file, null, 2)
}

/** Parse an exported callout file. Returns the callouts and whether they were made for another file. */
export function parseCalloutJson(text: string, fingerprint: string | undefined): { callouts: Callout[]; otherFile: boolean } {
  const data = JSON.parse(text)
  const list = Array.isArray(data) ? data : data?.callouts
  if (!Array.isArray(list)) throw new Error('Not a callout file')
  const otherFile = !!(fingerprint && data?.fingerprint && data.fingerprint !== fingerprint)
  return { callouts: sanitize(list), otherFile }
}

function sanitize(list: unknown): Callout[] {
  if (!Array.isArray(list)) return []
  const out: Callout[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const c = item as Partial<Callout>
    if (c.type !== 'note' && c.type !== 'marker' && c.type !== 'region') continue
    if (typeof c.t !== 'number' || !Number.isFinite(c.t)) continue
    if (c.type === 'region' && (typeof c.t2 !== 'number' || !Number.isFinite(c.t2))) continue
    out.push({
      id: typeof c.id === 'string' ? c.id : newCalloutId(),
      n: typeof c.n === 'number' ? c.n : out.length + 1,
      type: c.type,
      t: c.t,
      t2: c.t2,
      channel: typeof c.channel === 'string' ? c.channel : undefined,
      view: typeof c.view === 'number' ? c.view : undefined,
      div: typeof c.div === 'number' ? c.div : undefined,
      dx: typeof c.dx === 'number' ? c.dx : undefined,
      dy: typeof c.dy === 'number' ? c.dy : undefined,
      text: typeof c.text === 'string' ? c.text.slice(0, 2000) : '',
      color: typeof c.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.color) ? c.color : DEFAULT_CALLOUT_COLOR[c.type],
    })
  }
  return out
}
