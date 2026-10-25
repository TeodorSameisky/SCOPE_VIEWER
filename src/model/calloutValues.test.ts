import { describe, expect, it } from 'vitest'
import { sanitizeCallouts, type Callout } from './callouts'
import { calloutValueText } from './calloutValues'
import type { Waveform } from './types'

const wave = (id: string, data: number[], dt = 1e-3): Waveform => ({ id, data: Float32Array.from(data), t0: 0, dt, yUnit: 'V', xUnit: 's' })
const base: Callout = { id: 'a', n: 1, type: 'note', t: 0, text: '', color: '#fff' }

describe('calloutValueText', () => {
  const ramp = wave('CH1', [0, 1, 2, 3, 4])

  it('shows the value of the trace at the anchor of a note', () => {
    expect(calloutValueText({ ...base, channel: 'CH1', t: 2e-3, showValue: true }, [ramp])).toBe('Ch 1 = 2.000 V at t = 2.0000 ms')
  })

  it('shows only the time for a note that is not on a trace', () => {
    expect(calloutValueText({ ...base, view: 0, div: 1, t: 1e-3, showValue: true }, [ramp])).toBe('t = 1.0000 ms')
  })

  it('shows nothing unless asked', () => {
    expect(calloutValueText({ ...base, channel: 'CH1' }, [ramp])).toBeUndefined()
    expect(calloutValueText({ ...base, type: 'region', t2: 1, measure: { channel: 'CH1', keys: [] } }, [ramp])).toBeUndefined()
  })

  it('measures a channel over the span of a region', () => {
    // 0 V for 1 ms, then 4 V: only samples 1…3 (1 ms … 3 ms) are inside the region
    const step = wave('CH2', [0, 0, 4, 4, 4])
    const region: Callout = { ...base, type: 'region', t: 3e-3, t2: 1e-3, measure: { channel: 'CH2', keys: ['max', 'min', 'pkpk'] } }
    expect(calloutValueText(region, [step])).toBe('Ch 2: max 4.000 V · min 0 V · pk-pk 4.000 V')
  })

  it('measures the samples of the span with the measurer it is given, which may not have them yet', () => {
    const step = wave('CH2', [0, 0, 4, 4, 4])
    const region: Callout = { ...base, id: 'r1', type: 'region', t: 3e-3, t2: 1e-3, measure: { channel: 'CH2', keys: ['pkpk'] } }
    const asked: unknown[] = []
    // Still being measured (in the worker)
    expect(calloutValueText(region, [step], (w, i0, i1, id) => void asked.push([w.id, i0, i1, id]))).toBe('Ch 2: measuring…')
    expect(asked).toEqual([['CH2', 1, 4, 'r1']])
  })

  it('says so when the measured channel has no waveform', () => {
    expect(calloutValueText({ ...base, type: 'region', t2: 1, measure: { channel: 'MATH1', keys: ['mean'] } }, [ramp])).toBe('Math 1: no waveform')
  })

  it('measures a box over its time span, like a region', () => {
    const step = wave('CH2', [0, 0, 4, 4, 4])
    const box: Callout = { ...base, type: 'box', t: 1e-3, t2: 3e-3, channel: 'CH2', v: 5, v2: -1, measure: { channel: 'CH2', keys: ['pkpk'] } }
    expect(calloutValueText(box, [step])).toBe('Ch 2: pk-pk 4.000 V')
  })

  it('shows Δv between the ends of a span and 1/Δt', () => {
    const step = wave('CH2', [0, 0, 4, 4, 4])
    const span: Callout = { ...base, type: 'span', t: 1e-3, t2: 3e-3, channel: 'CH1', channel2: 'CH2', showValue: true }
    // CH1 is 1 V at 1 ms, CH2 4 V at 3 ms
    expect(calloutValueText(span, [ramp, step])).toBe('Δv 3.000 V · 1/Δt 500.0 Hz')
    // Channels in different units: no Δv
    expect(calloutValueText(span, [ramp, { ...step, yUnit: 'A' }])).toBe('1/Δt 500.0 Hz')
    expect(calloutValueText({ ...span, showValue: undefined }, [ramp, step])).toBeUndefined()
  })
})

describe('sanitizeCallouts', () => {
  it('keeps the value options of notes and regions', () => {
    const [note, region] = sanitizeCallouts([
      { ...base, showValue: true },
      { ...base, id: 'b', type: 'region', t2: 1, measure: { channel: 'CH1', keys: ['rms', 'bogus', 'max'] } },
    ])
    expect(note.showValue).toBe(true)
    // unknown keys are dropped, the rest in the order of the measurement list
    expect(region.measure).toEqual({ channel: 'CH1', keys: ['max', 'rms'] })
  })

  it('drops options that do not fit the type', () => {
    const [marker] = sanitizeCallouts([{ ...base, type: 'marker', showValue: true, measure: { channel: 'CH1', keys: ['max'] }, shape: 'ellipse', v: 1 }])
    expect(marker.showValue).toBeUndefined()
    expect(marker.measure).toBeUndefined()
    expect(marker.shape).toBeUndefined()
    expect(marker.v).toBeUndefined()
  })

  it('keeps boxes on a channel or in a view, and spans between two channels', () => {
    const [box, free, span] = sanitizeCallouts([
      { ...base, type: 'box', t2: 1, channel: 'CH1', v: 2, v2: -1, shape: 'ellipse', measure: { channel: 'CH1', keys: ['max'] } },
      { ...base, id: 'b', type: 'box', t2: 1, view: 1, div: 2, div2: -2 },
      { ...base, id: 'c', type: 'span', t2: 1, channel: 'CH1', channel2: 'CH2', dy: 30, showValue: true },
    ])
    expect(box).toMatchObject({ channel: 'CH1', v: 2, v2: -1, shape: 'ellipse', measure: { channel: 'CH1', keys: ['max'] } })
    expect(free).toMatchObject({ view: 1, div: 2, div2: -2 })
    expect(free.shape).toBeUndefined()
    expect(span).toMatchObject({ channel: 'CH1', channel2: 'CH2', dy: 30, showValue: true })
  })

  it('drops boxes and spans that cannot be placed', () => {
    const list = sanitizeCallouts([
      { ...base, type: 'box', t2: 1, channel: 'CH1', v: 2 },
      { ...base, type: 'box', channel: 'CH1', v: 2, v2: 1 },
      { ...base, type: 'span', t2: 1, channel: 'CH1' },
      { ...base, type: 'circle', t2: 1 },
    ])
    expect(list).toEqual([])
  })
})
