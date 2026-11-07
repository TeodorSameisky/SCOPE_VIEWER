import { describe, expect, it, vi } from 'vitest'
import { MinMaxPyramid } from '../dsp/minmax'
import type { ChannelDisplay } from '../model/types'
import type { LiveChannel, Tool } from '../model/view'
import { viewBoxes } from './draw'
import { MIN_BOX_PX, boxCallout, divAtY, nearestTrace, noteAnchor, rectZoomPatches, releaseOutcome, tagPosition, type Drag, type ReleaseContext } from './plotInteraction'

// Two views of 200 px (20 px per division, the centre of the first at y = 100, of the second at y = 300),
// a plot 1000 px wide showing 0 … 10 s (100 px per second).
const boxes = viewBoxes(undefined, 2, 400)
const xToT = (x: number) => x / 100
const tToX = (t: number) => t * 100

const display = (id: string, over: Partial<ChannelDisplay> = {}): ChannelDisplay => ({ id, label: '', color: '#fff', visible: true, scale: 1, position: 0, offset: 0, ...over })
/** A channel with a constant value over the whole window */
function channel(id: string, value: number, over: Partial<ChannelDisplay> = {}): LiveChannel {
  const data = new Float32Array(100).fill(value)
  return { wave: { id, data, t0: 0, dt: 0.1, yUnit: 'V', xUnit: 's' }, display: display(id, over), pyramid: new MinMaxPyramid(data) }
}
// CH1 = 2 V (y = 60) and CH2 = -1 V (y = 120) in the first view, CH3 = 0 V (y = 300) in the second
const ch1 = channel('CH1', 2)
const ch2 = channel('CH2', -1)
const ch3 = channel('CH3', 0)
const channels = [ch1, ch2, ch3]
const views = [['CH1', 'CH2'], ['CH3']]

describe('levels in a view', () => {
  it('count divisions from the centre of the view, up positive', () => {
    expect(divAtY(boxes, 0, 100)).toBe(0)
    expect(divAtY(boxes, 0, 60)).toBe(2)
    expect(divAtY(boxes, 0, 0)).toBe(5)
    expect(divAtY(boxes, 1, 300)).toBe(0)
    expect(divAtY(boxes, 1, 380)).toBe(-4)
  })
})

describe('the nearest trace', () => {
  it('is the visible trace of the view that passes closest to the pointer, within reach', () => {
    expect(nearestTrace(channels, views, boxes, 5, 62)).toBe('CH1')
    expect(nearestTrace(channels, views, boxes, 5, 118)).toBe('CH2')
    // between the two, further than 20 px from both
    expect(nearestTrace(channels, views, boxes, 5, 90)).toBeUndefined()
    expect(nearestTrace(channels, views, boxes, 5, 90, 40)).toBeDefined()
  })

  it('looks only in the view at the pointer', () => {
    expect(nearestTrace(channels, views, boxes, 5, 300)).toBe('CH3')
    expect(nearestTrace(channels, views, boxes, 5, 62)).not.toBe('CH3')
    // the first view's traces are far from the second
    expect(nearestTrace(channels, views, boxes, 5, 260)).toBeUndefined()
  })

  it('skips hidden traces and times where a trace has no value', () => {
    const hidden = { ...ch1, display: display('CH1', { visible: false }) }
    expect(nearestTrace([hidden, ch2, ch3], views, boxes, 5, 62)).toBeUndefined()
    // outside the record
    expect(nearestTrace(channels, views, boxes, 50, 62)).toBeUndefined()
  })

  it('follows the scale, position and offset of the channel', () => {
    // 2 V at 0.5 V/div, 1 V offset, position 1: (2 - 1) / 0.5 + 1 = 3 divisions up
    const moved = channel('CH1', 2, { scale: 0.5, offset: 1, position: 1 })
    expect(nearestTrace([moved], [['CH1']], boxes, 5, 100 - 3 * 20)).toBe('CH1')
    expect(nearestTrace([moved], [['CH1']], boxes, 5, 60)).toBeUndefined()
  })
})

