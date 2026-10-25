import { describe, expect, it } from 'vitest'
import { niceStep, parseTime, si, siTick, ticksBetween } from './format'
import { snapToGrid, stepScale, timeTicks } from '../model/view'

describe('format', () => {
  it('formats SI values', () => {
    expect(si(-25.7517e-6, 's')).toBe('-25.75 µs')
    expect(si(179.77, 'Hz')).toBe('179.8 Hz')
    expect(si(0.000781, 'V')).toBe('781.0 µV')
  })

  it('shows enough tick decimals to separate neighbours', () => {
    const ticks = timeTicks({ start: -5.0335e-3, end: -5.0295e-3 })
    const labels = ticks.map((t) => siTick(t, 's', ticks[1] - ticks[0]))
    expect(new Set(labels).size).toBe(labels.length)
    expect(siTick(-2e-3, 's', 1e-3)).toBe('-2 ms')
    expect(siTick(0, 's', 1e-3)).toBe('0 s')
  })

  it('ends tick lists that cannot advance', () => {
    expect(timeTicks({ start: 0, end: 1 })).toHaveLength(11)
    // A window narrower than the precision of its times (from a broken analysis file) used to loop forever
    expect(timeTicks({ start: 1, end: 1 + 2 ** -52 }).length).toBeLessThanOrEqual(2)
    expect(timeTicks({ start: 0, end: 0 })).toEqual([])
    expect(timeTicks({ start: 1, end: 0 })).toEqual([])
    expect(ticksBetween(0, 1, 0)).toEqual([])
    expect(ticksBetween(0, 1, NaN)).toEqual([])
  })

  it('steps V/div in a 1-2-5 sequence', () => {
    expect(stepScale(1, 1)).toBe(2)
    expect(stepScale(2, 1)).toBe(5)
    expect(stepScale(5, 1)).toBe(10)
    expect(stepScale(1, -1)).toBeCloseTo(0.5)
    expect(stepScale(0.2, -1)).toBeCloseTo(0.1)
    expect(stepScale(3, 1)).toBe(5)
  })

  it('snaps a level onto grid lines close by', () => {
    // 20 px per division: within 6 px of a line it snaps
    expect(snapToGrid(1.2, 20)).toBe(1)
    expect(snapToGrid(-2.75, 20)).toBe(-3)
    expect(snapToGrid(-2.65, 20)).toBe(-2.65)
    expect(snapToGrid(0.4, 20)).toBe(0.4)
  })

  it('rounds a scale up to 1-2-5', () => {
    expect(niceStep(0.13)).toBeCloseTo(0.2)
    expect(niceStep(4)).toBe(5)
    expect(niceStep(5)).toBe(5)
    expect(niceStep(6)).toBe(10)
  })

  it('reads typed times with SI prefixes in any case', () => {
    expect(parseTime('-5.5m')).toBeCloseTo(-5.5e-3)
    expect(parseTime('25 µs')).toBeCloseTo(25e-6)
    expect(parseTime('5U')).toBeCloseTo(5e-6)
    expect(parseTime('2K')).toBe(2000)
    expect(parseTime('3N')).toBeCloseTo(3e-9)
    // In a time, M can only mean milli
    expect(parseTime('3M')).toBeCloseTo(3e-3)
    expect(parseTime('1.5e-3')).toBeCloseTo(1.5e-3)
    expect(parseTime('.5 s')).toBe(0.5)
    expect(parseTime('abc')).toBeUndefined()
    expect(parseTime('5 x')).toBeUndefined()
  })
})
