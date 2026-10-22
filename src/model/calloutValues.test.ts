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

  it('says so when the measured channel has no waveform', () => {
    expect(calloutValueText({ ...base, type: 'region', t2: 1, measure: { channel: 'MATH1', keys: ['mean'] } }, [ramp])).toBe('Math 1: no waveform')
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
    const [marker] = sanitizeCallouts([{ ...base, type: 'marker', showValue: true, measure: { channel: 'CH1', keys: ['max'] } }])
    expect(marker.showValue).toBeUndefined()
    expect(marker.measure).toBeUndefined()
  })
})