describe('the position of a tag', () => {
  it('snaps to a whole division when within 6 px of it, else stays free', () => {
    // 20 px per division: 6 px = 0.3 div
    expect(tagPosition(2.2, 20, false)).toBe(2)
    expect(tagPosition(2.4, 20, false)).toBe(2.4)
    expect(tagPosition(-0.1, 20, false)).toBeCloseTo(0, 10)
  })

  it('stays free with Alt, rounded to 0.01 div', () => {
    expect(tagPosition(2.2, 20, true)).toBe(2.2)
    expect(tagPosition(2.123456, 20, true)).toBe(2.12)
  })
})

describe('a new box', () => {
  const traces = [ch1, ch2]
  const o = { traces, boxes, xToT }

  it('belongs to the trace that runs through it, framed by the levels of its two edges', () => {
    // y 40 … 80 is 3 … 1 divisions up: CH1 (2 V) runs through, CH2 (-1 V) does not
    const b = boxCallout({ x0: 100, x1: 300, y0: 40, y1: 80, view: 0 }, o)
    expect(b).toEqual({ type: 'box', t: 1, t2: 3, channel: 'CH1', v: 3, v2: 1 })
  })

  it('does not care which corner the drag started at', () => {
    expect(boxCallout({ x0: 300, x1: 100, y0: 80, y1: 40, view: 0 }, o)).toEqual(boxCallout({ x0: 100, x1: 300, y0: 40, y1: 80, view: 0 }, o))
  })

  it('goes to the selected trace when it runs through, else to the one nearest the centre', () => {
    // 3 … -1.5 divisions: both run through; the centre of the box is at y = 85
    const rect = { x0: 100, x1: 300, y0: 40, y1: 130, view: 0 }
    expect(boxCallout(rect, o)).toMatchObject({ channel: 'CH1' })
    expect(boxCallout(rect, { ...o, selected: 'CH2' })).toMatchObject({ channel: 'CH2' })
  })

  it('goes to the nearest trace when none runs through it, preferring the selected one of the view', () => {
    // 5 … 4 divisions up: nothing there
    const rect = { x0: 100, x1: 300, y0: 0, y1: 20, view: 0 }
    expect(boxCallout(rect, o)).toMatchObject({ channel: 'CH1' })
    expect(boxCallout(rect, { ...o, selected: 'CH2' })).toMatchObject({ channel: 'CH2' })
  })

  it('is tied to the levels of its view when the view has no trace', () => {
    const b = boxCallout({ x0: 100, x1: 300, y0: 40, y1: 80, view: 0 }, { ...o, traces: [] })
    expect(b).toEqual({ type: 'box', t: 1, t2: 3, view: 0, div: 3, div2: 1 })
  })

  it('has its time edges snap to edges of its trace, unless there is no snapping', () => {
    const snapEdge = vi.fn((id: string, t: number) => (id === 'CH1' ? t + 0.25 : undefined))
    const snapped = boxCallout({ x0: 100, x1: 300, y0: 40, y1: 80, view: 0 }, { ...o, snapEdge })
    expect(snapped).toMatchObject({ t: 1.25, t2: 3.25 })
    expect(snapEdge).toHaveBeenCalledWith('CH1', 1)
    // an edge it does not find leaves the time as it is
    expect(boxCallout({ x0: 100, x1: 300, y0: 40, y1: 130, view: 0 }, { ...o, selected: 'CH2', snapEdge })).toMatchObject({ channel: 'CH2', t: 1, t2: 3 })
    expect(boxCallout({ x0: 100, x1: 300, y0: 40, y1: 80, view: 0 }, o)).toMatchObject({ t: 1, t2: 3 })
  })

  it('rounds the levels to six digits', () => {
    const odd = channel('CH1', 2, { scale: 0.123456789 })
    const b = boxCallout({ x0: 100, x1: 300, y0: 41, y1: 83, view: 0 }, { ...o, traces: [odd], selected: 'CH1' })
    expect(String(b.v).replace(/^-?\d+\.?/, '').length).toBeLessThanOrEqual(6)
  })

  it('works in a view lower down', () => {
    // the second view: y 240 … 280 is 3 … 1 divisions up from its centre at 300 … no: 3 up is y = 240
    const b = boxCallout({ x0: 100, x1: 300, y0: 240, y1: 280, view: 1 }, { ...o, traces: [ch3] })
    expect(b).toMatchObject({ channel: 'CH3', v: 3, v2: 1 })
  })
})

