import { describe, expect, it } from 'vitest'
import type { ChannelDisplay } from '../model/types'
import { layoutTags, positionForZeroAt, tagAt, valueToDiv } from './draw'

const display = (id: string, position: number, offset = 0, scale = 1, label = ''): ChannelDisplay => ({ id, label, color: '#fff', visible: true, scale, position, offset })

// A view 200 px high: 20 px per division, the centre line at y = 100
const H = 200

describe('channel tags', () => {
  it('sit at the 0 level of their channel', () => {
    const [t] = layoutTags([display('CH1', 2)], H)
    expect(t.y).toBe(60)
    expect(t.off).toBe(0)
    // With an offset the 0 level moves: 0 V is 1.5 div below the offset level
    expect(layoutTags([display('CH1', 0, 3, 2)], H)[0].y).toBe(130)
  })

  it('stay at the edge with an arrow when the 0 level is outside the view', () => {
    const [above] = layoutTags([display('CH1', 7)], H)
    expect(above.off).toBe(-1)
    expect(above.y).toBe(8)
    const [below] = layoutTags([display('CH2', -9)], H)
    expect(below.off).toBe(1)
    expect(below.y).toBe(192)
  })

  it('are spread apart where they would overlap', () => {
    const tags = layoutTags([display('CH1', 0), display('CH2', 0.1), display('CH3', -0.1)], H)
    const ys = tags.map((t) => t.y)
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(16)
  })

  it('are hit on the tag and its label, the one drawn last first', () => {
    const tags = layoutTags([display('CH1', 0, 0, 1, 'pulse'), display('CH2', -2)], H)
    const ch1 = tags.find((t) => t.display.id === 'CH1')!
    expect(tagAt(tags, 5, ch1.y)?.display.id).toBe('CH1')
    expect(tagAt(tags, ch1.right - 1, ch1.y + 7)?.display.id).toBe('CH1')
    expect(tagAt(tags, ch1.right + 2, ch1.y)).toBeUndefined()
    expect(tagAt(tags, 5, ch1.y + 12)).toBeUndefined()
    expect(tagAt(tags, 5, 140)?.display.id).toBe('CH2')
  })

  it('give the position that puts the 0 level at a division', () => {
    const d = display('CH1', 0, 3, 2)
    const position = positionForZeroAt(1, d)
    expect(valueToDiv(0, { ...d, position })).toBeCloseTo(1)
    expect(positionForZeroAt(-2, display('CH2', 5))).toBe(-2)
  })
})
