import { describe, expect, it } from 'vitest'
import type { ChannelDisplay } from './types'
import { POSITION_STEP, cursorsInView, patchDisplays, stepPosition, stepScale, verticalsOf } from './view'

const display = (id: string, scale = 1): ChannelDisplay => ({ id, label: '', color: '#ff0', visible: true, scale, position: 0, offset: 0 })

describe('view', () => {
  it('steps a position without floating-point noise', () => {
    expect(stepPosition(0.3, POSITION_STEP)).toBe(0.4)
    expect(stepPosition(-0.1, -POSITION_STEP)).toBe(-0.2)
    expect(stepPosition(1.25, 1)).toBe(2.25)
  })

  it('steps V/div along 1-2-5', () => {
    expect(stepScale(1, 1)).toBe(2)
    expect(stepScale(2, 1)).toBe(5)
    expect(stepScale(1, -1)).toBe(0.5)
    expect(stepScale(0.3, 1)).toBe(0.5)
  })

  it('brings the cursors into the view at 30 % and 70 %', () => {
    const c = cursorsInView({ on: false, a: -5, b: 9, source: 'CH2' }, { start: 0, end: 10 })
    expect(c).toEqual({ on: true, a: 3, b: 7, source: 'CH2' })
  })

  it('keeps the vertical settings of the listed channels only', () => {
    const ds = [display('CH1', 2), display('CH2', 5)]
    expect(verticalsOf(ds, ['CH2'])).toEqual({ CH2: { scale: 5, position: 0, offset: 0 } })
    // a zoom that scaled nothing: Back restores no channel
    expect(verticalsOf(ds, [])).toEqual({})
  })

  it('patches channels by id, and returns the same array when nothing changes', () => {
    const ds = [display('CH1', 2), display('CH2', 5)]
    const next = patchDisplays(ds, { CH2: { scale: 0.1, offset: 3 } })
    expect(next.map((d) => [d.scale, d.offset])).toEqual([
      [2, 0],
      [0.1, 3],
    ])
    expect(next[0]).toBe(ds[0])
    expect(patchDisplays(ds, { CH2: { scale: 5, position: 0 } })).toBe(ds)
    expect(patchDisplays(ds, { MATH1: { scale: 1 } })).toBe(ds)
  })
})
