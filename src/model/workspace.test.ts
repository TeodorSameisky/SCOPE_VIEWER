import { beforeEach, describe, expect, it } from 'vitest'
import type { Session } from './types'
import {
  analysisOf,
  analysisToJson,
  defaultWorkspace,
  deleteStoredSession,
  listStoredSessions,
  loadWorkspace,
  parseAnalysisJson,
  sanitizeWorkspace,
  saveWorkspace,
  workspaceOf,
  WORKSPACE_FIELDS,
  WORKSPACE_MIGRATIONS,
  WORKSPACE_VERSION,
  type Workspace,
} from './workspace'

/** In-memory localStorage with an optional size limit (in characters) */
class MemoryStorage {
  data = new Map<string, string>()
  limit: number
  constructor(limit = Infinity) {
    this.limit = limit
  }
  get length() {
    return this.data.size
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string) {
    const used = [...this.data].reduce((n, [key, val]) => n + (key === k ? 0 : key.length + val.length), 0)
    if (used + k.length + v.length > this.limit) throw new DOMException('full', 'QuotaExceededError')
    this.data.set(k, v)
  }
  removeItem(k: string) {
    this.data.delete(k)
  }
  clear() {
    this.data.clear()
  }
}

const wave = (id: string) => ({ id, data: new Float32Array(100), t0: -1e-3, dt: 1e-5, yUnit: 'V', xUnit: 's' })
const display = (id: string, color: string) => ({ id, label: '', color, visible: true, scale: 1, position: 0, offset: 0 })

function session(fingerprint = 'fp1', fileName = 'a.tss'): Session {
  return {
    fileName,
    fingerprint,
    format: 'test',
    channels: [
      { wave: wave('CH1'), display: display('CH1', '#f2e32c') },
      { wave: wave('CH2'), display: display('CH2', '#22c8e6') },
    ],
    views: [['CH1'], ['CH2']],
    measurements: [{ type: 'PK2PK', source: 'CH1' }],
    trigger: { source: 'CH2', level: 1 },
  }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
})

describe('workspace defaults and validation', () => {
  it('starts from the scope settings', () => {
    const ws = defaultWorkspace(session())
    expect(ws.channels.map((c) => c.id)).toEqual(['CH1', 'CH2'])
    expect(ws.measurements.keys[0]).toBe('pkpk')
    expect(ws.selected).toBe('CH2')
    expect(ws.window.end - ws.window.start).toBeCloseTo(99e-5)
  })

  it('repairs broken or foreign data', () => {
    const ws = sanitizeWorkspace(
      {
        channels: [{ id: 'CH1', scale: -5, color: 'red', label: 'In' }, { id: 'CH9', scale: 2 }, { id: 'MATH1', scale: 0.5 }],
        views: [['CH9', 'CH2'], ['CH2'], 'junk'],
        math: [{ id: 'MATH1', expr: 'CH1 - CH2' }, { id: 'bad', expr: 'x' }],
        spectra: [{ id: 'FFT1', source: 'MATH1', window: 'hann', visible: true }, { id: 'FFT2', source: 'CH7', window: 'hann', visible: true }],
        cursors: { on: true, a: 'x', b: 2 },
        window: { start: 5, end: 1 },
        measurements: { keys: ['rms', 'nope', 'rms'], range: 'galaxy', exclude: ['CH2', 'CH2', 'CH9', 3] },
        selected: 'CH9',
      },
      session(),
    )
    expect(ws.channels.map((c) => c.id)).toEqual(['CH1', 'CH2', 'MATH1'])
    expect(ws.channels[0]).toMatchObject({ label: 'In', scale: 1, color: '#f2e32c' })
    expect(ws.channels[2].scale).toBe(0.5)
    // CH2 only once, CH1 back in the last view, MATH1 in its own view
    expect(ws.views).toEqual([['CH2', 'CH1'], ['MATH1']])
    expect(ws.spectra.map((s) => s.id)).toEqual(['FFT1'])
    expect(ws.cursors).toMatchObject({ on: true, b: 2 })
    expect(ws.window.end).toBeGreaterThan(ws.window.start)
    // channels left out of the table: known ones, each once
    expect(ws.measurements).toEqual({ keys: ['rms'], range: 'screen', exclude: ['CH2'] })
    expect(ws.selected).toBe('CH2')
    expect(sanitizeWorkspace('garbage', session())).toEqual(defaultWorkspace(session()))
  })

  it('keeps the view sizes only for the views they were set for', () => {
    expect(sanitizeWorkspace({ views: [['CH1'], ['CH2']], viewSizes: [3, 1] }, session()).viewSizes).toEqual([0.75, 0.25])
    expect(sanitizeWorkspace({ views: [['CH1', 'CH2']], viewSizes: [3, 1] }, session()).viewSizes).toBeUndefined()
    expect(sanitizeWorkspace({ views: [['CH1'], ['CH2']], viewSizes: [1, -1] }, session()).viewSizes).toBeUndefined()
    expect('viewSizes' in defaultWorkspace(session())).toBe(false)
  })

  it('keeps a stored time window within the zoom limits', () => {
    // Record -1 ms … -10 µs, 10 µs per sample: spans from 100 µs (10 samples) to 3.96 ms (4× the record)
    const win = (window: unknown) => sanitizeWorkspace({ window }, session()).window
    expect(win({ start: -8e-4, end: -2e-4 })).toEqual({ start: -8e-4, end: -2e-4 })
    const narrow = win({ start: -5e-4, end: -5e-4 + 1e-12 })
    expect(narrow.end - narrow.start).toBeCloseTo(1e-4, 12)
    expect((narrow.start + narrow.end) / 2).toBeCloseTo(-5e-4, 9)
    const wide = win({ start: -1, end: 1 })
    expect(wide.end - wide.start).toBeCloseTo(3.96e-3, 12)
    // Narrower than the precision of its times and far from the record: the file's view instead
    expect(win({ start: 1, end: 1 + 2 ** -52 })).toEqual(defaultWorkspace(session()).window)
  })
})

