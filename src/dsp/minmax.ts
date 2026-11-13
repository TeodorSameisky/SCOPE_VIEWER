/**
 * Min/max pyramid for fast rendering of long records: each level stores the
 * min and max of consecutive blocks of samples, so a pixel column spanning
 * millions of samples can be resolved with a handful of lookups.
 */
const FACTOR = 16

/** One level of a pyramid: min and max of consecutive blocks of `block` samples */
export interface PyramidLevel {
  block: number
  min: Float32Array
  max: Float32Array
}

function buildLevels(data: Float32Array): PyramidLevel[] {
  const levels: PyramidLevel[] = []
  let srcMin = data
  let srcMax = data
  let block = 1
  while (srcMin.length > FACTOR * 4) {
    const n = Math.ceil(srcMin.length / FACTOR)
    const min = new Float32Array(n)
    const max = new Float32Array(n)
    for (let j = 0; j < n; j++) {
      const s = j * FACTOR
      const e = Math.min(s + FACTOR, srcMin.length)
      // NaN never wins a comparison and ±Infinity is passed over, so invalid samples (gaps of
      // math channels, a division by 0) are skipped; a block without valid samples stores NaN
      // and is left out when drawing
      let lo = Infinity
      let hi = -Infinity
      for (let i = s; i < e; i++) {
        const a = srcMin[i]
        const b = srcMax[i]
        if (a < lo && a !== -Infinity) lo = a
        if (b > hi && b !== Infinity) hi = b
      }
      min[j] = lo === Infinity ? NaN : lo
      max[j] = hi === -Infinity ? NaN : hi
    }
    block *= FACTOR
    levels.push({ block, min, max })
    srcMin = min
    srcMax = max
  }
  return levels
}

export class MinMaxPyramid {
  readonly data: Float32Array
  /** Finest level first; a worker that builds a pyramid sends these to the page */
  readonly levels: PyramidLevel[]

  /** Builds the levels of `data`, or takes the levels a worker built */
  constructor(data: Float32Array, levels?: PyramidLevel[]) {
    this.data = data
    this.levels = levels ?? buildLevels(data)
  }

  /** Min and max found so far by `scan` (a plot asks for thousands of ranges per frame: nothing is allocated for one) */
  private lo = Infinity
  private hi = -Infinity

  /** Min and max of samples [i0, i1). Writes into `out` = [min, max]. */
  range(i0: number, i1: number, out: [number, number]): void {
    i0 = Math.max(0, i0)
    i1 = Math.min(this.data.length, i1)
    this.lo = Infinity
    this.hi = -Infinity
    if (i1 > i0) this.scan(i0, i1)
    // No valid sample in the range
    out[0] = this.lo === Infinity ? NaN : this.lo
    out[1] = this.hi === -Infinity ? NaN : this.hi
  }

  /** Takes the samples [i0, i1) (not empty, within the data) into `lo` and `hi` */
  private scan(i0: number, i1: number): void {
    // Pick the coarsest level whose blocks still fit inside the range a few times.
    let li = -1
    for (let k = this.levels.length - 1; k >= 0; k--) {
      if (this.levels[k].block * 2 <= i1 - i0) {
        li = k
        break
      }
    }
    let lo = this.lo
    let hi = this.hi
    if (li < 0) {
      // Invalid samples are skipped as in the levels
      const d = this.data
      for (let i = i0; i < i1; i++) {
        const v = d[i]
        if (v < lo && v !== -Infinity) lo = v
        if (v > hi && v !== Infinity) hi = v
      }
      this.lo = lo
      this.hi = hi
      return
    }
    const { block, min, max } = this.levels[li]
    const b0 = Math.ceil(i0 / block)
    const b1 = Math.floor(i1 / block)
    for (let b = b0; b < b1; b++) {
      if (min[b] < lo) lo = min[b]
      if (max[b] > hi) hi = max[b]
    }
    this.lo = lo
    this.hi = hi
    // Partial blocks at the edges: into finer data
    if (i0 < b0 * block) this.scan(i0, b0 * block)
    if (b1 * block < i1) this.scan(b1 * block, i1)
  }
}
