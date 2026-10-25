import { describe, expect, it } from 'vitest'
import { SampleCache } from './sampleCache'

describe('SampleCache', () => {
  it('computes once per sample array and key', () => {
    const cache = new SampleCache<number | undefined>(4)
    const a = new Float32Array(3)
    const b = new Float32Array(3)
    let runs = 0
    const get = (data: Float32Array, key: string) => cache.get(data, key, () => (runs++, key === 'none' ? undefined : runs))
    expect([get(a, 'x'), get(a, 'x'), get(b, 'x'), get(a, 'none'), get(a, 'none')]).toEqual([1, 1, 2, undefined, undefined])
    expect(runs).toBe(3)
  })

  it('keeps the most recently used keys of each array', () => {
    const cache = new SampleCache<string>(2)
    const a = new Float32Array(1)
    let runs = 0
    const get = (key: string) => cache.get(a, key, () => (runs++, key))
    get('1')
    get('2')
    get('1')
    // '2' is the least recently used: it goes, '1' stays
    get('3')
    expect(runs).toBe(3)
    get('1')
    expect(runs).toBe(3)
    get('2')
    expect(runs).toBe(4)
  })

  it('keeps what each slot asked for last, however many slots ask', () => {
    const cache = new SampleCache<string>(2)
    const a = new Float32Array(1)
    let runs = 0
    const get = (key: string, slot?: string) => cache.get(a, key, () => (runs++, key), slot)
    // Five callouts each measure their own span: more than the cache keeps
    for (let round = 0; round < 3; round++) for (let i = 0; i < 5; i++) get(`span${i}`, `callout${i}`)
    expect(runs).toBe(5)
    // A slot that moves on releases its old key
    get('span0b', 'callout0')
    get('x')
    get('y')
    expect(runs).toBe(8)
    get('span0')
    expect(runs).toBe(9)
  })
})