describe('autosave', () => {
  it('saves, lists and deletes sessions', () => {
    const s = session()
    const ws = { ...defaultWorkspace(s), selected: 'CH1' }
    expect(saveWorkspace(s, ws).ok).toBe(true)
    expect(loadWorkspace(s)).toMatchObject({ source: 'saved', workspace: { selected: 'CH1' } })
    expect(listStoredSessions()).toMatchObject([{ fingerprint: 'fp1', fileName: 'a.tss' }])
    deleteStoredSession('fp1')
    expect(loadWorkspace(s).source).toBe('default')
    expect(listStoredSessions()).toEqual([])
  })

  it('migrates data of the previous version and removes the old keys', () => {
    const s = session()
    localStorage.setItem('scope-viewer:callouts:fp1', JSON.stringify([{ id: 'c1', n: 1, type: 'marker', t: 0, text: 'trip', color: '#ffffff' }]))
    localStorage.setItem(
      'scope-viewer:math:fp1',
      JSON.stringify([{ def: { id: 'MATH1', expr: 'CH1 * 2' }, display: { label: '', color: '#ff6ec7', visible: true, scale: 2, position: 0, offset: 0 }, view: 9 }]),
    )
    const { workspace, source } = loadWorkspace(s)
    expect(source).toBe('migrated')
    expect(workspace.callouts[0].text).toBe('trip')
    expect(workspace.math[0].expr).toBe('CH1 * 2')
    expect(workspace.views).toEqual([['CH1'], ['CH2'], ['MATH1']])
    saveWorkspace(s, workspace)
    expect(localStorage.getItem('scope-viewer:callouts:fp1')).toBeNull()
    expect(localStorage.getItem('scope-viewer:math:fp1')).toBeNull()
  })

  it('makes room by dropping the oldest other sessions when storage is full', () => {
    // room for about three workspaces plus the index
    const one = JSON.stringify(defaultWorkspace(session())).length + 40
    ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage(one * 3 + 600)
    const removed: string[] = []
    for (let i = 1; i <= 5; i++) {
      const s = session(`fp${i}`, `f${i}.tss`)
      const res = saveWorkspace(s, defaultWorkspace(s))
      expect(res.ok).toBe(true)
      if (res.ok) removed.push(...(res.removed ?? []))
    }
    const kept = listStoredSessions().map((x) => x.fingerprint)
    expect(kept).toContain('fp5')
    expect(kept.length).toBeLessThan(5)
    // Each removed analysis is named, so the user can be told
    const gone = [1, 2, 3, 4, 5].filter((i) => !kept.includes(`fp${i}`)).map((i) => `f${i}.tss`)
    expect([...removed].sort()).toEqual(gone)
    // Saving again with room to spare removes nothing
    expect(saveWorkspace(session('fp5', 'f5.tss'), defaultWorkspace(session('fp5')))).not.toHaveProperty('removed')
    // a single workspace that can never fit reports an error instead of throwing
    ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage(100)
    const res = saveWorkspace(session(), defaultWorkspace(session()))
    expect(res).toEqual({ ok: false, error: 'Browser storage is full' })
  })

  it('never overwrites a newer analysis with an older one (two tabs)', () => {
    const s = session()
    const newer = { ...defaultWorkspace(s), notes: 'from the other tab' }
    expect(saveWorkspace(s, newer, 2000).ok).toBe(true)
    expect(loadWorkspace(s)).toMatchObject({ changedAt: 2000, workspace: { notes: 'from the other tab' } })
    // A tab that still shows the older analysis cannot save it over the newer one
    expect(saveWorkspace(s, defaultWorkspace(s), 1000)).toMatchObject({ ok: false, newer: true })
    expect(loadWorkspace(s).workspace.notes).toBe('from the other tab')
    // The same version (taken over, with another view) and later ones are saved
    expect(saveWorkspace(s, { ...newer, selected: 'CH1' }, 2000).ok).toBe(true)
    expect(saveWorkspace(s, { ...newer, notes: 'later' }, 3000).ok).toBe(true)
    expect(loadWorkspace(s)).toMatchObject({ changedAt: 3000, workspace: { notes: 'later' } })
  })
})