describe('a new note', () => {
  it('attaches to the nearest trace within 40 px, with its text below near the top and above elsewhere', () => {
    expect(noteAnchor({ channels, views, boxes, t: 5, y: 80 })).toEqual({ type: 'note', t: 5, channel: 'CH1', dy: -46 })
    // 10 V trace near the top of the plot
    const high = channel('CH1', 4.5)
    expect(noteAnchor({ channels: [high], views: [['CH1']], boxes, t: 5, y: 12 })).toMatchObject({ channel: 'CH1', dy: 24 })
  })

  it('is placed at that spot of the view when no trace is near', () => {
    const n = noteAnchor({ channels, views, boxes, t: 5, y: 190 })
    expect(n).toEqual({ type: 'note', t: 5, view: 0, div: -4.5, dy: -46 })
    expect(noteAnchor({ channels, views, boxes, t: 5, y: 380 })).toMatchObject({ view: 1, div: -4 })
  })
})

describe('the vertical zoom of a rectangle', () => {
  it('fits its two levels into the whole height of each channel of the view', () => {
    const patches = rectZoomPatches(channels, ['CH1', 'CH2'], 3, 1)
    // 2 divisions' worth of volts over the 10 divisions of the view, centred on the middle of the levels
    expect(patches).toEqual([
      { id: 'CH1', patch: { scale: 0.2, offset: 2, position: 0 } },
      { id: 'CH2', patch: { scale: 0.2, offset: 2, position: 0 } },
    ])
  })

  it('uses the settings of each channel to turn levels into values', () => {
    const scaled = channel('CH1', 2, { scale: 2, offset: 1, position: 0.5 })
    // levels 3 and 1 div: (3 - 0.5) * 2 + 1 = 6 and (1 - 0.5) * 2 + 1 = 2
    expect(rectZoomPatches([scaled], ['CH1'], 3, 1)).toEqual([{ id: 'CH1', patch: { scale: 0.4, offset: 4, position: 0 } }])
  })

  it('leaves out channels it does not know', () => {
    expect(rectZoomPatches(channels, ['CH1', 'MATH9'], 3, 1).map((p) => p.id)).toEqual(['CH1'])
  })
})

