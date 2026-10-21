import type { CursorState, MeasureRange, TimeWindow } from '../components/state'
import type { MeasurementKey } from '../dsp/measure'
import { MEASUREMENT_DEFS } from '../dsp/measureDefs'
import { loadCallouts, sanitizeCallouts, type Callout } from './callouts'
import { loadMath, type MathDef } from './math'
import { DEFAULT_SPECTRUM_OPTIONS, loadSpectra, parseStoredSpectra, type SpectrumDef, type SpectrumOptions } from './spectrum'
import type { ChannelDisplay, Session } from './types'

/**
 * Everything the user changes about a session: channel settings and layout, math
 * channels, spectra, callouts, cursors, the time window and the measurement selection.
 * It is autosaved per session file and can be written to / read from an analysis file.
 */
export interface Workspace {
  version: typeof WORKSPACE_VERSION
  channels: ChannelDisplay[]
  views: string[][]
  math: MathDef[]
  spectra: SpectrumDef[]
  spectrumOptions: SpectrumOptions
  callouts: Callout[]
  cursors: CursorState
  window: TimeWindow
  measurements: { keys: MeasurementKey[]; range: MeasureRange }
  selected?: string
  /** Free-text notes about the session (e.g. what the event is), used in reports */
  notes: string
}

export const WORKSPACE_VERSION = 1

// ---------- defaults from the session file ----------

/** Tektronix measurement types in the setup → our measurement keys */
const TEK_MEAS: Record<string, MeasurementKey> = {
  MAXIMUM: 'max',
  MINIMUM: 'min',
  PK2PK: 'pkpk',
  MEAN: 'mean',
  RMS: 'rms',
  TOP: 'top',
  BASE: 'base',
  AMPLITUDE: 'amplitude',
  FREQUENCY: 'frequency',
  PERIOD: 'period',
  RISETIME: 'riseTime',
  FALLTIME: 'fallTime',
  PWIDTH: 'posWidth',
  PDUTY: 'duty',
}
const DEFAULT_MEAS: MeasurementKey[] = ['max', 'min', 'pkpk', 'mean', 'rms', 'frequency', 'riseTime', 'fallTime']

/** Time span covered by the record */
export function recordWindow(session: Session): TimeWindow {
  let start = Infinity
  let end = -Infinity
  for (const { wave } of session.channels) {
    start = Math.min(start, wave.t0)
    end = Math.max(end, wave.t0 + (wave.data.length - 1) * wave.dt)
  }
  return { start, end }
}

/** The time window the scope showed when the session was saved (or the whole record) */
export function scopeWindow(session: Session): TimeWindow {
  const record = recordWindow(session)
  const h = session.horizontal
  if (h) {
    const span = h.scale * 10
    const start = (-h.position / 100) * span
    if (start < record.end && start + span > record.start) return { start, end: start + span }
  }
  return record
}

/** The state of a freshly opened file: everything as set on the scope */
export function defaultWorkspace(session: Session): Workspace {
  const win = scopeWindow(session)
  const span = win.end - win.start
  const c = session.cursors
  const firstId = session.channels[0]?.wave.id ?? ''
  const fromSetup = (session.measurements ?? []).map((m) => TEK_MEAS[m.type]).filter(Boolean)
  return {
    version: WORKSPACE_VERSION,
    channels: session.channels.map((ch) => ({ ...ch.display })),
    views: session.views.map((v) => [...v]),
    math: [],
    spectra: [],
    spectrumOptions: { ...DEFAULT_SPECTRUM_OPTIONS },
    callouts: [],
    cursors: {
      on: !!c,
      a: c?.a ?? win.start + span * 0.3,
      b: c?.b ?? win.start + span * 0.7,
      source: c?.source && session.channels.some((ch) => ch.wave.id === c.source) ? c.source : firstId,
    },
    window: win,
    measurements: { keys: [...new Set([...fromSetup, ...DEFAULT_MEAS])], range: 'screen' },
    selected: session.trigger?.source ?? firstId,
    notes: '',
  }
}

// ---------- validation ----------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)
const MATH_ID = /^MATH\d+$/

/**
 * Check a workspace that comes from storage or a file against the open session.
 * Unknown or broken parts fall back to the file defaults, so a bad file can never
 * break the viewer.
 */
