/**
 * FFT spectrum analysis: radix-2 FFT, window functions, amplitude scaling and peak search.
 * Levels are RMS values in the unit of the source (V → V RMS, shown as dBV = 20·log10(Vrms / 1 V)).
 */

// ---------- FFT ----------

interface FftTables {
  cos: Float64Array
  sin: Float64Array
  rev: Uint32Array
}

const tableCache = new Map<number, FftTables>()

function tables(n: number): FftTables {
  let t = tableCache.get(n)
  if (t) return t
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n)
    sin[i] = Math.sin((2 * Math.PI * i) / n)
  }
  const bits = Math.log2(n)
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1)
    rev[i] = r
  }
  t = { cos, sin, rev }
  // A few sizes are reused while zooming; do not keep every size ever used
  if (tableCache.size > 6) tableCache.delete(tableCache.keys().next().value!)
  tableCache.set(n, t)
  return t
}

export function isPowerOfTwo(n: number): boolean {
  return n >= 1 && Number.isInteger(n) && (n & (n - 1)) === 0
}

export function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

/** In-place complex FFT (iterative radix-2, decimation in time): X[k] = Σ x[n]·e^(−2πi·kn/N). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (!isPowerOfTwo(n) || im.length !== n) throw new Error('FFT length must be a power of two')
  if (n < 2) return
  const { cos, sin, rev } = tables(n)
  for (let i = 0; i < n; i++) {
    const j = rev[i]
    if (j > i) {
      let tmp = re[i]
      re[i] = re[j]
      re[j] = tmp
      tmp = im[i]
      im[i] = im[j]
      im[j] = tmp
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2
    const step = n / size
    for (let start = 0; start < n; start += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = cos[k]
        const wi = -sin[k]
        const a = start + j
        const b = a + half
        const xr = re[b] * wr - im[b] * wi
        const xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
}

/**
 * Magnitudes |X[k]|, k = 0 … N/2, of the FFT of a real signal of length N (a power of two).
 * Uses one complex FFT of half the length (even samples as real, odd samples as imaginary part).
 */
export function realFftMagnitude(x: Float64Array): Float64Array {
  const n = x.length
  if (!isPowerOfTwo(n) || n < 2) throw new Error('FFT length must be a power of two ≥ 2')
  const m = n / 2
  const re = new Float64Array(m)
  const im = new Float64Array(m)
  for (let i = 0; i < m; i++) {
    re[i] = x[2 * i]
    im[i] = x[2 * i + 1]
  }
  fft(re, im)
  const mag = new Float64Array(m + 1)
  // k = 0 and k = N/2 come from Z[0] alone
  mag[0] = Math.abs(re[0] + im[0])
  mag[m] = Math.abs(re[0] - im[0])
  // Twiddle factor W^k = e^(−iπk/m), advanced by rotation and recomputed now and then to stay exact
  const cd = Math.cos(Math.PI / m)
  const sd = Math.sin(Math.PI / m)
  let wr = 1
  let wi = 0
  for (let k = 1; k < m; k++) {
    if ((k & 1023) === 0) {
      wr = Math.cos((Math.PI * k) / m)
      wi = -Math.sin((Math.PI * k) / m)
    } else {
      const t = wr * cd + wi * sd
      wi = wi * cd - wr * sd
      wr = t
    }
    const a = re[k]
    const b = im[k]
    const c = re[m - k]
    const d = im[m - k]
    // Split Z into the spectra of the even (E) and odd (O) samples, then X = E + W^k·O
    const er = (a + c) / 2
    const ei = (b - d) / 2
    const or = (b + d) / 2
    const oi = (c - a) / 2
    const xr = er + wr * or - wi * oi
    const xi = ei + wr * oi + wi * or
    mag[k] = Math.sqrt(xr * xr + xi * xi)
  }
  return mag
}

// ---------- windows ----------

export type WindowKind = 'rect' | 'hann' | 'hamming' | 'blackmanHarris' | 'flatTop'

