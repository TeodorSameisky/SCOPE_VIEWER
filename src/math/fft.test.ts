import { describe, expect, it } from 'vitest'
import { WINDOW_DEFS, computeSpectrum, fft, findPeaks, nextPowerOfTwo, realFftMagnitude, toDb, windowCoefficients, type WindowKind } from './fft'

/** Deterministic pseudo-random numbers (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Gaussian noise (Box-Muller) */
function gauss(seed: number) {
  const r = rng(seed)
  return () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
}

const sine = (n: number, fs: number, f: number, amp: number, offset = 0, phase = 0.3) =>
  Float32Array.from({ length: n }, (_, i) => offset + amp * Math.sin(2 * Math.PI * f * (i / fs) + phase))

function naiveDft(re: number[], im: number[]): { re: number[]; im: number[] } {
  const n = re.length
  const out = { re: new Array<number>(n).fill(0), im: new Array<number>(n).fill(0) }
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      const th = (-2 * Math.PI * k * j) / n
      out.re[k] += re[j] * Math.cos(th) - im[j] * Math.sin(th)
      out.im[k] += re[j] * Math.sin(th) + im[j] * Math.cos(th)
    }
  }
  return out
}

const KINDS = WINDOW_DEFS.map((w) => w.key)

describe('radix-2 FFT', () => {
  it('matches a direct DFT', () => {
    const r = rng(1)
    const re = Array.from({ length: 64 }, () => r() - 0.5)
    const im = Array.from({ length: 64 }, () => r() - 0.5)
    const want = naiveDft(re, im)
    const xr = Float64Array.from(re)
    const xi = Float64Array.from(im)
    fft(xr, xi)
    for (let k = 0; k < 64; k++) {
      expect(xr[k]).toBeCloseTo(want.re[k], 10)
      expect(xi[k]).toBeCloseTo(want.im[k], 10)
    }
  })

  it('computes real-input magnitudes with a half-length FFT', () => {
    const r = rng(2)
    for (const n of [2, 4, 128]) {
      const x = Array.from({ length: n }, () => r() - 0.5)
      const want = naiveDft(x, new Array(n).fill(0))
      const mag = realFftMagnitude(Float64Array.from(x))
      expect(mag.length).toBe(n / 2 + 1)
      for (let k = 0; k <= n / 2; k++) expect(mag[k]).toBeCloseTo(Math.hypot(want.re[k], want.im[k]), 10)
    }
  })

  it('rejects other lengths', () => {
    expect(() => fft(new Float64Array(12), new Float64Array(12))).toThrow(/power of two/)
    expect(nextPowerOfTwo(250000)).toBe(262144)
    expect(nextPowerOfTwo(1024)).toBe(1024)
  })
})

describe('window functions', () => {
  it.each(KINDS)('%s has the documented ENBW, scalloping loss and side lobes', (kind) => {
    const def = WINDOW_DEFS.find((w) => w.key === kind)!
    const n = 1024
    const w = windowCoefficients(kind, n)
    let s = 0
    let s2 = 0
    for (const v of w) {
      s += v
      s2 += v * v
    }
    expect((n * s2) / (s * s)).toBeCloseTo(def.enbw, 2)
    // Response half a bin off centre
    let re = 0
    let im = 0
    for (let i = 0; i < n; i++) {
      re += w[i] * Math.cos((Math.PI * i) / n)
      im += w[i] * Math.sin((Math.PI * i) / n)
    }
    expect(Math.abs(20 * Math.log10(s / Math.hypot(re, im)) - def.scallopDb)).toBeLessThan(0.01)
    // Side lobes from a finely zero-padded transform of the window
    const z = 32
    const x = new Float64Array(n * z)
    x.set(w)
    const m = realFftMagnitude(x)
    let side = 0
    for (let k = Math.round((def.lobeBins + 0.05) * z); k < m.length; k++) side = Math.max(side, m[k])
    expect(Math.abs(toDb(side / m[0]) - def.sidelobeDb)).toBeLessThan(0.1)
  })
})

