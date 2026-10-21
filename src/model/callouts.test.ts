import { describe, expect, it } from 'vitest'
import { calloutsToJson, nextCalloutNumber, parseCalloutJson, type Callout } from './callouts'
import { zoomAround } from '../components/state'

const sample: Callout[] = [
  { id: 'a', n: 1, type: 'note', t: -5e-3, channel: 'CH2', dx: 24, dy: -46, text: 'STO drops', color: '#22c8e6' },
  { id: 'b', n: 2, type: 'marker', t: 0, text: '', color: '#e6e9ee' },
  { id: 'c', n: 3, type: 'region', t: -5e-3, t2: -1e-4, text: 'fault window', color: '#3fb6ff' },
]

describe('callout files', () => {
  it('round-trips through JSON', () => {
    const json = calloutsToJson('Tek000.tss', 'abc', sample)
    const { callouts, otherFile } = parseCalloutJson(json, 'abc')
    expect(otherFile).toBe(false)
    expect(callouts).toEqual(sample.map((c) => ({ view: undefined, div: undefined, t2: undefined, channel: undefined, dx: undefined, dy: undefined, ...c })))
  })

  it('flags callouts made for another file', () => {
    expect(parseCalloutJson(calloutsToJson('x.tss', 'abc', sample), 'def').otherFile).toBe(true)
  })

  it('drops invalid entries and rejects non-callout files', () => {
    const { callouts } = parseCalloutJson(JSON.stringify({ callouts: [{ type: 'region', t: 1 }, { type: 'bogus', t: 0 }, { type: 'marker', t: 2, color: 'red;x' }] }), undefined)
    expect(callouts).toHaveLength(1)
    expect(callouts[0].type).toBe('marker')
    expect(callouts[0].color).toBe('#e6e9ee')
    expect(() => parseCalloutJson('{"foo":1}', undefined)).toThrow()
  })

  it('numbers new callouts after the highest existing one', () => {
    expect(nextCalloutNumber(sample)).toBe(4)
    expect(nextCalloutNumber([])).toBe(1)
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
