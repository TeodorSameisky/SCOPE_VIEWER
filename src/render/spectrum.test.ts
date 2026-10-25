import { describe, expect, it } from 'vitest'
import { freqTicks, levelTicks } from './spectrum'

describe('spectrum axes', () => {
  it('lays out decades and 1-2-5 steps', () => {
    const log = freqTicks({ axis: 'log', lo: 10, hi: 1e5, width: 800 })
    expect(log.filter((t) => t.major).map((t) => t.f)).toEqual([10, 100, 1000, 1e4, 1e5])
    const level = levelTicks(-100, 0, 220)
    expect(level.step).toBe(10)
    expect(level.values).toHaveLength(11)
    expect([level.values[0], level.values[10]]).toEqual([-100, 0])
  })

  it('ends on empty or broken ranges', () => {
    expect(levelTicks(-20, -20, 200).values).toEqual([])
    expect(freqTicks({ axis: 'linear', lo: 5, hi: 5, width: 600 })).toEqual([])
    // No decades below 0 Hz: linear steps instead
    const fromZero = freqTicks({ axis: 'log', lo: 0, hi: 1e6, width: 600 })
    expect(fromZero.length).toBeGreaterThan(1)
    expect(fromZero.every((t) => t.f >= 0 && t.f <= 1e6)).toBe(true)
  })
})
