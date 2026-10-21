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

describe('measure on noise', () => {
  it('reports no timing values for a flat noisy signal', () => {
    // deterministic pseudo-random noise around 12 V
    let seed = 1
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5
    const data = new Float32Array(20000)
    for (let i = 0; i < data.length; i++) data[i] = 12 + 0.05 * (rnd() + rnd() + rnd())
    const m = measure(data, 0, data.length, 0, 4e-8)
    expect(m.levelsOk).toBe(false)
    expect(m.frequency).toBeNaN()
    expect(m.riseTime).toBeNaN()
    expect(m.mean).toBeCloseTo(12, 2)
  })

  it('still measures a noisy square wave', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5
    const data = new Float32Array(10000)
    for (let i = 0; i < data.length; i++) data[i] = (i % 1000 < 500 ? 5 : 0) + 0.2 * rnd()
    const m = measure(data, 0, data.length, 0, 1e-6)
    expect(m.levelsOk).toBe(true)
    expect(m.frequency).toBeCloseTo(1000, 0)
    expect(m.duty).toBeCloseTo(50, 0)
  })
})

describe('measurement definitions', () => {
  it('document every measurement exactly once', async () => {
    const { MEASUREMENT_DEFS } = await import('./measureDefs')
    const m = measure(new Float32Array([0, 1, 0, 1]), 0, 4, 0, 1)
    const keys = Object.keys(m).filter((k) => k !== 'count' && k !== 'levelsOk').sort()
    expect(MEASUREMENT_DEFS.map((d) => d.key).sort()).toEqual(keys)
    for (const d of MEASUREMENT_DEFS) expect(d.short.length && d.method.length).toBeTruthy()
  })
})
