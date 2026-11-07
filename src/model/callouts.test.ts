import { describe, expect, it } from 'vitest'
import { DARK_THEME, LIGHT_THEME } from '../render/theme'
import {
  CALLOUT_TYPES,
  DEFAULT_CALLOUT_COLOR,
  adjacentCallout,
  boxZoomPatch,
  calloutName,
  calloutTitle,
  calloutWindow,
  calloutsOn,
  isOffRecord,
  nextCalloutNumber,
  sanitizeCallouts,
  type Callout,
} from './callouts'
import { zoomAround } from './view'

const sample: Callout[] = [
  { id: 'a', n: 1, type: 'note', t: -5e-3, channel: 'CH2', dx: 24, dy: -46, text: 'STO drops', color: '#22c8e6' },
  { id: 'b', n: 2, type: 'marker', t: 0, text: '', color: '#e6e9ee' },
  { id: 'c', n: 3, type: 'region', t: -5e-3, t2: -1e-4, text: 'fault window', color: '#3fb6ff' },
]

describe('callout names', () => {
  it('uses the first line of the text, else type and number', () => {
    expect(calloutTitle(sample[0])).toBe('STO drops')
    expect(calloutTitle(sample[1])).toBe('Marker 2')
    expect(calloutTitle({ ...sample[2], text: '  \nsecond line' })).toBe('Region 3')
    expect(calloutName(sample[0])).toBe('Note 1')
  })
})

describe('callout validation', () => {
  it('keeps valid callouts through JSON', () => {
    const callouts = sanitizeCallouts(JSON.parse(JSON.stringify(sample)))
    expect(callouts).toEqual(sample.map((c) => ({ view: undefined, div: undefined, t2: undefined, channel: undefined, dx: undefined, dy: undefined, ...c })))
  })

  it('drops invalid entries', () => {
    const callouts = sanitizeCallouts([{ type: 'region', t: 1 }, { type: 'bogus', t: 0 }, { type: 'marker', t: 2, color: 'red;x' }])
    expect(callouts).toHaveLength(1)
    expect(callouts[0].type).toBe('marker')
    expect(callouts[0].color).toBe(DEFAULT_CALLOUT_COLOR.marker)
    expect(sanitizeCallouts({ foo: 1 })).toEqual([])
  })

  it('gives each type a default colour of its own, none like the cursors', () => {
    const defaults = CALLOUT_TYPES.map((t) => DEFAULT_CALLOUT_COLOR[t])
    expect(new Set(defaults).size).toBe(defaults.length)
    for (const theme of [DARK_THEME, LIGHT_THEME]) {
      for (const c of defaults) expect(theme.ink(c)).not.toBe(theme.cursor)
    }
  })

  it('numbers new callouts after the highest existing one', () => {
    expect(nextCalloutNumber(sample)).toBe(4)
    expect(nextCalloutNumber([])).toBe(1)
  })
})

describe('finding callouts', () => {
  it('lists the callouts on a channel, spans by both of their ends', () => {
    const span: Callout = { id: 's', n: 4, type: 'span', t: 0, t2: 1e-3, channel: 'CH1', channel2: 'CH2', text: '', color: '#c86bff' }
    const list = [...sample, span]
    expect(calloutsOn(list, 'CH2').map((c) => c.id)).toEqual(['a', 's'])
    expect(calloutsOn(list, 'CH1').map((c) => c.id)).toEqual(['s'])
    expect(calloutsOn(list, 'MATH1')).toEqual([])
  })

  it('steps to the callout before or after the selected one, in time order', () => {
    // in time: a and c start at -5 ms, b is at 0
    const order = (from: string | undefined, dir: -1 | 1) => adjacentCallout(sample, from, 0, dir)?.id
    expect(order('b', -1)).toBeDefined()
    expect(order('b', 1)).toBeUndefined()
    const sorted = [...sample].sort((p, q) => (p.t === q.t ? 0 : p.t - q.t))
    expect(order(sorted[0].id, -1)).toBeUndefined()
    expect(order(sorted[0].id, 1)).toBe(sorted[1].id)
  })

  it('starts from the middle of the view when nothing is selected', () => {
    expect(adjacentCallout(sample, undefined, -1e-3, 1)?.id).toBe('b')
    expect(adjacentCallout(sample, undefined, -1e-3, -1)?.id).toBeDefined()
    expect(adjacentCallout(sample, 'gone', -1e-3, 1)?.id).toBe('b')
    expect(adjacentCallout(sample, undefined, 1, 1)).toBeUndefined()
    expect(adjacentCallout([], undefined, 0, 1)).toBeUndefined()
  })
})

describe('the view around a callout', () => {
  const win = { start: 0, end: 10e-3 }

  it('centres the current width on a moment (a note or a marker)', () => {
    const w = calloutWindow(sample[1], win, 1e-6)
    expect(w.end - w.start).toBeCloseTo(10e-3)
    expect((w.start + w.end) / 2).toBeCloseTo(0)
  })

  it('shows a span with 15 % room on both sides, at least the least span', () => {
    const w = calloutWindow(sample[2], win, 1e-6)
    const span = -1e-4 - -5e-3
    expect(w.start).toBeCloseTo(-5e-3 - span * 0.15)
    expect(w.end).toBeCloseTo(-1e-4 + span * 0.15)
    const tiny = calloutWindow({ ...sample[2], t: 0, t2: 1e-9 }, win, 1e-3)
    expect(tiny.end - tiny.start).toBeCloseTo(2e-3, 6)
  })

  it('knows when a callout lies off the record', () => {
    const record = { start: -1e-3, end: 1e-3 }
    expect(isOffRecord(sample[1], record)).toBe(false)
    expect(isOffRecord(sample[2], record)).toBe(true)
    expect(isOffRecord({ ...sample[1], t: 2e-3 }, record)).toBe(true)
  })
})

describe('zoom to a box', () => {
  const display = { id: 'CH1', label: '', color: '#fff', visible: true, scale: 1, position: 3, offset: 0 }
  const box: Callout = { id: 'x', n: 1, type: 'box', t: 0, t2: 1e-3, channel: 'CH1', v: 1, v2: 3, text: '', color: '#ff9d2e' }

  it('scales the channel so the box fills 70 % of the view and centres it', () => {
    const z = boxZoomPatch(box, display, 10)
    expect(z?.id).toBe('CH1')
    expect(z?.patch.offset).toBe(2)
    expect(z?.patch.position).toBe(0)
    // 2 V over 7 divisions
    expect(z?.patch.scale).toBeCloseTo(2 / 7, 3)
  })

  it('has nothing to scale without a channel or a height', () => {
    expect(boxZoomPatch(box, undefined, 10)).toBeUndefined()
    expect(boxZoomPatch({ ...box, v: 2, v2: 2 }, display, 10)).toBeUndefined()
    expect(boxZoomPatch({ ...box, v: undefined, v2: undefined, view: 0, div: 1, div2: 2 }, display, 10)).toBeUndefined()
  })
})

describe('zoomAround', () => {
  it('keeps the pointed time fixed', () => {
    const w = zoomAround({ start: 0, end: 10 }, 2, 0.5, 0.001, 100)
    expect(w.end - w.start).toBeCloseTo(5)
    expect((2 - w.start) / (w.end - w.start)).toBeCloseTo(0.2)
  })

  it('respects span limits', () => {
    expect(zoomAround({ start: 0, end: 10 }, 5, 0.0001, 1, 100).end).toBeCloseTo(5.5)
    const w = zoomAround({ start: 0, end: 10 }, 5, 1000, 1, 100)
    expect(w.end - w.start).toBeCloseTo(100)
  })
})
