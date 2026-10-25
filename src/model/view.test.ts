import { describe, expect, it } from 'vitest'
import { MinMaxPyramid } from '../dsp/minmax'
import type { ChannelDisplay } from './types'
import { POSITION_STEP, autoscalePatches, cursorsInView, patchDisplays, stepPosition, stepScale, verticalsOf, type LiveChannel } from './view'

const display = (id: string, scale = 1): ChannelDisplay => ({ id, label: '', color: '#ff0', visible: true, scale, position: 0, offset: 0 })

/** A channel with one sample per second from t = 0 */
const live = (id: string, samples: number[], visible = true): LiveChannel => {
  const data = Float32Array.from(samples)
  return { wave: { id, data, t0: 0, dt: 1, yUnit: 'V', xUnit: 's' }, display: { ...display(id, 7), visible }, pyramid: new MinMaxPyramid(data) }
}

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

  describe('autoscale', () => {
    const all = { start: 0, end: 9 }

    it('fits a channel alone in its view into 8 divisions, centred', () => {
      const ch = live('CH1', [-1, 0, 3, 1])
      // 4 V into 8 div: 0.5 V/div, the middle (1 V) at the centre
      expect(autoscalePatches([ch], [['CH1']], ['CH1'], all, 10)).toEqual({ CH1: { scale: 0.5, offset: 1, position: 0 } })
    })

    it('fits what is on screen, and the whole record when nothing of it is', () => {
      const ch = live('CH1', [0, 0.1, 0.2, 10, 10])
      expect(autoscalePatches([ch], [['CH1']], ['CH1'], { start: 0, end: 2 }, 10).CH1.scale).toBe(0.05)
      expect(autoscalePatches([ch], [['CH1']], ['CH1'], { start: 20, end: 30 }, 10).CH1.scale).toBe(2)
    })

    it('gives the visible channels of a shared view a band each, the same for one or all', () => {
      const chs = [live('CH1', [0, 2]), live('CH2', [0, 2], false), live('CH3', [0, 2])]
      const views = [['CH1', 'CH2', 'CH3']]
      const both = autoscalePatches(chs, views, ['CH1', 'CH3'], all, 10)
      // two bands of 5 div: 2 V into 4 div, the hidden CH2 takes no band
      expect(both).toEqual({ CH1: { scale: 0.5, offset: 1, position: 2.5 }, CH3: { scale: 0.5, offset: 1, position: -2.5 } })
      expect(autoscalePatches(chs, views, ['CH3'], all, 10)).toEqual({ CH3: both.CH3 })
      // a hidden channel autoscaled on its own gets the band it would have when shown
      expect(autoscalePatches(chs, views, ['CH2'], all, 10).CH2.position).toBe(0)
    })

    it('keeps the V/div of a flat trace and leaves channels without samples alone', () => {
      expect(autoscalePatches([live('CH1', [3.5, 3.5])], [['CH1']], ['CH1'], all, 10)).toEqual({ CH1: { scale: 7, offset: 3.5, position: 0 } })
      expect(autoscalePatches([live('MATH1', [NaN, NaN])], [['MATH1']], ['MATH1', 'CH9'], all, 10)).toEqual({})
    })

    it('fits a math channel with infinite samples (CH1 / CH2 where CH2 is 0) to its finite ones', () => {
      expect(autoscalePatches([live('MATH1', [-1, Infinity, 3, -Infinity, 1])], [['MATH1']], ['MATH1'], all, 10)).toEqual({ MATH1: { scale: 0.5, offset: 1, position: 0 } })
    })
  })
})
