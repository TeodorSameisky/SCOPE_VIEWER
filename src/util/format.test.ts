import { describe, expect, it } from 'vitest'
import { si, siTick } from './format'
import { stepScale, timeTicks } from '../components/state'

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

  it('steps V/div in a 1-2-5 sequence', () => {
    expect(stepScale(1, 1)).toBe(2)
    expect(stepScale(2, 1)).toBe(5)
    expect(stepScale(5, 1)).toBe(10)
    expect(stepScale(1, -1)).toBeCloseTo(0.5)
    expect(stepScale(0.2, -1)).toBeCloseTo(0.1)
    expect(stepScale(3, 1)).toBe(5)
  })
})