export interface WindowDef {
  key: WindowKind
  label: string
  /** Cosine-sum coefficients: w[n] = Σ (−1)^k · a_k · cos(2πkn/N) */
  coeffs: number[]
  /** Equivalent noise bandwidth in bins */
  enbw: number
  /** Worst-case amplitude error for a tone half-way between two bins (dB) */
  scallopDb: number
  /** Highest side lobe relative to the main lobe (dB) */
  sidelobeDb: number
  /** Half-width of the main lobe up to its first zero, in bins */
  lobeBins: number
  use: string
}

// ENBW, scalloping loss and side lobe levels are checked against the coefficients in fft.test.ts
export const WINDOW_DEFS: WindowDef[] = [
  {
    key: 'rect',
    label: 'Rectangular',
    coeffs: [1],
    enbw: 1,
    scallopDb: 3.92,
    sidelobeDb: -13.3,
    lobeBins: 1,
    use: 'No weighting. Best frequency resolution, but strong leakage: use for transients shorter than the range, or for tones that complete a whole number of periods in it.',
  },
  {
    key: 'hann',
    label: 'Hann',
    coeffs: [0.5, 0.5],
    enbw: 1.5,
    scallopDb: 1.42,
    sidelobeDb: -31.5,
    lobeBins: 2,
    use: 'Good general-purpose choice: narrow peaks and side lobes that fall off quickly. Use for noise, harmonics and periodic signals.',
  },
  {
    key: 'hamming',
    label: 'Hamming',
    coeffs: [0.54, 0.46],
    enbw: 1.36,
    scallopDb: 1.75,
    sidelobeDb: -42.7,
    lobeBins: 2,
    use: 'Like Hann with a slightly narrower peak and a lower first side lobe, but the far side lobes stay higher. Separates two close tones of similar level.',
  },
  {
    key: 'blackmanHarris',
    label: 'Blackman-Harris',
    coeffs: [0.35875, 0.48829, 0.14128, 0.01168],
    enbw: 2,
    scallopDb: 0.83,
    sidelobeDb: -92,
    lobeBins: 4,
    use: 'Very low leakage (−92 dB) with wider peaks. Use to find small spurs or harmonics next to a strong tone.',
  },
  {
    key: 'flatTop',
    label: 'Flat-top',
    coeffs: [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368],
    enbw: 3.77,
    scallopDb: 0.01,
    sidelobeDb: -93,
    lobeBins: 5,
    use: 'Accurate amplitudes (error < 0.02 dB wherever the tone falls between bins) but very wide peaks. Use to measure the level of tones and harmonics.',
  },
]

export const DEFAULT_WINDOW: WindowKind = 'hann'

export function windowDef(kind: WindowKind): WindowDef {
  return WINDOW_DEFS.find((w) => w.key === kind) ?? WINDOW_DEFS[1]
}

export function isWindowKind(v: unknown): v is WindowKind {
  return WINDOW_DEFS.some((w) => w.key === v)
}

const windowCache = new Map<string, Float64Array>()

/** Periodic (DFT-even) window of length n. */
export function windowCoefficients(kind: WindowKind, n: number): Float64Array {
  const key = `${kind}:${n}`
  const hit = windowCache.get(key)
  if (hit) return hit
  const a = windowDef(kind).coeffs
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    // cos(kx) from cos(x) with the Chebyshev recurrence: one cosine per sample
    const c = Math.cos((2 * Math.PI * i) / n)
    let prev = 1
    let ck = c
    let v = a[0]
    for (let k = 1; k < a.length; k++) {
      v += (k % 2 ? -1 : 1) * a[k] * ck
      const next = 2 * c * ck - prev
      prev = ck
      ck = next
    }
    w[i] = v
  }
  if (windowCache.size > 8) windowCache.delete(windowCache.keys().next().value!)
  windowCache.set(key, w)
  return w
}

// ---------- spectrum ----------

/** Largest FFT length; longer ranges are decimated first */
export const MAX_FFT = 2 ** 20
/** Fewest samples a spectrum is computed from */
export const MIN_FFT_SAMPLES = 16

