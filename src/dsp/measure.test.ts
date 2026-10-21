import { describe, expect, it } from 'vitest'
import { measure } from './measure'

describe('measure', () => {
  // 1 kHz square wave 0..5 V, 25 % duty, 1 µs sample interval, with linear 10 µs edges
  const dt = 1e-6
  const n = 10000
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const ph = i % 1000
    if (ph < 10) data[i] = (ph / 10) * 5
    else if (ph < 250) data[i] = 5
    else if (ph < 260) data[i] = 5 - ((ph - 250) / 10) * 5
    else data[i] = 0
  }
  const m = measure(data, 0, n, 0, dt)

  it('computes amplitude statistics', () => {
    expect(m.max).toBe(5)
    expect(m.min).toBe(0)
    expect(m.top).toBeCloseTo(5, 1)
    expect(m.base).toBeCloseTo(0, 1)
  })

  it('computes timing', () => {
    expect(m.frequency).toBeCloseTo(1000, 3)
    expect(m.riseTime).toBeCloseTo(8e-6, 7)
    expect(m.fallTime).toBeCloseTo(8e-6, 7)
    expect(m.posWidth).toBeCloseTo(250e-6, 7)
    expect(m.duty).toBeCloseTo(25, 2)
  })
})