describe('releasing a drag', () => {
  const win = { start: 0, end: 10 }
  function ctx(over: Partial<ReleaseContext> & { x?: number; y?: number; alt?: boolean } = {}): ReleaseContext {
    const { x = 500, y = 100, alt = false, ...rest } = over
    return {
      pointer: { x, y, alt },
      moved: false,
      tool: 'pan' as Tool,
      win,
      minSpan: 0.01,
      maxSpan: 40,
      plotW: 1000,
      viewsH: 400,
      boxes,
      views,
      channels,
      viewTraces: (vi) => (views[vi] ?? []).flatMap((id) => channels.filter((c) => c.wave.id === id)),
      xToT,
      tToX,
      snap: (t, alt) => (alt ? t : Math.round(t)),
      snapEdge: () => undefined,
      ...rest,
    }
  }
  const rect = (over: Partial<Extract<Drag, { kind: 'rect' }>> = {}): Drag => ({ kind: 'rect', box: false, view: 0, x0: 100, x1: 300, y0: 20, y1: 80, ...over })
  const none = { kind: 'none' }

  describe('a channel tag', () => {
    const tag = (over: Partial<Extract<Drag, { kind: 'tag' }>> = {}): Drag => ({ kind: 'tag', id: 'CH1', view: 0, y0: 60, x: 10, y: 300, pos0: 2, moved: true, target: 1, ...over })

    it('dropped onto another view moves the channel there, its tag at the level of the drop', () => {
      // y = 330 is 1.5 divisions below the centre of the second view: snapped to -1.5 → free (0.3 div > 0.2)
      expect(releaseOutcome(tag(), ctx({ y: 318 }))).toEqual({ kind: 'dropTag', id: 'CH1', view: 1, position: -1 })
      expect(releaseOutcome(tag(), ctx({ y: 330, alt: true }))).toEqual({ kind: 'dropTag', id: 'CH1', view: 1, position: -1.5 })
    })

    it('does nothing when it was not dropped on another view, or the channel is gone', () => {
      expect(releaseOutcome(tag({ target: undefined }), ctx())).toEqual(none)
      expect(releaseOutcome(tag({ id: 'GONE' }), ctx())).toEqual(none)
    })
  })

  describe('a rectangle that is a box', () => {
    it('adds a box callout when it is wide and high enough', () => {
      const r = releaseOutcome(rect({ box: true, y0: 40, y1: 80 }), ctx())
      expect(r).toMatchObject({ kind: 'addCallout', callout: { type: 'box', channel: 'CH1', t: 1, t2: 3 } })
    })

    it('adds nothing when it is a click, narrow or flat', () => {
      expect(releaseOutcome(rect({ box: true, x0: 100, x1: 100 + MIN_BOX_PX - 1 }), ctx())).toEqual(none)
      expect(releaseOutcome(rect({ box: true, y0: 40, y1: 40 + MIN_BOX_PX - 1 }), ctx())).toEqual(none)
    })

    it('stays a box when the tool was changed meanwhile, and snaps its edges unless Alt is held', () => {
      const snapEdge = vi.fn((_id: string, t: number) => t + 0.5)
      const d = rect({ box: true, y0: 40, y1: 80 })
      expect(releaseOutcome(d, ctx({ tool: 'zoom', snapEdge }))).toMatchObject({ callout: { t: 1.5, t2: 3.5 } })
      snapEdge.mockClear()
      expect(releaseOutcome(d, ctx({ tool: 'zoom', snapEdge, alt: true }))).toMatchObject({ callout: { t: 1, t2: 3 } })
      expect(snapEdge).not.toHaveBeenCalled()
    })
  })

  describe('a span', () => {
    const span = (b?: { ch: string; t: number }): Drag => ({ kind: 'span', a: { ch: 'CH1', t: 1 }, b })

    it('adds a span from one trace to the other when its ends are apart', () => {
      expect(releaseOutcome(span({ ch: 'CH2', t: 3 }), ctx())).toEqual({ kind: 'addCallout', callout: { type: 'span', t: 1, t2: 3, channel: 'CH1', channel2: 'CH2' } })
    })

    it('adds nothing when the second end is missing or too close', () => {
      expect(releaseOutcome(span(), ctx())).toEqual(none)
      expect(releaseOutcome(span({ ch: 'CH2', t: 1.01 }), ctx())).toEqual(none)
    })
  })

  describe('a time band', () => {
    it('zooms to the marked time range', () => {
      const r = releaseOutcome({ kind: 'band', x0: 700, x1: 200 }, ctx())
      expect(r).toMatchObject({ kind: 'zoom', window: { start: 2, end: 7 } })
    })

    it('is nothing when narrow', () => {
      expect(releaseOutcome({ kind: 'band', x0: 200, x1: 203 }, ctx())).toEqual(none)
    })

    it('never zooms in beyond the least span', () => {
      const r = releaseOutcome({ kind: 'band', x0: 200, x1: 206 }, ctx({ minSpan: 0.5 }))
      expect(r.kind === 'zoom' && r.window.end - r.window.start).toBe(0.5)
    })
  })

  describe('a zoom rectangle', () => {
    it('zooms time and the vertical range of its view', () => {
      const r = releaseOutcome(rect(), ctx())
      expect(r).toMatchObject({ kind: 'zoom', window: { start: 1, end: 3 } })
      // both channels of the view are fitted to the levels of the rectangle (4 … 1 div)
      expect(r.kind === 'zoom' && r.patches?.map((p) => p.id)).toEqual(['CH1', 'CH2'])
    })

    it('zooms time only when it is flat', () => {
      const r = releaseOutcome(rect({ y0: 50, y1: 52 }), ctx())
      expect(r).toMatchObject({ kind: 'zoom', window: { start: 1, end: 3 } })
      expect(r.kind === 'zoom' && r.patches).toBeUndefined()
    })

    it('zooms in 2x around the pointer on a click, out with Alt', () => {
      const click = rect({ x0: 500, x1: 502, y0: 50, y1: 51 })
      const zin = releaseOutcome(click, ctx({ x: 500 }))
      expect(zin).toMatchObject({ kind: 'zoom', window: { start: 2.5, end: 7.5 } })
      const zout = releaseOutcome(click, ctx({ x: 500, alt: true }))
      expect(zout).toMatchObject({ kind: 'zoom', window: { start: -5, end: 15 } })
    })

    it('does nothing when it is narrow but high', () => {
      expect(releaseOutcome(rect({ x0: 100, x1: 102, y0: 20, y1: 120 }), ctx())).toEqual(none)
    })
  })

  describe('a click', () => {
    const click: Drag = { kind: 'click', x0: 500, y0: 100 }

    it('places a marker with the marker tool, snapped to an edge unless Alt is held', () => {
      expect(releaseOutcome(click, ctx({ tool: 'marker', x: 512 }))).toEqual({ kind: 'addCallout', callout: { type: 'marker', t: 5 } })
      expect(releaseOutcome(click, ctx({ tool: 'marker', x: 512, alt: true }))).toEqual({ kind: 'addCallout', callout: { type: 'marker', t: 5.12 } })
    })

    it('keeps a marker within the plot', () => {
      expect(releaseOutcome(click, ctx({ tool: 'marker', x: 1400, snap: (t) => t }))).toMatchObject({ callout: { t: 10 } })
      expect(releaseOutcome(click, ctx({ tool: 'marker', x: -50, snap: (t) => t }))).toMatchObject({ callout: { t: 0 } })
    })

    it('places a note with the note tool, on the trace near the pointer', () => {
      expect(releaseOutcome(click, ctx({ tool: 'note', y: 70 }))).toEqual({ kind: 'addCallout', callout: { type: 'note', t: 5, channel: 'CH1', dy: -46 } })
    })

    it('keeps a note within the views: below the last one it is placed at its lowest row', () => {
      const r = releaseOutcome(click, ctx({ tool: 'note', y: 900, x: 500 }))
      // y is held at 399, 99 px from the trace of the second view: no trace is near
      expect(r).toMatchObject({ kind: 'addCallout', callout: { type: 'note', view: 1 } })
      expect(r.kind === 'addCallout' && r.callout.div).toBeCloseTo(-4.95, 10)
      expect(r.kind === 'addCallout' && r.callout.channel).toBeUndefined()
    })

    it('is no click when the pointer moved, and means nothing with other tools', () => {
      expect(releaseOutcome(click, ctx({ tool: 'marker', moved: true }))).toEqual(none)
      expect(releaseOutcome(click, ctx({ tool: 'span' }))).toEqual(none)
    })
  })

  describe('a region', () => {
    it('adds a region between its edges, in time order', () => {
      expect(releaseOutcome({ kind: 'region', x0: 700, x1: 200 }, ctx())).toEqual({ kind: 'addCallout', callout: { type: 'region', t: 2, t2: 7 } })
    })

    it('adds nothing when it is a click', () => {
      expect(releaseOutcome({ kind: 'region', x0: 200, x1: 202 }, ctx())).toEqual(none)
    })
  })

  describe('a pan', () => {
    it('is a click that selects the trace under the pointer when the pointer did not move', () => {
      expect(releaseOutcome({ kind: 'pan', x0: 500, win }, ctx({ x: 500, y: 62 }))).toEqual({ kind: 'select', id: 'CH1' })
    })

    it('selects nothing where there is no trace, or after a real pan', () => {
      expect(releaseOutcome({ kind: 'pan', x0: 500, win }, ctx({ x: 500, y: 90 }))).toEqual(none)
      expect(releaseOutcome({ kind: 'pan', x0: 500, win }, ctx({ x: 500, y: 62, moved: true }))).toEqual(none)
    })
  })

  it('does nothing for the drag of a cursor', () => {
    expect(releaseOutcome({ kind: 'cursor', which: 'a', orig: { on: true, a: 1, b: 2, source: 'CH1' } }, ctx())).toEqual(none)
  })
})