export interface Spectrum {
  /** RMS level per bin (source unit), bins 0 … n/2 */
  rms: Float32Array
  /** Bin spacing (Hz) */
  df: number
  /** FFT length (after zero padding) */
  n: number
  /** Samples taken from the source range */
  samples: number
  /** Samples that went into the FFT (after decimation, before zero padding) */
  used: number
  /** Factor the samples were decimated by to fit into MAX_FFT (1 = none) */
  decimation: number
  /** Sample rate of the FFT input (Hz) */
  sampleRate: number
  /** Resolution bandwidth = equivalent noise bandwidth of the window (Hz) */
  rbw: number
  window: WindowKind
}

/**
 * Spectrum of data[i0 … i1) sampled every dt seconds.
 *
 * The samples are weighted with the window and zero-padded to the next power of two. More than
 * `maxN` samples are first averaged in blocks of `decimation` samples (like Hi-Res acquisition),
 * which lowers the sample rate and with it the highest frequency shown.
 * The result is scaled so that a sine of amplitude A reads A/√2 (its RMS value) at its frequency
 * and a DC level reads its value, whatever the window.
 */
export function computeSpectrum(data: Float32Array, i0: number, i1: number, dt: number, kind: WindowKind, maxN = MAX_FFT): Spectrum | undefined {
  const a = Math.max(0, Math.ceil(i0))
  const b = Math.min(data.length, Math.floor(i1))
  const samples = b - a
  if (samples < MIN_FFT_SAMPLES || !(dt > 0)) return undefined
  const decimation = Math.ceil(samples / maxN)
  const used = Math.floor(samples / decimation)
  const n = nextPowerOfTwo(used)
  const w = windowCoefficients(kind, used)
  const x = new Float64Array(n)
  let wSum = 0
  for (let j = 0; j < used; j++) {
    let v: number
    if (decimation === 1) v = data[a + j]
    else {
      v = 0
      const s = a + j * decimation
      for (let k = 0; k < decimation; k++) v += data[s + k]
      v /= decimation
    }
    x[j] = v * w[j]
    wSum += w[j]
  }
  const mag = realFftMagnitude(x)
  const rms = new Float32Array(mag.length)
  const scale = Math.SQRT2 / wSum
  for (let k = 0; k < mag.length; k++) rms[k] = mag[k] * scale
  // DC and Nyquist are real: no factor √2
  rms[0] = mag[0] / wSum
  rms[mag.length - 1] = mag[mag.length - 1] / wSum
  const sampleRate = 1 / (dt * decimation)
  return { rms, df: sampleRate / n, n, samples, used, decimation, sampleRate, rbw: (windowDef(kind).enbw * sampleRate) / used, window: kind }
}

/** Level in dB relative to 1 unit RMS (dBV for volts); −∞ for 0 */
export function toDb(rms: number): number {
  return 20 * Math.log10(rms)
}

/**
 * A peak must be this far above the median level (15 dB): the bins of pure noise follow a
 * Rayleigh distribution and even the highest of a million stay about 13 dB above the median.
 */
const PEAK_ABOVE_MEDIAN = Math.pow(10, 15 / 20)
/** …and this far (6 dB) above the leakage of any higher peak: closer to it, noise on a side lobe looks like a peak */
const PEAK_ABOVE_LEAKAGE = 2

const LEAK_RES = 16
const LEAK_BINS = 128
const responseCache = new Map<WindowKind, { response: Float64Array; envelope: Float64Array }>()

/**
 * Amplitude response of a window to a tone `d` bins away, relative to a tone on the bin, sampled
 * every 1/LEAK_RES bin up to LEAK_BINS bins; and its envelope (highest response at d or more bins).
 */
function windowResponse(kind: WindowKind) {
  let r = responseCache.get(kind)
  if (!r) {
    // Long enough that the response 128 bins out is that of a long window (a short one reads ~π/2 low there)
    const m = 2048
    const x = new Float64Array(m * LEAK_RES)
    x.set(windowCoefficients(kind, m))
    const mag = realFftMagnitude(x)
    // Two bins beyond the table so its last envelope value is a side lobe peak, not a zero
    const response = new Float64Array((LEAK_BINS + 2) * LEAK_RES + 1)
    const envelope = new Float64Array(response.length)
    let max = 0
    for (let i = response.length - 1; i >= 0; i--) {
      response[i] = mag[i] / mag[0]
      max = Math.max(max, response[i])
      envelope[i] = max
    }
    r = { response, envelope }
    responseCache.set(kind, r)
  }
  return r
}

