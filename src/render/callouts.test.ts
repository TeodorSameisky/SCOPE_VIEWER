import { describe, expect, it } from 'vitest'
import { stackRows } from './callouts'

describe('stackRows', () => {
  it('keeps labels that do not overlap in one row', () => {
    expect(stackRows([{ x: 0, w: 40 }, { x: 50, w: 40 }, { x: 100, w: 10 }])).toEqual([0, 0, 0])
  })

  it('moves an overlapping label to the next row', () => {
    expect(stackRows([{ x: 0, w: 40 }, { x: 17, w: 54 }])).toEqual([0, 1])
  })

  it('reuses the first row that has room, whatever the input order', () => {
    // b overlaps a; c fits after a in row 0 again
    expect(stackRows([{ x: 200, w: 30 }, { x: 0, w: 100 }, { x: 50, w: 100 }])).toEqual([0, 0, 1])
  })

  it('keeps a gap between labels in a row', () => {
    expect(stackRows([{ x: 0, w: 40 }, { x: 42, w: 10 }])).toEqual([0, 1])
    expect(stackRows([{ x: 0, w: 40 }, { x: 44, w: 10 }])).toEqual([0, 0])
  })
})
