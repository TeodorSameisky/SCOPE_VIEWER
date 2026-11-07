import { describe, expect, it } from 'vitest'
import { sameContent } from './sameContent'

/** What comparing the JSON says: sameContent must agree for everything JSON can hold */
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

describe('sameContent', () => {
  it('is true for the same object and for equal objects', () => {
    const a = { x: [1, { y: 'z' }], n: null }
    expect(sameContent(a, a)).toBe(true)
    expect(sameContent(a, { x: [1, { y: 'z' }], n: null })).toBe(true)
    expect(sameContent([], [])).toBe(true)
    expect(sameContent({}, {})).toBe(true)
  })

  it('tells different values apart', () => {
    expect(sameContent({ x: 1 }, { x: 2 })).toBe(false)
    expect(sameContent([1, 2], [2, 1])).toBe(false)
    expect(sameContent([1], [1, 2])).toBe(false)
    expect(sameContent({ x: { y: 1 } }, { x: { y: 2 } })).toBe(false)
    expect(sameContent('a', 'b')).toBe(false)
    expect(sameContent(1, '1')).toBe(false)
    expect(sameContent(null, {})).toBe(false)
    expect(sameContent(null, undefined)).toBe(false)
    expect(sameContent([], {})).toBe(false)
    expect(sameContent([1], { 0: 1 })).toBe(false)
  })

  it('does not care about the order of keys', () => {
    expect(sameContent({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  })

  it('counts a key with the value undefined as missing, as JSON does', () => {
    expect(sameContent({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(sameContent({ a: 1 }, { a: 1, b: undefined })).toBe(true)
    expect(sameContent({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(true)
    expect(sameContent({ a: 1, b: 2 }, { a: 1, b: undefined })).toBe(false)
  })

  it('takes NaN for NaN and -0 for 0', () => {
    expect(sameContent({ v: NaN }, { v: NaN })).toBe(true)
    expect(sameContent({ v: NaN }, { v: 0 })).toBe(false)
    expect(sameContent(-0, 0)).toBe(true)
  })

  it('agrees with comparing the JSON on a mixed set of pairs', () => {
    const values: unknown[] = [
      { a: 1 },
      { a: 1, b: undefined },
      { b: undefined },
      {},
      [],
      [null],
      { a: [1, { b: 2 }] },
      { a: [1, { b: 3 }] },
      { a: [1, { b: 2 }], c: undefined },
      'x',
      1,
      null,
      true,
      false,
      { a: null },
      { a: 0 },
    ]
    for (const a of values) for (const b of values) expect(sameContent(a, b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(sameJson(a, b))
  })

  it('does not look into parts that are the same object', () => {
    // a getter that throws is never read when both sides share the object that holds it
    const shared = {
      get boom(): number {
        throw new Error('looked into the shared part')
      },
    }
    expect(sameContent({ a: shared, b: 1 }, { a: shared, b: 1 })).toBe(true)
    expect(sameContent({ a: shared, b: 1 }, { a: shared, b: 2 })).toBe(false)
  })
})