describe('analysis', () => {
  it('is the workspace without the view, and makes it again with any view', () => {
    const ws = { ...defaultWorkspace(session()), viewSizes: [0.6, 0.4], notes: 'n' }
    const analysis = analysisOf(ws)
    expect(analysis).not.toHaveProperty('version')
    expect(analysis).not.toHaveProperty('window')
    expect(analysis).not.toHaveProperty('selected')
    expect(analysis).toMatchObject({ viewSizes: [0.6, 0.4], notes: 'n' })
    expect(workspaceOf(analysis, ws.window, ws.selected)).toEqual(ws)
    expect(workspaceOf(analysis, { start: 0, end: 1 }, undefined)).toMatchObject({ window: { start: 0, end: 1 }, notes: 'n' })
  })
})

describe('analysis files', () => {
  it('round-trips a workspace', () => {
    const s = session()
    const ws = { ...defaultWorkspace(s), math: [{ id: 'MATH1', expr: 'CH1 + CH2' }] }
    const parsed = parseAnalysisJson(analysisToJson(s, ws))
    expect(parsed.kind).toBe('analysis')
    if (parsed.kind !== 'analysis') return
    expect(parsed.fingerprint).toBe('fp1')
    expect(sanitizeWorkspace(parsed.workspace, s).math).toEqual(ws.math)
  })

  it('reads callout files of the previous version', () => {
    const parsed = parseAnalysisJson(JSON.stringify({ app: 'scope-viewer', kind: 'callouts', callouts: [{ type: 'marker', t: 1 }] }))
    expect(parsed).toMatchObject({ kind: 'callouts', callouts: [{ type: 'marker', t: 1 }] })
  })

  it('rejects other files', () => {
    expect(() => parseAnalysisJson('{"hello":1}')).toThrow(/Not a Scope Viewer/)
    expect(() => parseAnalysisJson('nope')).toThrow(/not valid JSON/)
    expect(() => parseAnalysisJson(JSON.stringify({ kind: 'analysis', version: 99, workspace: {} }))).toThrow(/newer version/)
  })
})

