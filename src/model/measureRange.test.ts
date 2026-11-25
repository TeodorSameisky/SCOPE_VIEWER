import { describe, expect, it } from 'vitest'
import { rangeSamples, rangeWindow, samplesIn } from './measureRange'

// 11 samples at t = 1.0, 1.1, … 2.0
const w = { t0: 1, dt: 0.1, data: { length: 11 } }
const cursors = { a: 1.55, b: 1.25 }

describe('rangeWindow', () => {
  it('is the screen, the cursors in either order, or all of time', () => {
    const win = { start: 1.2, end: 1.8 }
    expect(rangeWindow('screen', win, cursors)).toBe(win)
    expect(rangeWindow('cursors', win, cursors)).toEqual({ start: 1.25, end: 1.55 })
    expect(rangeWindow('record', win, cursors)).toEqual({ start: -Infinity, end: Infinity })
  })
})

describe('samplesIn', () => {
  it('takes the samples within the window, both ends included', () => {
    // 1.3 … 1.6 → samples 3, 4, 5, 6
    expect(samplesIn(w, { start: 1.3, end: 1.6 })).toEqual([3, 7])
  })

  it('leaves out the samples just outside a window that falls between samples', () => {
    // 1.25 … 1.55 → samples 3, 4, 5 (not 2 at 1.2, not 6 at 1.6)
    expect(samplesIn(w, { start: 1.25, end: 1.55 })).toEqual([3, 6])
  })

  it('counts a time a rounding error away from a sample as that sample', () => {
    const t = 1 + 3 * 0.1 // 1.3000000000000003
    expect(samplesIn(w, { start: t, end: t })).toEqual([3, 4])
    expect(samplesIn(w, { start: 1.6 - 1e-15, end: 1.6 - 1e-15 })).toEqual([6, 7])
  })

  it('stays within the waveform', () => {
    expect(samplesIn(w, { start: -5, end: 50 })).toEqual([0, 11])
    expect(samplesIn(w, { start: -Infinity, end: Infinity })).toEqual([0, 11])
  })

  it('is empty for a window off the record or between two samples', () => {
    expect(samplesIn(w, { start: 3, end: 4 })).toEqual([11, 11])
    expect(samplesIn(w, { start: -4, end: -3 })).toEqual([0, 0])
    expect(samplesIn(w, { start: 1.31, end: 1.39 })).toEqual([4, 4])
  })
})

describe('rangeSamples', () => {
  it('takes the same samples for the cursors in either order', () => {
    const win = { start: 0, end: 10 }
    expect(rangeSamples(w, 'cursors', win, { a: 1.3, b: 1.6 })).toEqual(rangeSamples(w, 'cursors', win, { a: 1.6, b: 1.3 }))
  })

  it('takes the whole waveform for the record', () => {
    expect(rangeSamples(w, 'record', { start: 1.4, end: 1.5 }, cursors)).toEqual([0, 11])
  })
})
