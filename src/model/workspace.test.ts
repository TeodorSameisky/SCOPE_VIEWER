import { beforeEach, describe, expect, it } from 'vitest'
import type { Session } from './types'
import {
  analysisToJson,
  defaultWorkspace,
  deleteStoredSession,
  listStoredSessions,
  loadWorkspace,
  parseAnalysisJson,
  sanitizeWorkspace,
  saveWorkspace,
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
        measurements: { keys: ['rms', 'nope', 'rms'], range: 'galaxy' },
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
    expect(ws.measurements).toEqual({ keys: ['rms'], range: 'screen' })
    expect(ws.selected).toBe('CH2')
    expect(sanitizeWorkspace('garbage', session())).toEqual(defaultWorkspace(session()))
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
    for (let i = 1; i <= 5; i++) {
      const s = session(`fp${i}`, `f${i}.tss`)
      expect(saveWorkspace(s, defaultWorkspace(s)).ok).toBe(true)
    }
    const kept = listStoredSessions().map((x) => x.fingerprint)
    expect(kept).toContain('fp5')
    expect(kept.length).toBeLessThan(5)
    // a single workspace that can never fit reports an error instead of throwing
    ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage(100)
    const res = saveWorkspace(session(), defaultWorkspace(session()))
    expect(res).toEqual({ ok: false, error: 'Browser storage is full' })
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
