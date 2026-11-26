import { describe, expect, it } from 'vitest'
import type { ChannelDisplay } from '../model/types'
import { AXIS_GUTTER } from './draw'
import { plotFrame, viewBoxes, type FrameChannel } from './plotFrame'

const display = (id: string, over: Partial<ChannelDisplay> = {}): ChannelDisplay => ({ id, label: '', color: '#fff', visible: true, scale: 1, position: 0, offset: 0, ...over })
/** A channel with a constant value over 0 … 10 s */
const channel = (id: string, value: number, over: Partial<ChannelDisplay> = {}): FrameChannel => ({
  wave: { id, data: new Float32Array(101).fill(value), t0: 0, dt: 0.1, yUnit: 'V', xUnit: 's' },
  display: display(id, over),
})

// 1000 px of plot showing 2 … 12 s (100 px per second); two views of 200 px (20 px per division)
const ch1 = channel('CH1', 2)
const ch2 = channel('CH2', -1)
const ch3 = channel('CH3', 0)
const frameOf = (o: { channels?: FrameChannel[]; views?: string[][]; sizes?: number[]; shown?: boolean[] } = {}) =>
  plotFrame({ width: 1000 + AXIS_GUTTER, height: 400, win: { start: 2, end: 12 }, views: [['CH1', 'CH2'], ['CH3']], channels: [ch1, ch2, ch3], ...o })

describe('view boxes', () => {
  it('share the plot by their sizes, equally without', () => {
    expect(viewBoxes(undefined, 2, 400)).toEqual({ tops: [0, 200], heights: [200, 200] })
    expect(viewBoxes([0.25, 0.75], 2, 400)).toEqual({ tops: [0, 100], heights: [100, 300] })
    // Whole pixels that add up to the plot
    expect(viewBoxes([1, 1, 1], 3, 400).heights).toEqual([133, 134, 133])
    // Sizes for other views than these are left out
    expect(viewBoxes([0.25, 0.75], 3, 300).heights).toEqual([100, 100, 100])
  })

  it('give a view left out no height, and its share to the others', () => {
    expect(viewBoxes([0.25, 0.25, 0.5], 3, 300, [true, false, true])).toEqual({ tops: [0, 100, 100], heights: [100, 0, 200] })
    // The last view left out
    expect(viewBoxes(undefined, 2, 300, [true, false]).heights).toEqual([300, 0])
  })

  it('are never lower than 40 px', () => {
    expect(viewBoxes([0.05, 0.95], 2, 400).heights).toEqual([40, 380])
  })
})

describe('the plot frame', () => {
  it('maps time to x and back across the plot without its scale labels', () => {
    const f = frameOf()
    expect(f.plotW).toBe(1000)
    expect([f.tToX(2), f.tToX(7), f.tToX(12)]).toEqual([0, 500, 1000])
    expect(f.xToT(f.tToX(4.37))).toBeCloseTo(4.37, 12)
    expect([f.clampX(-5), f.clampX(300), f.clampX(1040)]).toEqual([0, 300, 1000])
  })

  it('knows how high the views are together, and which it shows', () => {
    expect(frameOf().viewsH).toBe(400)
    expect(frameOf({ sizes: [0.25, 0.75] }).boxes).toEqual({ tops: [0, 100], heights: [100, 300] })
    const folded = frameOf({ shown: [false, true] })
    expect(folded.shown).toEqual([1])
    expect(folded.viewsH).toBe(400)
  })

  it('finds the view at a height, never one left out', () => {
    const f = frameOf({ sizes: [0.25, 0.75] })
    expect([f.viewAt(-5), f.viewAt(99), f.viewAt(100), f.viewAt(450)]).toEqual([0, 0, 1, 1])
    // Below the last shown view is that one, above the first shown one that one
    const gap = frameOf({ views: [[], ['CH1'], [], ['CH3']], shown: [false, true, false, true] })
    expect([gap.viewAt(-5), gap.viewAt(199), gap.viewAt(200), gap.viewAt(450)]).toEqual([1, 1, 3, 3])
  })

  it('gives the box of a view, clamped to the views there are', () => {
    const f = frameOf()
    expect(f.box(1)).toEqual({ top: 200, h: 200, divPx: 20 })
    expect(f.box(7)).toEqual(f.box(1))
    expect(f.box(-1)).toEqual(f.box(0))
  })

  it('turns heights into levels of a view and back', () => {
    const f = frameOf()
    expect([f.divAt(0, 100), f.divAt(0, 60), f.divAt(0, 0), f.divAt(1, 300), f.divAt(1, 380)]).toEqual([0, 2, 5, 0, -4])
    expect(f.yOfDiv(1, f.divAt(1, 337))).toBeCloseTo(337, 12)
  })

  it('puts a trace at the height of its value in its own view', () => {
    const f = frameOf()
    // CH1 = 2 V: 2 divisions up from the centre of the first view; CH3 = 0 V: the centre of the second
    expect(f.yOf('CH1', 5)).toBe(60)
    expect(f.yOf('CH3', 5)).toBe(300)
    expect(f.yOfValue('CH2', 1)).toBe(80)
    // 2 V at 0.5 V/div, 1 V offset, position 1: (2 - 1) / 0.5 + 1 = 3 divisions up
    expect(frameOf({ channels: [channel('CH1', 2, { scale: 0.5, offset: 1, position: 1 })] }).yOf('CH1', 5)).toBe(40)
  })

  it('has no place for a hidden channel, one in a view left out, or one it does not know', () => {
    const hidden = frameOf({ channels: [channel('CH1', 2, { visible: false }), ch2, ch3] })
    expect(hidden.place('CH1')).toBeUndefined()
    expect(hidden.yOf('CH1', 5)).toBeUndefined()
    expect(hidden.traces(0).map((c) => c.wave.id)).toEqual(['CH2'])
    const folded = frameOf({ shown: [true, false] })
    expect(folded.place('CH3')).toBeUndefined()
    expect(folded.traces(1)).toEqual([])
    expect(folded.viewOf('CH3')).toBe(1)
    expect(frameOf().place('MATH9')).toBeUndefined()
    expect(frameOf().viewOf('MATH9')).toBe(-1)
  })

  it('has no height for a trace at a time off its record', () => {
    expect(frameOf().yOf('CH1', 50)).toBeUndefined()
  })

  it('gives a channel its view and that view’s box', () => {
    expect(frameOf().place('CH3')).toMatchObject({ view: 1, top: 200, h: 200, divPx: 20 })
    expect(frameOf().traces(0).map((c) => c.wave.id)).toEqual(['CH1', 'CH2'])
  })
})
