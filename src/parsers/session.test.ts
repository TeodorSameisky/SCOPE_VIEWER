import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadFiles } from './session'
import { measure } from '../dsp/measure'
import { computeSpectrum, findPeaks } from '../math/fft'

// The example session is kept out of git; these tests only run where it exists locally.
const samplePath = new URL('../../SessionSample/Tek000.tss', import.meta.url)
const hasSample = existsSync(samplePath)

describe.skipIf(!hasSample)('Tektronix .tss session (SessionSample/Tek000.tss)', () => {
  const sample = hasSample ? readFileSync(samplePath) : Buffer.alloc(0)
  const buf = sample.buffer.slice(sample.byteOffset, sample.byteOffset + sample.byteLength)
  const s = hasSample ? loadFiles([{ name: 'Tek000.tss', data: buf }]) : undefined!

  it('reads all six channels', () => {
    expect(s.channels.map((c) => c.wave.id)).toEqual(['CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6'])
    for (const c of s.channels) {
      expect(c.wave.data.length).toBe(250000)
      expect(c.wave.dt).toBeCloseTo(40e-9, 15)
      expect(c.wave.t0).toBeCloseTo(-7.95e-3, 9)
    }
  })

  it('matches the measurements shown on the scope', () => {
    const max = (id: string) => s.channels.find((c) => c.wave.id === id)!.wave.data.reduce((m, v) => Math.max(m, v), -Infinity)
    expect(max('CH1')).toBeCloseTo(12.77, 2)
    expect(max('CH4')).toBeCloseTo(5.238, 3)
  })

  it('measures edges but not noise on the real signals', () => {
    const ch = (id: string) => s.channels.find((c) => c.wave.id === id)!.wave
    const whole = (id: string) => measure(ch(id).data, 0, ch(id).data.length, ch(id).t0, ch(id).dt)
    expect(whole('CH6').riseTime).toBeGreaterThan(1e-6)
    expect(whole('CH4').riseTime).toBeGreaterThan(1e-6)
    // CH1 before the event (-7.9 ms .. -5.5 ms) is a flat line with noise
    const w = ch('CH1')
    const i0 = (-7.9e-3 - w.t0) / w.dt
    const i1 = (-5.5e-3 - w.t0) / w.dt
    const flat = measure(w.data, i0, i1, w.t0, w.dt)
    expect(flat.levelsOk).toBe(false)
    expect(flat.frequency).toBeNaN()
  })

  it('computes the spectrum of a channel over the whole record', () => {
    const w = s.channels.find((c) => c.wave.id === 'CH4')!.wave
    const spec = computeSpectrum(w.data, 0, w.data.length, w.dt, 'hann')!
    expect(spec.n).toBe(262144)
    expect(spec.sampleRate).toBeCloseTo(25e6, -3)
    expect(spec.df).toBeCloseTo(25e6 / 262144, 3)
    expect(spec.rms.every(Number.isFinite)).toBe(true)
    // DC bin = mean of the windowed record, a few volts for this signal
    expect(spec.rms[0]).toBeGreaterThan(1)
    expect(findPeaks(spec, 5).length).toBeGreaterThan(0)
  })

  it('applies the setup', () => {
    expect(s.views).toEqual([['CH1', 'CH6', 'CH2'], ['CH4', 'CH5', 'CH3']])
    const ch5 = s.channels.find((c) => c.wave.id === 'CH5')!.display
    expect(ch5.label).toBe('STO STAT')
    expect(ch5.scale).toBe(1)
    expect(ch5.offset).toBeCloseTo(1.7)
    expect(s.horizontal?.scale).toBe(1e-3)
    expect(s.cursors?.a).toBeCloseTo(-5.588e-3, 6)
    expect(s.screenshot).toBeDefined()
  })
})