describe('the saved format', () => {
  /** A workspace with every field set to something other than its default, as a user's could be */
  function full(): Workspace {
    return {
      version: WORKSPACE_VERSION,
      channels: [
        { id: 'CH1', label: 'Input', color: '#112233', visible: false, scale: 0.5, position: -1.5, offset: 0.25 },
        { id: 'CH2', label: 'Output', color: '#445566', visible: true, scale: 2, position: 1, offset: -0.5 },
        { id: 'MATH1', label: 'Sum', color: '#ff6ec7', visible: true, scale: 4, position: 0.5, offset: 0.1 },
      ],
      views: [['CH1', 'MATH1'], ['CH2']],
      viewSizes: [0.25, 0.75],
      math: [{ id: 'MATH1', expr: 'CH1 + CH2', unit: 'V' }],
      spectra: [{ id: 'FFT1', source: 'CH2', window: 'blackmanHarris', visible: false }],
      spectrumOptions: { range: 'cursors', scale: 'linear', axis: 'linear', peaks: 10 },
      callouts: [
        { id: 'n1', n: 1, type: 'note', t: -5e-4, channel: 'CH1', dx: 12, dy: -30, text: 'ringing', color: '#ff9d2e', showValue: true },
        { id: 'n2', n: 2, type: 'note', t: -4e-4, view: 1, div: 1.5, dx: 3, dy: 4, text: 'free note', color: '#ffd84d' },
        { id: 'm1', n: 3, type: 'marker', t: -3e-4, text: 'edge', color: '#ff5a6a' },
        { id: 'r1', n: 4, type: 'region', t: -4e-4, t2: -2e-4, text: 'burst', color: '#3fb6ff', measure: { channel: 'CH2', keys: ['max', 'rms'] } },
        { id: 'b1', n: 5, type: 'box', t: -4e-4, t2: -3e-4, channel: 'CH2', v: -1, v2: 2, text: 'glitch', color: '#ff9d2e', shape: 'ellipse', measure: { channel: 'CH2', keys: ['pkpk'] } },
        { id: 'b2', n: 6, type: 'box', t: -4e-4, t2: -3e-4, view: 0, div: -1, div2: 2, text: '', color: '#ff9d2e' },
        { id: 's1', n: 7, type: 'span', t: -4e-4, t2: -2e-4, channel: 'CH1', channel2: 'CH2', dy: 20, text: 'delay', color: '#c86bff', showValue: true },
      ],
      cursors: { on: true, a: -4e-4, b: -2e-4, source: 'CH2' },
      window: { start: -5e-4, end: -2e-4 },
      measurements: { keys: ['rms', 'max'], range: 'cursors', exclude: ['CH2'] },
      selected: 'MATH1',
      notes: 'Event at 3 ms',
    }
  }

  it('is listed field by field, and the example below has each of them', () => {
    expect(Object.keys(full()).sort()).toEqual(Object.keys(WORKSPACE_FIELDS).sort())
  })

  it('keeps everything through saving and loading, so a field cannot be forgotten in the validation', () => {
    const s = session()
    const ws = full()
    expect(sanitizeWorkspace(JSON.parse(JSON.stringify(ws)), s)).toEqual(ws)
    expect(saveWorkspace(s, ws).ok).toBe(true)
    expect(loadWorkspace(s)).toMatchObject({ source: 'saved', workspace: ws })
    const parsed = parseAnalysisJson(analysisToJson(s, ws))
    expect(parsed.kind === 'analysis' && sanitizeWorkspace(parsed.workspace, s)).toEqual(ws)
  })

  it('has a migration step from every earlier version', () => {
    for (let v = 1; v < WORKSPACE_VERSION; v++) expect(WORKSPACE_MIGRATIONS[v], `from version ${v}`).toBeTypeOf('function')
    expect(Object.keys(WORKSPACE_MIGRATIONS).map(Number).every((v) => v >= 1 && v < WORKSPACE_VERSION)).toBe(true)
  })

  it('reads data written before the version was stored as the first version', () => {
    const { version: _version, ...old } = full()
    expect(sanitizeWorkspace(old, session())).toEqual(full())
  })

  it('refuses analysis files of a newer version, whether the file or its workspace says so', () => {
    const newer = (file: object, workspace: object) => () => parseAnalysisJson(JSON.stringify({ kind: 'analysis', workspace, ...file }))
    expect(newer({ version: WORKSPACE_VERSION + 1 }, {})).toThrow(/newer version/)
    expect(newer({ version: WORKSPACE_VERSION }, { version: WORKSPACE_VERSION + 1 })).toThrow(/newer version/)
    expect(newer({ version: WORKSPACE_VERSION }, { version: WORKSPACE_VERSION })).not.toThrow()
    expect(newer({}, {})).not.toThrow()
  })
})

describe('math ids', () => {
  it('never reuse the id of a channel in the file', async () => {
    const { nextMathId } = await import('./math')
    expect(nextMathId([], ['CH1', 'MATH1'])).toBe('MATH2')
    const s = session()
    s.channels.push({ wave: wave('MATH1'), display: display('MATH1', '#ffffff') })
    s.views.push(['MATH1'])
    const ws = sanitizeWorkspace({ math: [{ id: 'MATH1', expr: 'CH1 * 2' }, { id: 'MATH2', expr: 'CH2' }] }, s)
    expect(ws.math.map((m) => m.id)).toEqual(['MATH2'])
    expect(ws.channels.filter((c) => c.id === 'MATH1')).toHaveLength(1)
  })
})
