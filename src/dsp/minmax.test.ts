import { describe, expect, it } from 'vitest'
import { MinMaxPyramid } from './minmax'

describe('min/max pyramid', () => {
  it('works the same with the levels a worker built and sent', () => {
    const data = Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i / 7) * (i % 13))
    const built = new MinMaxPyramid(data)
    const received = new MinMaxPyramid(data, structuredClone(built.levels))
    expect(built.levels.length).toBeGreaterThan(1)
    const a: [number, number] = [0, 0]
    const b: [number, number] = [0, 0]
    for (const [i0, i1] of [
      [0, 5000],
      [17, 4093],
      [100, 101],
      [2048, 2349],
    ]) {
      built.range(i0, i1, a)
      received.range(i0, i1, b)
      expect(b).toEqual(a)
    }
  })

  it('skips infinite samples like NaN, in the levels and in short ranges', () => {
    // A division by 0 in a math channel: ±Infinity where the divisor is exactly 0
    const data = Float32Array.from({ length: 5000 }, (_, i) => (i % 500 === 0 ? (i % 1000 ? -Infinity : Infinity) : Math.sin(i / 50)))
    const p = new MinMaxPyramid(data)
    const mm: [number, number] = [0, 0]
    for (const [i0, i1] of [
      [0, 5000],
      [495, 505],
    ]) {
      p.range(i0, i1, mm)
      expect(mm.every(Number.isFinite)).toBe(true)
      expect(mm[0]).toBeGreaterThanOrEqual(-1)
      expect(mm[1]).toBeLessThanOrEqual(1)
    }
    // Only invalid samples: no range, like a gap
    p.range(500, 501, mm)
    expect(mm).toEqual([NaN, NaN])
  })

  it('agrees with a plain scan for any range, also after other ranges were asked for', () => {
    const n = 5000
    const data = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) * (1 + (i % 97)) + (i % 211 === 0 ? 500 : 0))
    const p = new MinMaxPyramid(data)
    const mm: [number, number] = [0, 0]
    let seed = 1
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let k = 0; k < 300; k++) {
      const i0 = Math.floor(random() * n)
      const i1 = Math.min(n, i0 + 1 + Math.floor(random() * (k % 3 ? 4000 : 40)))
      let lo = Infinity
      let hi = -Infinity
      for (let i = i0; i < i1; i++) {
        lo = Math.min(lo, data[i])
        hi = Math.max(hi, data[i])
      }
      p.range(i0, i1, mm)
      expect(mm).toEqual([lo, hi])
    }
  })
})