describe('spectrum of known sines', () => {
  const fs = 1e6

  it.each(KINDS)('%s: exact level of a tone on a bin and of DC', (kind) => {
    const n = 4096
    const f = (200 * fs) / n
    const s = computeSpectrum(sine(n, fs, f, 2, 1.5), 0, n, 1 / fs, kind)!
    expect(s.n).toBe(n)
    expect(s.df).toBeCloseTo(fs / n)
    expect(toDb(s.rms[200])).toBeCloseTo(toDb(2 / Math.SQRT2), 3) // 3.01 dBV
    expect(s.rms[0]).toBeCloseTo(1.5, 4)
  })

  it('zero-pads to the next power of two', () => {
    const s = computeSpectrum(sine(10000, fs, 12345.6, 0.5), 0, 10000, 1 / fs, 'hann')!
    expect(s.n).toBe(16384)
    expect(s.used).toBe(10000)
    expect(s.df).toBeCloseTo(fs / 16384)
    expect(s.rbw).toBeCloseTo((1.5 * fs) / 10000)
  })

  // Worst errors of the interpolated peak: frequency in FFT bins, level in dB
  const PEAK_TOL: Record<WindowKind, { f: number; db: number }> = {
    rect: { f: 0.2, db: 1.5 },
    hann: { f: 0.03, db: 0.1 },
    hamming: { f: 0.03, db: 0.1 },
    blackmanHarris: { f: 0.01, db: 0.02 },
    flatTop: { f: 0.2, db: 0.02 },
  }
  it.each(KINDS)('%s: peak frequency and level of a tone between bins', (kind) => {
    for (const n of [1000, 4096, 10000]) {
      for (const offset of [0, 0.13, 0.25, 0.37, 0.5, 0.71, 0.9]) {
        const f = ((123 + offset) * fs) / n
        const s = computeSpectrum(sine(n, fs, f, 0.5), 0, n, 1 / fs, kind)!
        const [p] = findPeaks(s, 1)
        expect(Math.abs(p.freq - f) / s.df).toBeLessThan(PEAK_TOL[kind].f)
        expect(Math.abs(toDb(p.rms) - toDb(0.5 / Math.SQRT2))).toBeLessThan(PEAK_TOL[kind].db)
      }
    }
  })

  it('flat-top reads the level within 0.02 dB wherever the tone falls', () => {
    const n = 4096
    for (const offset of [0, 0.1, 0.25, 0.4, 0.5]) {
      const f = ((300 + offset) * fs) / n
      const s = computeSpectrum(sine(n, fs, f, 1), 0, n, 1 / fs, 'flatTop')!
      const best = Math.max(s.rms[300], s.rms[301])
      expect(Math.abs(toDb(best) - toDb(Math.SQRT1_2))).toBeLessThan(0.02)
    }
  })

  it.each(KINDS)('%s: leakage of a strong tone stays below the side lobe level', (kind) => {
    const def = WINDOW_DEFS.find((w) => w.key === kind)!
    const n = 4096
    const k0 = 1000.5 // worst case for leakage: half-way between bins
    const s = computeSpectrum(sine(n, fs, (k0 * fs) / n, 1), 0, n, 1 / fs, kind)!
    let leak = 0
    for (let k = 1; k < s.rms.length; k++) if (Math.abs(k - k0) > def.lobeBins + 1) leak = Math.max(leak, s.rms[k])
    const leakDbc = toDb(leak / Math.SQRT1_2)
    expect(leakDbc).toBeLessThan(def.sidelobeDb + 0.5)
    // The rectangular window leaks strongly, the others are much cleaner
    if (kind === 'rect') expect(leakDbc).toBeGreaterThan(-20)
    if (kind === 'blackmanHarris' || kind === 'flatTop') expect(leakDbc).toBeLessThan(-90)
  })

  it.each(KINDS)('%s: white noise floor matches the window ENBW', (kind: WindowKind) => {
    const def = WINDOW_DEFS.find((w) => w.key === kind)!
    const n = 16384
    const sigma = 0.01
    const g = gauss(7)
    const x = Float32Array.from({ length: n }, () => sigma * g())
    const s = computeSpectrum(x, 0, n, 1 / fs, kind)!
    let p = 0
    for (let k = 1; k < n / 2; k++) p += s.rms[k] ** 2
    p /= n / 2 - 1
    // Each bin collects the noise in one ENBW: Vrms² = σ² · ENBW / (N/2)
    const want = (sigma * sigma * def.enbw) / (n / 2)
    expect(Math.abs(10 * Math.log10(p / want))).toBeLessThan(0.3)
  })
})

