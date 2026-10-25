import { describe, expect, it } from 'vitest'
import type { MathInput } from '../math/expr'
import { computeSpectrum } from '../math/fft'
import type { Waveform } from '../model/types'
import { ComputeCore } from './core'
import type { ComputeReply } from './protocol'

const wave = (id: string, f: (i: number) => number, n = 1000): Waveform => ({ id, data: Float32Array.from({ length: n }, (_, i) => f(i)), t0: 0, dt: 1e-6, yUnit: 'V', xUnit: 's' })

const ch1 = wave('CH1', (i) => Math.sin(i / 10))
const ch2 = wave('CH2', () => 1)

/** A core that has been sent the input channels */
function core(...waves: Waveform[]): ComputeCore {
  const c = new ComputeCore()
  c.handle({ type: 'sources', waves })
  return c
}

/** The results of a math request by channel id */
function math(c: ComputeCore, defs: MathInput[], seq = 1) {
  const reply = c.handle({ type: 'math', seq, defs, order: ['CH1', 'CH2'] })!.reply as Extract<ComputeReply, { type: 'math' }>
  expect(reply.seq).toBe(seq)
  return new Map(reply.results.map((o) => [o.id, o]))
}

describe('compute worker', () => {
  it('sends the samples of a result once, with the levels of their pyramid', () => {
    const c = core(ch1, ch2)
    const first = math(c, [{ id: 'MATH1', expr: 'CH1 * 2' }]).get('MATH1')!
    expect(first.wave!.ref).toMatch(/^m:\d+$/)
    expect(first.data![10]).toBeCloseTo(2 * ch1.data[10], 6)
    expect(first.levels!.length).toBeGreaterThan(0)
    // Unchanged but for its unit: the same ref, no samples
    const again = math(c, [{ id: 'MATH1', expr: 'CH1 * 2', unit: 'W' }], 2).get('MATH1')!
    expect(again.wave).toMatchObject({ ref: first.wave!.ref, yUnit: 'W' })
    expect(again.data).toBeUndefined()
  })

  it('names the samples of an input channel instead of sending them', () => {
    const delayed = math(core(ch1), [{ id: 'MATH1', expr: 'delay(CH1, 5u)' }]).get('MATH1')!
    expect(delayed.wave!.ref).toBe('src:CH1')
    expect(delayed.wave!.t0).toBeCloseTo(5e-6, 12)
    expect(delayed.data).toBeUndefined()
  })

  it('computes spectra of the inputs and the current math results', () => {
    const c = core(ch1)
    const ref = math(c, [{ id: 'MATH1', expr: 'CH1 * 2' }]).get('MATH1')!.wave!.ref
    const spectrum = (r: string) => c.handle({ type: 'spectrum', seq: 9, ref: r, dt: 1e-6, i0: 0, i1: 1000, window: 'hann' })!.reply
    const input = spectrum('src:CH1')
    expect(input.type === 'spectrum' && Array.from(input.spec!.rms)).toEqual(Array.from(computeSpectrum(ch1.data, 0, 1000, 1e-6, 'hann')!.rms))
    expect(spectrum(ref)).toMatchObject({ type: 'spectrum', seq: 9, spec: { n: 1024 } })
    // A new expression replaces the samples; an input that was not sent has none
    math(c, [{ id: 'MATH1', expr: 'CH1 * 3' }], 2)
    expect(spectrum(ref)).toEqual({ type: 'spectrum', seq: 9, stale: true })
    expect(spectrum('src:CH2')).toEqual({ type: 'spectrum', seq: 9, stale: true })
  })

  it('reports errors per math channel', () => {
    expect(math(core(ch1), [{ id: 'MATH1', expr: 'CH9 + 1' }]).get('MATH1')).toEqual({ id: 'MATH1', error: 'Unknown channel "CH9"', errorPos: 0, derivedUnit: undefined })
  })
})