/** Highest response of a window at `d` or more bins from a tone, relative to the tone (main lobe and side lobes). */
export function leakage(kind: WindowKind, d: number): number {
  const env = windowResponse(kind).envelope
  // Beyond the table: side lobes fall off at least 6 dB per octave
  if (d >= LEAK_BINS) return (env[LEAK_BINS * LEAK_RES] * LEAK_BINS) / d
  return env[Math.max(0, Math.floor(d * LEAK_RES))]
}

/** Amplitude response of a window to a tone `d` bins away (|d| < 128), relative to a tone on the bin */
export function windowGain(kind: WindowKind, d: number): number {
  const resp = windowResponse(kind).response
  const x = Math.min(LEAK_BINS - 1, Math.abs(d)) * LEAK_RES
  const i = Math.floor(x)
  return resp[i] + (resp[i + 1] - resp[i]) * (x - i)
}

export interface Peak {
  /** Interpolated frequency (Hz) */
  freq: number
  /** Interpolated RMS level */
  rms: number
  bin: number
}

/**
 * The `count` highest peaks between bins k0 and k1 (inclusive), highest first.
 *
 * A peak is a local maximum at least 15 dB above the median level of the range (so noise is not
 * listed) that rises above the main lobe and side lobes of every higher peak and of the DC level
 * (so the window's own leakage is not listed either). The frequency is refined with a parabola through the dB levels of
 * the three bins around the maximum, the level by undoing the window's response at that offset
 * from the bin (its scalloping loss).
 */
export function findPeaks(s: Spectrum, count: number, k0 = 1, k1 = s.rms.length - 1): Peak[] {
  const r = s.rms
  const lo = Math.max(1, Math.floor(k0))
  const hi = Math.min(r.length - 2, Math.ceil(k1))
  if (count <= 0 || hi < lo) return []
  const threshold = median(r, lo, hi + 1) * PEAK_ABOVE_MEDIAN
  const candidates: number[] = []
  for (let k = lo; k <= hi; k++) {
    const v = r[k]
    if (v > threshold && v > r[k - 1] && v >= r[k + 1]) candidates.push(k)
  }
  candidates.sort((p, q) => r[q] - r[p])
  // FFT bins per frequency-resolution bin (zero padding makes a lobe span more FFT bins)
  const pad = s.n / s.used
  // The DC level leaks like a tone at 0 Hz (DC reads without the factor √2 of the other bins)
  const dcLeak = (k: number) => Math.SQRT2 * r[0] * leakage(s.window, k / pad) * PEAK_ABOVE_LEAKAGE
  const picked: number[] = []
  for (const k of candidates) {
    if (r[k] < dcLeak(k)) continue
    if (picked.some((p) => r[k] < r[p] * leakage(s.window, Math.abs(k - p) / pad) * PEAK_ABOVE_LEAKAGE)) continue
    picked.push(k)
    if (picked.length >= count) break
  }
  return picked.map((k) => {
    const al = toDb(r[k - 1])
    const be = toDb(r[k])
    const ga = toDb(r[k + 1])
    const den = al - 2 * be + ga
    const p = Number.isFinite(den) && den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (al - ga)) / den)) : 0
    return { freq: (k + p) * s.df, rms: r[k] / windowGain(s.window, Math.min(1, Math.abs(p / pad))), bin: k }
  })
}

function median(r: Float32Array, a: number, b: number): number {
  const n = b - a
  if (n <= 0) return 0
  // Large ranges: a strided sample is precise enough for a threshold
  const stride = Math.max(1, Math.floor(n / 4096))
  const vals: number[] = []
  for (let k = a; k < b; k += stride) vals.push(r[k])
  vals.sort((x, y) => x - y)
  return vals[Math.floor(vals.length / 2)]
}