export function sanitizeWorkspace(raw: unknown, session: Session): Workspace {
  const def = defaultWorkspace(session)
  if (!raw || typeof raw !== 'object') return def
  const r = raw as Partial<Record<keyof Workspace, unknown>>

  const math: MathDef[] = (Array.isArray(r.math) ? r.math : [])
    .filter((m): m is MathDef => !!m && typeof m.id === 'string' && MATH_ID.test(m.id) && typeof m.expr === 'string')
    .map((m) => ({ id: m.id, expr: m.expr.slice(0, 2000), ...(typeof m.unit === 'string' && m.unit ? { unit: m.unit.slice(0, 20) } : {}) }))
    .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
  const ids = [...session.channels.map((c) => c.wave.id), ...math.map((m) => m.id)]

  // Channel settings: every channel gets one; stored values override the defaults field by field
  const stored = new Map<string, Partial<ChannelDisplay>>()
  for (const d of Array.isArray(r.channels) ? r.channels : []) if (d && typeof d.id === 'string') stored.set(d.id, d)
  const channels: ChannelDisplay[] = ids.map((id) => {
    const base = def.channels.find((d) => d.id === id) ?? { id, label: '', color: '#ff6ec7', visible: true, scale: 1, position: 0, offset: 0 }
    const s = stored.get(id) ?? {}
    return {
      id,
      label: typeof s.label === 'string' ? s.label.slice(0, 100) : base.label,
      color: isColor(s.color) ? s.color : base.color,
      visible: typeof s.visible === 'boolean' ? s.visible : base.visible,
      scale: isNum(s.scale) && s.scale > 0 ? s.scale : base.scale,
      position: isNum(s.position) ? s.position : base.position,
      offset: isNum(s.offset) ? s.offset : base.offset,
    }
  })

  // Views: known ids only, each id once
  const seen = new Set<string>()
  let views: string[][] = []
  for (const v of Array.isArray(r.views) ? r.views : []) {
    const ok = (Array.isArray(v) ? v : []).filter((id): id is string => typeof id === 'string' && ids.includes(id) && !seen.has(id))
    ok.forEach((id) => seen.add(id))
    if (ok.length) views.push(ok)
  }
  if (!views.length) {
    views = def.views.map((v) => [...v])
    views.flat().forEach((id) => seen.add(id))
  }
  // Channels missing from every view: inputs join the last view, math channels get their own
  for (const id of ids) {
    if (seen.has(id)) continue
    if (MATH_ID.test(id) || !views.length) views.push([id])
    else views[views.length - 1].push(id)
  }

  const spec = parseStoredSpectra({ defs: r.spectra, options: r.spectrumOptions })
  const spectra = spec.defs.filter((d) => ids.includes(d.source))

  const cur = (r.cursors ?? {}) as Partial<CursorState>
  const cursors: CursorState = {
    on: typeof cur.on === 'boolean' ? cur.on : def.cursors.on,
    a: isNum(cur.a) ? cur.a : def.cursors.a,
    b: isNum(cur.b) ? cur.b : def.cursors.b,
    source: typeof cur.source === 'string' && ids.includes(cur.source) ? cur.source : def.cursors.source,
  }

  const w = (r.window ?? {}) as Partial<TimeWindow>
  const window = isNum(w.start) && isNum(w.end) && w.end > w.start ? { start: w.start, end: w.end } : def.window

  const m = (r.measurements ?? {}) as { keys?: unknown; range?: unknown }
  const known = new Set(MEASUREMENT_DEFS.map((d) => d.key))
  const keys = Array.isArray(m.keys) ? [...new Set(m.keys.filter((k): k is MeasurementKey => known.has(k)))] : def.measurements.keys
  const range = m.range === 'screen' || m.range === 'cursors' || m.range === 'record' ? m.range : def.measurements.range

  return {
    version: WORKSPACE_VERSION,
    channels,
    views,
    math,
    spectra,
    spectrumOptions: spec.options,
    callouts: sanitizeCallouts(r.callouts),
    cursors,
    window,
    measurements: { keys, range },
    selected: typeof r.selected === 'string' && ids.includes(r.selected) ? r.selected : def.selected,
    notes: typeof r.notes === 'string' ? r.notes.slice(0, 20000) : '',
  }
}

// ---------- autosave in the browser ----------

const WS_PREFIX = 'scope-viewer:ws:'
const INDEX_KEY = 'scope-viewer:index'
const LEGACY_PREFIXES = ['scope-viewer:callouts:', 'scope-viewer:math:', 'scope-viewer:spectra:']
/** Sessions kept in the browser; the least recently saved ones are removed beyond that */
export const MAX_STORED_SESSIONS = 50

export interface StoredSessionInfo {
  fingerprint: string
  fileName: string
  savedAt: string
  bytes: number
}

function readIndex(): Record<string, Omit<StoredSessionInfo, 'fingerprint'>> {
  try {
    const raw = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    return {}
  }
}

function writeIndex(index: Record<string, Omit<StoredSessionInfo, 'fingerprint'>>): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index))
}

