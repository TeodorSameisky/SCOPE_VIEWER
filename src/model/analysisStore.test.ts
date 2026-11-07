import { describe, expect, it, vi } from 'vitest'
import { AnalysisStore } from './analysisStore'
import { analysisOf, defaultWorkspace, type Analysis } from './workspace'
import type { Session } from './types'

const wave = (id: string) => ({ id, data: new Float32Array(10), t0: 0, dt: 1e-3, yUnit: 'V', xUnit: 's' })
const session: Session = {
  fileName: 'a.tss',
  fingerprint: 'fp',
  format: 'test',
  channels: [{ wave: wave('CH1'), display: { id: 'CH1', label: '', color: '#f2e32c', visible: true, scale: 1, position: 0, offset: 0 } }],
  views: [['CH1']],
}
const base = (): Analysis => analysisOf(defaultWorkspace(session))
const withNotes = (a: Analysis, notes: string): Analysis => ({ ...a, notes })

describe('AnalysisStore', () => {
  it('holds the analysis it starts with', () => {
    const a = base()
    const store = new AnalysisStore(a, 123)
    expect(store.get()).toBe(a)
    expect(store.changedAt).toBe(123)
  })

  it('applies a new analysis or a function of the current one, and tells the subscribers', () => {
    const store = new AnalysisStore(base())
    const seen: string[] = []
    store.subscribe(() => seen.push(store.get().notes))
    store.update(withNotes(store.get(), 'one'))
    store.update((a) => withNotes(a, `${a.notes} two`))
    expect(seen).toEqual(['one', 'one two'])
  })

  it('lets updates in a row build on each other', () => {
    const store = new AnalysisStore(base())
    store.update((a) => withNotes(a, 'a'))
    store.update((a) => withNotes(a, `${a.notes}b`))
    store.update((a) => withNotes(a, `${a.notes}c`))
    expect(store.get().notes).toBe('abc')
  })

  it('does not tell anyone about a change that is none', () => {
    const store = new AnalysisStore(base(), 5)
    const listener = vi.fn()
    store.subscribe(listener)
    store.update((a) => a)
    store.update(store.get())
    expect(listener).not.toHaveBeenCalled()
    expect(store.changedAt).toBe(5)
  })

  it('stops telling a subscriber that unsubscribed', () => {
    const store = new AnalysisStore(base())
    const listener = vi.fn()
    const stop = store.subscribe(listener)
    store.update((a) => withNotes(a, 'x'))
    stop()
    store.update((a) => withNotes(a, 'y'))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('dates each change, and later than the one before even within a millisecond', () => {
    let now = 1000
    const store = new AnalysisStore(base(), 0, () => now)
    store.update((a) => withNotes(a, 'a'))
    expect(store.changedAt).toBe(1000)
    store.update((a) => withNotes(a, 'b'))
    expect(store.changedAt).toBe(1001)
    now = 5000
    store.update((a) => withNotes(a, 'c'))
    expect(store.changedAt).toBe(5000)
  })

  it('gives a snapshot that stays the same object until something changes', () => {
    const store = new AnalysisStore(base())
    const first = store.get()
    expect(store.get()).toBe(first)
    store.update((a) => withNotes(a, 'x'))
    expect(store.get()).not.toBe(first)
    // the analysis before is untouched
    expect(first.notes).toBe('')
  })
})

describe('AnalysisStore.adopt (an analysis changed in another tab)', () => {
  it('takes a newer analysis and dates it as that tab did', () => {
    const store = new AnalysisStore(base(), 100)
    const listener = vi.fn()
    store.subscribe(listener)
    const other = withNotes(base(), 'from the other tab')
    expect(store.adopt(other, 200)).toBe(true)
    expect(store.get()).toBe(other)
    expect(store.changedAt).toBe(200)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ignores an analysis that is not newer', () => {
    const mine = withNotes(base(), 'mine')
    const store = new AnalysisStore(mine, 100)
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.adopt(withNotes(base(), 'older'), 100)).toBe(false)
    expect(store.adopt(withNotes(base(), 'older'), 50)).toBe(false)
    expect(store.get()).toBe(mine)
    expect(store.changedAt).toBe(100)
    expect(listener).not.toHaveBeenCalled()
  })

  it('only moves the date forward for a newer analysis with the same content', () => {
    const store = new AnalysisStore(withNotes(base(), 'same'), 100)
    const listener = vi.fn()
    store.subscribe(listener)
    const copy = JSON.parse(JSON.stringify(store.get())) as Analysis
    expect(store.adopt(copy, 300)).toBe(false)
    expect(store.changedAt).toBe(300)
    expect(listener).not.toHaveBeenCalled()
  })

  it('dates a change made afterwards later than the one adopted', () => {
    const store = new AnalysisStore(base(), 100, () => 150)
    store.adopt(withNotes(base(), 'x'), 900)
    store.update((a) => withNotes(a, 'mine'))
    expect(store.changedAt).toBe(901)
  })
})
