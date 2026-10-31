import { describe, expect, it } from 'vitest'
import { MinMaxPyramid } from '../dsp/minmax'
import type { ChannelDisplay } from './types'
import { POSITION_STEP, autoscalePatches, carryViewSizes, normalizeSizes, shownViews, cursorsInView, patchDisplays, stepPosition, stepScale, verticalsOf, type LiveChannel } from './view'

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

  describe('shown views', () => {
    it('leave out the views whose channels are all hidden, but never all of them', () => {
      const views = [['CH1', 'CH6', 'CH2'], ['CH4', 'CH5'], ['MATH1']]
      expect(shownViews(views, (id) => id !== 'CH4' && id !== 'CH5')).toEqual([true, false, true])
      expect(shownViews(views, (id) => id === 'CH5')).toEqual([false, true, false])
      // Nothing visible: the first view stays, so the plot is not empty
      expect(shownViews(views, () => false)).toEqual([true, false, false])
    })
  })

  describe('view sizes', () => {
    it('add up to 1', () => {
      expect(normalizeSizes([3, 1])).toEqual([0.75, 0.25])
    })

    it('go with the channels of their views when the views change', () => {
      const views = [['CH1', 'CH6', 'CH2'], ['CH4', 'CH5', 'CH3']]
      // A channel moved between the views: the sizes stay
      expect(carryViewSizes(views, [0.6, 0.4], [['CH1', 'CH6'], ['CH4', 'CH5', 'CH3', 'CH2']])).toEqual([0.6, 0.4])
      // Ch 2 to a new view: it gets the mean size, the others keep theirs (all scaled to add up to 1)
      expect(carryViewSizes(views, [0.6, 0.4], [['CH1', 'CH6'], ['CH4', 'CH5', 'CH3'], ['CH2']])).toEqual([0.4, 0.2667, 0.3333])
      // A view emptied and removed: the others share its height
      expect(carryViewSizes([['CH1'], ['CH2'], ['CH3']], [0.5, 0.25, 0.25], [['CH1', 'CH2'], ['CH3']])).toEqual([0.6667, 0.3333])
      // Without sizes the views stay equal
      expect(carryViewSizes(views, undefined, [['CH1'], ['CH2']])).toBeUndefined()
    })
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

    it('gives the bands in the order the traces are on screen, and keeps it when run again', () => {
      const at = (c: LiveChannel, position: number) => ({ ...c, display: { ...c.display, position } })
      // CH2 is drawn above CH1, although CH1 comes first in the view
      const chs = [at(live('CH1', [0, 2]), -3), at(live('CH2', [0, 2]), 3)]
      const views = [['CH1', 'CH2']]
      const all = autoscalePatches(chs, views, ['CH1', 'CH2'], { start: 0, end: 9 }, 10)
      expect([all.CH2.position, all.CH1.position]).toEqual([2.5, -2.5])
      expect(autoscalePatches(chs, views, ['CH1'], { start: 0, end: 9 }, 10)).toEqual({ CH1: all.CH1 })
      const fitted = chs.map((c) => ({ ...c, display: { ...c.display, ...all[c.wave.id] } }))
      expect(autoscalePatches(fitted, views, ['CH1', 'CH2'], { start: 0, end: 9 }, 10)).toEqual(all)
    })

    it('orders the bands by where the traces run, not by a spike', () => {
      // CH1 runs at 3 V with one spike down to -10 V; CH2 ramps from 0 to 2 V: CH1 is above
      const spiky = live('CH1', Array.from({ length: 1000 }, (_, i) => (i === 500 ? -10 : 3)))
      const ramp = live('CH2', Array.from({ length: 1000 }, (_, i) => (2 * i) / 999))
      const p = autoscalePatches([spiky, ramp], [['CH2', 'CH1']], ['CH1', 'CH2'], { start: 0, end: 999 }, 10)
      expect([p.CH1.position, p.CH2.position]).toEqual([2.5, -2.5])
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
