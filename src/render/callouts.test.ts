import { describe, expect, it } from 'vitest'
import { MinMaxPyramid } from '../dsp/minmax'
import type { Callout } from '../model/callouts'
import type { LiveChannel } from '../model/view'
import { layoutCallouts, stackRows, type CalloutLayout } from './callouts'

/** A flat trace at `level` over 0…10 s */
const channel = (id: string, level: number, visible = true): LiveChannel => {
  const data = new Float32Array(11).fill(level)
  return {
    wave: { id, data, t0: 0, dt: 1, yUnit: 'V', xUnit: 's' },
    display: { id, label: '', color: '#fff', visible, scale: 1, position: 0, offset: 0 },
    pyramid: new MinMaxPyramid(data),
  }
}
// Two views 200 px high (20 px per division), 10 s across 100 px
const layout = (channels: LiveChannel[]): CalloutLayout => ({ channels, views: [['CH1'], ['CH2']], win: { start: 0, end: 10 }, plotW: 100, viewH: 200 })
const base: Callout = { id: 'x', n: 1, type: 'box', t: 2, t2: 4, text: '', color: '#fff' }

describe('box geometry', () => {
  it('frames the time span and the values of its channel', () => {
    const g = layoutCallouts([{ ...base, channel: 'CH1', v: -2, v2: 2 }], layout([channel('CH1', 0), channel('CH2', 0)])).get('x')
    expect(g).toMatchObject({ type: 'box', x: 20, w: 20, y: 60, h: 80, shape: 'rect' })
  })

  it('stays inside its view, and is hidden with its channel', () => {
    const p = layout([channel('CH1', 0), channel('CH2', 0)])
    // From 2 V up to 20 V: cut at the top of the view of CH2 (y = 200)
    expect(layoutCallouts([{ ...base, channel: 'CH2', v: 2, v2: 20 }], p).get('x')).toMatchObject({ y: 200, h: 60 })
    expect(layoutCallouts([{ ...base, channel: 'CH2', v: 20, v2: 30 }], p).get('x')).toBeUndefined()
    expect(layoutCallouts([{ ...base, channel: 'CH1', v: -1, v2: 1 }], layout([channel('CH1', 0, false)])).get('x')).toBeUndefined()
  })

  it('can be free in a view', () => {
    const g = layoutCallouts([{ ...base, view: 1, div: 1, div2: -1, shape: 'ellipse' }], layout([channel('CH1', 0), channel('CH2', 0)])).get('x')
    expect(g).toMatchObject({ y: 280, h: 40, shape: 'ellipse' })
  })
})

describe('span geometry', () => {
  it('joins its ends on their traces, with the dimension line below the lower one', () => {
    const span: Callout = { ...base, type: 'span', t: 2, t2: 6, channel: 'CH1', channel2: 'CH2' }
    const g = layoutCallouts([span], layout([channel('CH1', 1), channel('CH2', -1)])).get('x')
    // CH1 at 1 V: 1 div above the centre of view 1; CH2 at -1 V: 1 div below the centre of view 2
    expect(g).toMatchObject({ type: 'span', xa: 20, ya: 80, xb: 60, yb: 320, y: 344 })
    expect(g?.type === 'span' && g.label.runs.map((r) => r.text).join('')).toBe('Span 1  Δt 4.000 s')
  })

  it('is hidden when an end has no trace', () => {
    const span: Callout = { ...base, type: 'span', t: 2, t2: 6, channel: 'CH1', channel2: 'CH3' }
    expect(layoutCallouts([span], layout([channel('CH1', 1), channel('CH2', -1)])).get('x')).toBeUndefined()
  })
})

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