/** Sessions saved in this browser, most recent first */
export function listStoredSessions(): StoredSessionInfo[] {
  return Object.entries(readIndex())
    .map(([fingerprint, v]) => ({ fingerprint, ...v }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export function deleteStoredSession(fingerprint: string): void {
  try {
    localStorage.removeItem(WS_PREFIX + fingerprint)
    for (const p of LEGACY_PREFIXES) localStorage.removeItem(p + fingerprint)
    const index = readIndex()
    delete index[fingerprint]
    writeIndex(index)
  } catch {
    // storage unavailable
  }
}

export type LoadSource = 'saved' | 'migrated' | 'default'

/** Saved state of a session file (or the file defaults), migrating data of older versions. */
export function loadWorkspace(session: Session): { workspace: Workspace; source: LoadSource } {
  const fp = session.fingerprint
  if (!fp) return { workspace: defaultWorkspace(session), source: 'default' }
  try {
    const raw = localStorage.getItem(WS_PREFIX + fp)
    if (raw) return { workspace: sanitizeWorkspace(JSON.parse(raw), session), source: 'saved' }
  } catch {
    // fall through to legacy / defaults
  }
  // Earlier versions stored callouts, math channels and spectra separately
  const callouts = loadCallouts(fp)
  const math = loadMath(fp)
  const spectra = loadSpectra(fp)
  if (!callouts.length && !math.length && !spectra.defs.length) return { workspace: defaultWorkspace(session), source: 'default' }
  const def = defaultWorkspace(session)
  const views = def.views.map((v) => [...v])
  for (const m of math) {
    if (m.view >= 0 && m.view < views.length) views[m.view].push(m.def.id)
    else views.push([m.def.id])
  }
  const migrated = sanitizeWorkspace(
    {
      ...def,
      channels: [...def.channels, ...math.map((m) => ({ ...m.display, id: m.def.id }))],
      views,
      math: math.map((m) => m.def),
      spectra: spectra.defs,
      spectrumOptions: spectra.options,
      callouts,
    },
    session,
  )
  return { workspace: migrated, source: 'migrated' }
}

export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string }

/**
 * Save a session's workspace. When storage is full the least recently saved other
 * sessions are removed until it fits.
 */
export function saveWorkspace(session: Session, ws: Workspace): SaveResult {
  const fp = session.fingerprint
  if (!fp) return { ok: false, error: 'The file could not be identified, so changes cannot be remembered' }
  const json = JSON.stringify(ws)
  const savedAt = new Date().toISOString()
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        localStorage.setItem(WS_PREFIX + fp, json)
        break
      } catch (e) {
        const others = listStoredSessions().filter((s) => s.fingerprint !== fp)
        if (!isQuotaError(e) || !others.length || attempt > 100) throw e
        deleteStoredSession(others[others.length - 1].fingerprint)
      }
    }
    for (const p of LEGACY_PREFIXES) localStorage.removeItem(p + fp)
    const index = readIndex()
    index[fp] = { fileName: session.fileName, savedAt, bytes: json.length * 2 }
    // Keep the number of remembered sessions bounded
    const sorted = Object.entries(index).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt))
    for (const [old] of sorted.slice(MAX_STORED_SESSIONS)) {
      localStorage.removeItem(WS_PREFIX + old)
      delete index[old]
    }
    writeIndex(index)
    return { ok: true, savedAt }
  } catch (e) {
    return { ok: false, error: isQuotaError(e) ? 'Browser storage is full' : 'Browser storage is not available (private mode?)' }
  }
}

function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22)
}

// ---------- analysis files ----------

export const ANALYSIS_EXT = '.scopeview.json'
export const BUNDLE_EXT = '.scopeview'

export interface AnalysisFile {
  app: 'scope-viewer'
  kind: 'analysis'
  version: typeof WORKSPACE_VERSION
  savedAt: string
  sessionFile: string
  fingerprint?: string
  workspace: Workspace
}

export function analysisToJson(session: Session, ws: Workspace): string {
  const file: AnalysisFile = {
    app: 'scope-viewer',
    kind: 'analysis',
    version: WORKSPACE_VERSION,
    savedAt: new Date().toISOString(),
    sessionFile: session.fileName,
    fingerprint: session.fingerprint,
    workspace: ws,
  }
  return JSON.stringify(file, null, 2)
}

export type ParsedAnalysis =
  | { kind: 'analysis'; workspace: unknown; sessionFile?: string; fingerprint?: string }
  | { kind: 'callouts'; callouts: Callout[]; fingerprint?: string }

/** Read an analysis file (or a callout file of an earlier version). Validation against the session happens when it is applied. */
export function parseAnalysisJson(text: string): ParsedAnalysis {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON')
  }
  const d = data as Omit<Partial<AnalysisFile>, 'kind'> & { kind?: string; callouts?: unknown }
  if (d && d.kind === 'analysis' && d.workspace && typeof d.workspace === 'object') {
    if (typeof d.version === 'number' && d.version > WORKSPACE_VERSION) throw new Error('This analysis file was made by a newer version of Scope Viewer')
    return { kind: 'analysis', workspace: d.workspace, sessionFile: d.sessionFile, fingerprint: d.fingerprint }
  }
  if (Array.isArray(data) || (d && (d.kind === 'callouts' || Array.isArray(d.callouts)))) {
    return { kind: 'callouts', callouts: sanitizeCallouts(Array.isArray(data) ? data : d.callouts), fingerprint: typeof d?.fingerprint === 'string' ? d.fingerprint : undefined }
  }
  throw new Error('Not a Scope Viewer analysis file')
}
