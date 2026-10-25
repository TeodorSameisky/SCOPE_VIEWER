import { describe, expect, it } from 'vitest'
import { butterworth, integral, movingAverage, movingRms } from './signal'

const values = (a: Float32Array) => Array.from(a)

describe('running functions with invalid samples', () => {
  it('average the valid samples and keep the gaps', () => {
    expect(values(movingAverage(Float32Array.from([1, 2, NaN, 4, 5]), 3))).toEqual([1.5, 1.5, NaN, 4.5, 4.5])
    expect(values(movingRms(Float32Array.from([3, NaN, -3, Infinity, 3]), 3))).toEqual([3, NaN, 3, NaN, 3])
  })

  it('integrate from the first valid sample and hold the value across a gap', () => {
    expect(values(integral(Float32Array.from([NaN, 1, 1, NaN, 1, 1]), 1))).toEqual([NaN, 0, 1, NaN, 1, 2])
    expect(values(integral(Float32Array.from([2, 2, -Infinity, 2]), 0.5))).toEqual([0, 1, NaN, 1])
  })

  it('filter on both sides of a gap, starting again after it', () => {
    const x = new Float32Array(200).fill(2)
    x[100] = NaN
    const low = butterworth(x, 1e6, 1e4, 'low')
    const high = butterworth(x, 1e6, 1e4, 'high')
    expect(Number.isNaN(low[100]) && Number.isNaN(high[100])).toBe(true)
    for (const i of [0, 99, 101, 199]) {
      expect(low[i]).toBeCloseTo(2, 5)
      expect(high[i]).toBeCloseTo(0, 5)
    }
  })
})
