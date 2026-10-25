/**
 * Signal-processing building blocks for math channels. All inputs are uniformly sampled.
 *
 * Invalid samples (NaN, ±Infinity: the gaps of delay(), ln of negative values, a division by 0)
 * stay gaps in the results of the running functions (integral, averages, filters) and never
 * spread beyond them: a single one would otherwise turn the rest of a running sum into NaN.
 */

/** Central-difference derivative (forward/backward at the ends), units per second. */
export function derivative(x: Float32Array, dt: number): Float32Array {
  const n = x.length
  const y = new Float32Array(n)
  if (n < 2) return y
  y[0] = (x[1] - x[0]) / dt
  for (let i = 1; i < n - 1; i++) y[i] = (x[i + 1] - x[i - 1]) / (2 * dt)
  y[n - 1] = (x[n - 1] - x[n - 2]) / dt
  return y
}

/**
 * Running integral from the first valid sample (trapezoidal rule). Across a gap the integral
 * keeps the value it had before it (the gap adds nothing).
 */
export function integral(x: Float32Array, dt: number): Float32Array {
  const y = new Float32Array(x.length)
  let acc = 0
  let prev = NaN
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    if (!Number.isFinite(v)) {
      y[i] = NaN
      prev = NaN
      continue
    }
    if (Number.isFinite(prev)) acc += (prev + v) * 0.5 * dt
    y[i] = acc
    prev = v
  }
  return y
}

/** Centred moving average over `win` samples (shrinks at the ends); averages the valid samples only. */
export function movingAverage(x: Float32Array, win: number): Float32Array {
  const n = x.length
  const half = Math.max(0, Math.floor(win / 2))
  // Running sums of the valid samples and their number
  const sum = new Float64Array(n + 1)
  const count = new Uint32Array(n + 1)
  for (let i = 0; i < n; i++) {
    const ok = Number.isFinite(x[i])
    sum[i + 1] = sum[i] + (ok ? x[i] : 0)
    count[i + 1] = count[i] + (ok ? 1 : 0)
  }
  const y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(x[i])) {
      y[i] = NaN
      continue
    }
    const a = Math.max(0, i - half)
    const b = Math.min(n, i + half + 1)
    y[i] = (sum[b] - sum[a]) / (count[b] - count[a])
  }
  return y
}

/** Centred moving RMS over `win` samples (of the valid samples, as movingAverage). */
export function movingRms(x: Float32Array, win: number): Float32Array {
  const sq = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) sq[i] = x[i] * x[i]
  const m = movingAverage(sq, win)
  for (let i = 0; i < m.length; i++) m[i] = Math.sqrt(m[i])
  return m
}

/**
 * Zero-phase 2nd-order Butterworth filter (applied forward and backward, so the
 * effective order is 4 and there is no time shift). `fc` in Hz, `fs` sample rate. After a gap
 * the filter starts again, as at the first sample.
 */
export function butterworth(x: Float32Array, fs: number, fc: number, type: 'low' | 'high'): Float32Array {
  const w0 = (2 * Math.PI * fc) / fs
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / Math.SQRT2 // Q = 1/sqrt(2)
  const a0 = 1 + alpha
  const b0 = (type === 'low' ? (1 - cos) / 2 : (1 + cos) / 2) / a0
  const b1 = (type === 'low' ? 1 - cos : -(1 + cos)) / a0
  const b2 = b0
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  const dcGain = type === 'low' ? 1 : 0

  const pass = (src: Float32Array | Float64Array, reverse: boolean): Float64Array => {
    const n = src.length
    const out = new Float64Array(n)
    let z1 = 0
    let z2 = 0
    let start = true
    for (let k = 0; k < n; k++) {
      const i = reverse ? n - 1 - k : k
      const xi = src[i]
      if (!Number.isFinite(xi)) {
        out[i] = NaN
        start = true
        continue
      }
      if (start) {
        // Start in steady state for this sample to avoid an edge transient
        const ys = dcGain * xi
        z1 = ys - b0 * xi
        z2 = b2 * xi - a2 * ys
        start = false
      }
      const yi = b0 * xi + z1
      z1 = b1 * xi - a1 * yi + z2
      z2 = b2 * xi - a2 * yi
      out[i] = yi
    }
    return out
  }
  return Float32Array.from(pass(pass(x, false), true))
}

/** Linear interpolation of a signal at time t; NaN outside its record. */
export function sampleAt(data: Float32Array, t0: number, dt: number, t: number): number {
  const x = (t - t0) / dt
  if (x < 0 || x > data.length - 1) return NaN
  const i = Math.floor(x)
  const f = x - i
  return i + 1 < data.length ? data[i] * (1 - f) + data[i + 1] * f : data[i]
}

/** Resample a signal onto another time base. */
export function resample(data: Float32Array, t0: number, dt: number, n: number, nt0: number, ndt: number): Float32Array {
  const y = new Float32Array(n)
  for (let i = 0; i < n; i++) y[i] = sampleAt(data, t0, dt, nt0 + i * ndt)
  return y
}