describe('spectrum range and decimation', () => {
  const fs = 25e6

  it('uses only the requested samples', () => {
    const x = new Float32Array(1000)
    x.fill(1, 500)
    expect(computeSpectrum(x, 0, 500, 1 / fs, 'rect')!.rms[0]).toBeCloseTo(0)
    const s = computeSpectrum(x, 499.4, 1200, 1 / fs, 'rect')!
    expect(s.samples).toBe(500)
    expect(s.rms[0]).toBeCloseTo(1)
    expect(computeSpectrum(x, 10, 20, 1 / fs, 'hann')).toBeUndefined()
  })

  it('decimates ranges longer than the FFT length', () => {
    const n = 10000
    const f = 50e3
    const s = computeSpectrum(sine(n, fs, f, 1), 0, n, 1 / fs, 'flatTop', 2048)!
    expect(s.decimation).toBe(5)
    expect(s.used).toBe(2000)
    expect(s.n).toBe(2048)
    expect(s.sampleRate).toBeCloseTo(fs / 5)
    const [p] = findPeaks(s, 1)
    expect(Math.abs(p.freq - f)).toBeLessThan(0.1 * s.df)
    expect(toDb(p.rms)).toBeCloseTo(toDb(Math.SQRT1_2), 1)
  })
})

describe('peak search', () => {
  const fs = 1e6
  const n = 8192

  it('lists the highest peaks once each, highest first', () => {
    const a = sine(n, fs, 10e3, 1)
    const b = sine(n, fs, 23.4e3, 0.1)
    const c = sine(n, fs, 30e3, 0.03)
    const g = gauss(3)
    const x = a.map((v, i) => v + b[i] + c[i] + 1e-4 * g())
    const s = computeSpectrum(x, 0, n, 1 / fs, 'flatTop')!
    const peaks = findPeaks(s, 5)
    expect(peaks).toHaveLength(3)
    expect(peaks.map((p) => Math.round(p.freq / 100) * 100)).toEqual([10e3, 23.4e3, 30e3])
    expect(toDb(peaks[1].rms) - toDb(peaks[0].rms)).toBeCloseTo(-20, 1)
    // Limited to a frequency range
    const k = (f: number) => f / s.df
    expect(findPeaks(s, 5, k(20e3), k(40e3)).map((p) => Math.round(p.freq / 100) * 100)).toEqual([23.4e3, 30e3])
  })

  it('does not list the skirt of a large DC level', () => {
    const g = gauss(5)
    const tone = sine(n, fs, 50e3, 0.01)
    const x = tone.map((v) => 4 + v + 1e-5 * g())
    for (const kind of KINDS.filter((k) => k !== 'rect')) {
      const peaks = findPeaks(computeSpectrum(x, 0, n, 1 / fs, kind)!, 5)
      expect(peaks.map((p) => Math.round(p.freq / 1e3))).toEqual([50])
    }
  })

  it('finds nothing in plain noise', () => {
    const g = gauss(4)
    const x = Float32Array.from({ length: n }, () => g())
    expect(findPeaks(computeSpectrum(x, 0, n, 1 / fs, 'hann')!, 5)).toEqual([])
  })
})
