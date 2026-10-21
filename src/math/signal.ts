/** Signal-processing building blocks for math channels. All inputs are uniformly sampled. */

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

/** Running integral from the first sample (trapezoidal rule). */
export function integral(x: Float32Array, dt: number): Float32Array {
  const y = new Float32Array(x.length)
  let acc = 0
  for (let i = 1; i < x.length; i++) {
    acc += (x[i - 1] + x[i]) * 0.5 * dt
    y[i] = acc
  }
  return y
}

/** Centred moving average over `win` samples (shrinks at the ends). */
export function movingAverage(x: Float32Array, win: number): Float32Array {
  const n = x.length
  const half = Math.max(0, Math.floor(win / 2))
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i]
  const y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(n, i + half + 1)
    y[i] = (prefix[b] - prefix[a]) / (b - a)
  }
  return y
}

/** Centred moving RMS over `win` samples. */
export function movingRms(x: Float32Array, win: number): Float32Array {
  const sq = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) sq[i] = x[i] * x[i]
  const m = movingAverage(sq, win)
  for (let i = 0; i < m.length; i++) m[i] = Math.sqrt(m[i])
  return m
}

/**
 * Zero-phase 2nd-order Butterworth filter (applied forward and backward, so the
 * effective order is 4 and there is no time shift). `fc` in Hz, `fs` sample rate.
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
    if (!n) return out
    // Start in steady state for the first sample to avoid an edge transient
    const xs = src[reverse ? n - 1 : 0]
    const ys = dcGain * xs
    let z1 = ys - b0 * xs
    let z2 = b2 * xs - a2 * ys
    for (let k = 0; k < n; k++) {
      const i = reverse ? n - 1 - k : k
      const xi = src[i]
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
