import { describe, expect, it } from 'vitest'
import { edgeLevels, nearestEdge } from './edges'

/** 0 V, a rising edge over 4 samples around index 20, 1 V, a falling edge around index 60, 0 V */
function pulse(): Float32Array {
  const d = new Float32Array(100)
  for (let i = 0; i < 100; i++) {
    if (i >= 18 && i <= 22) d[i] = (i - 18) / 4
    else if (i > 22 && i < 58) d[i] = 1
    else if (i >= 58 && i <= 62) d[i] = 1 - (i - 58) / 4
  }
  return d
}

describe('edgeLevels', () => {
  it('finds the 10 / 50 / 90 % levels of a bi-level signal', () => {
    const lv = edgeLevels(pulse(), 0, 100)!
    expect(lv.lo).toBeCloseTo(0.1, 2)
    expect(lv.mid).toBeCloseTo(0.5, 2)
    expect(lv.hi).toBeCloseTo(0.9, 2)
  })

  it('has none for a flat line', () => {
    expect(edgeLevels(new Float32Array(50), 0, 50)).toBeUndefined()
  })
})

describe('nearestEdge', () => {
  const d = pulse()
  const lv = edgeLevels(d, 0, 100)!

  it('returns the 50 % crossing of the nearest edge', () => {
    expect(nearestEdge(d, 23, 8, lv)).toBeCloseTo(20, 1)
    expect(nearestEdge(d, 57, 8, lv)).toBeCloseTo(60, 1)
  })

  it('returns nothing when no edge is within reach', () => {
    expect(nearestEdge(d, 40, 8, lv)).toBeUndefined()
  })

  it('picks the nearer of two edges', () => {
    expect(nearestEdge(d, 45, 30, lv)).toBeCloseTo(60, 1)
    expect(nearestEdge(d, 35, 30, lv)).toBeCloseTo(20, 1)
  })

  it('ignores a glitch that crosses the middle but does not reach the other level', () => {
    const g = pulse()
    g[40] = 0.4 // dip from 1 V to 0.4 V and back: crosses 50 %, never below 10 %
    expect(nearestEdge(g, 40, 5, lv)).toBeUndefined()
  })

  it('only looks inside the limits', () => {
    expect(nearestEdge(d, 23, 8, lv, 21, 100)).toBeUndefined()
  })
})
