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
})
