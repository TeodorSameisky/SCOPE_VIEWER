import { describe, expect, it } from 'vitest'
import type { Waveform } from '../model/types'
import { checkSyntax, evaluateMath, parse } from './expr'

const wave = (id: string, f: (t: number) => number, n = 1000, dt = 1e-6, t0 = 0, yUnit = 'V'): Waveform => {
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) data[i] = f(t0 + i * dt)
  return { id, data, t0, dt, yUnit, xUnit: 's' }
}

const one = (expr: string, sources: Waveform[], unit?: string) => evaluateMath([{ id: 'MATH1', expr, unit }], sources).get('MATH1')!

describe('expression parser', () => {
  it('respects precedence and SI suffixes', () => {
    const r = one('2 + 3 * 4 ^ 2 / 8 - -1', [wave('CH1', () => 0)])
    expect(r.wave!.data[0]).toBeCloseTo(9)
    expect(one('10k + 2.5m', [wave('CH1', () => 0)]).wave!.data[0]).toBeCloseTo(10000.0025)
    expect(one('1M / 1m', [wave('CH1', () => 0)]).wave!.data[0]).toBeCloseTo(1e9, -3)
  })

  it('reports syntax errors with position', () => {
    expect(() => parse('CH1 +')).toThrow(/end of expression/)
    expect(checkSyntax('CH1 * (CH2', new Set(['CH1', 'CH2'])).error).toMatch(/"\)"/)
    expect(checkSyntax('CH9 + 1', new Set(['CH1'])).error).toMatch(/Unknown channel "CH9"/)
    expect(checkSyntax('foo(CH1)', new Set(['CH1'])).error).toMatch(/Unknown function/)
    expect(checkSyntax('ch1 - CH2', new Set(['CH1', 'CH2'])).error).toBeUndefined()
  })
})

describe('math channels', () => {
  const ch1 = wave('CH1', (t) => 5 * Math.sin(2 * Math.PI * 1000 * t))
  const ch2 = wave('CH2', () => 2, 1000, 1e-6, 0, 'A')

  it('computes arithmetic and derives units', () => {
    const diff = one('CH1 - 1', [ch1])
    expect(diff.wave!.data[0]).toBeCloseTo(-1)
    expect(diff.wave!.yUnit).toBe('V')
    const p = one('CH1 * CH2', [ch1, ch2])
    expect(p.wave!.yUnit).toBe('W')
    expect(p.wave!.data[250]).toBeCloseTo(10, 3)
    expect(one('CH1 * CH1', [ch1]).wave!.yUnit).toBe('V²')
    expect(one('CH1 / CH1', [ch1]).wave!.yUnit).toBe('')
    expect(one('CH1 * CH2', [ch1, ch2], 'kW').wave!.yUnit).toBe('kW')
  })

  it('differentiates and integrates', () => {
    const ramp = wave('CH1', (t) => 3 * t)
    const d = one('deriv(CH1)', [ramp])
    expect(d.wave!.data[500]).toBeCloseTo(3, 3)
    expect(d.wave!.yUnit).toBe('V/s')
    const i = one('integ(CH2)', [ch2])
    expect(i.wave!.data[999]).toBeCloseTo(2 * 999e-6, 8)
    expect(i.wave!.yUnit).toBe('A·s')
    expect(one('integ(CH1 * CH2)', [ch1, ch2]).wave!.yUnit).toBe('J')
  })

  it('filters', () => {
    // 1 kHz sine + 200 kHz ripple; a 20 kHz low-pass keeps the sine and removes the ripple
    const noisy = wave('CH1', (t) => Math.sin(2 * Math.PI * 1000 * t) + 0.5 * Math.sin(2 * Math.PI * 200000 * t), 4000, 1e-7)
    const lp = one('lowpass(CH1, 20k)', [noisy]).wave!.data
    for (let i = 500; i < 3500; i += 250) expect(lp[i]).toBeCloseTo(Math.sin(2 * Math.PI * 1000 * i * 1e-7), 1)
    const hp = one('highpass(CH1, 50k)', [noisy]).wave!.data
    let maxHp = 0
    for (let i = 500; i < 3500; i++) maxHp = Math.max(maxHp, Math.abs(hp[i]))
    expect(maxHp).toBeGreaterThan(0.4)
    expect(maxHp).toBeLessThan(0.6)
    expect(one('lowpass(CH1, 100M)', [noisy]).error).toMatch(/half the sample rate/)
  })

  it('moving average, rms and delay', () => {
    const sq = wave('CH1', (t) => (Math.floor(t * 1e4) % 2 ? 1 : -1))
    expect(one('avg(CH1, 200u)', [sq]).wave!.data[500]).toBeCloseTo(0, 1)
    expect(one('rms(CH1, 200u)', [sq]).wave!.data[500]).toBeCloseTo(1, 3)
    expect(one('delay(CH1, 5u)', [sq]).wave!.t0).toBeCloseTo(5e-6)
  })

  it('resamples operands with different time bases', () => {
    const fine = wave('CH1', (t) => t * 1e6, 1000, 1e-6)
    const coarse = wave('CH2', (t) => t * 1e6, 100, 1e-5)
    const r = one('CH1 - CH2', [fine, coarse])
    expect(Math.abs(r.wave!.data[505])).toBeLessThan(1e-3)
  })

  it('resolves math-to-math references and reports cycles', () => {
    const res = evaluateMath(
      [
        { id: 'MATH2', expr: 'MATH1 * 2' },
        { id: 'MATH1', expr: 'CH2 + 1' },
        { id: 'MATH3', expr: 'MATH4' },
        { id: 'MATH4', expr: 'MATH3 + 1' },
      ],
      [ch2],
    )
    expect(res.get('MATH2')!.wave!.data[0]).toBeCloseTo(6)
    expect(res.get('MATH3')!.error).toBeTruthy()
    expect(res.get('MATH4')!.error).toBeTruthy()
  })
})
