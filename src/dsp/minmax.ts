/**
 * Min/max pyramid for fast rendering of long records: each level stores the
 * min and max of consecutive blocks of samples, so a pixel column spanning
 * millions of samples can be resolved with a handful of lookups.
 */
const FACTOR = 16

interface Level {
  block: number
  min: Float32Array
  max: Float32Array
}

export class MinMaxPyramid {
  readonly data: Float32Array
  private levels: Level[] = []

  constructor(data: Float32Array) {
    this.data = data
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
        let lo = srcMin[s]
        let hi = srcMax[s]
        for (let i = s + 1; i < e; i++) {
          if (srcMin[i] < lo) lo = srcMin[i]
          if (srcMax[i] > hi) hi = srcMax[i]
        }
        min[j] = lo
        max[j] = hi
      }
      block *= FACTOR
      this.levels.push({ block, min, max })
      srcMin = min
      srcMax = max
    }
  }

  /** Min and max of samples [i0, i1). Writes into `out` = [min, max]. */
  range(i0: number, i1: number, out: [number, number]): void {
    const d = this.data
    i0 = Math.max(0, i0)
    i1 = Math.min(d.length, i1)
    let lo = Infinity
    let hi = -Infinity
    if (i1 <= i0) {
      out[0] = NaN
      out[1] = NaN
      return
    }
    // Pick the coarsest level whose blocks still fit inside the range a few times.
    let li = -1
    for (let k = this.levels.length - 1; k >= 0; k--) {
      if (this.levels[k].block * 2 <= i1 - i0) {
        li = k
        break
      }
    }
    if (li < 0) {
      for (let i = i0; i < i1; i++) {
        const v = d[i]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    } else {
      const { block, min, max } = this.levels[li]
      const b0 = Math.ceil(i0 / block)
      const b1 = Math.floor(i1 / block)
      for (let b = b0; b < b1; b++) {
        if (min[b] < lo) lo = min[b]
        if (max[b] > hi) hi = max[b]
      }
      // Partial blocks at the edges: recurse into finer data
      const tmp: [number, number] = [0, 0]
      if (i0 < b0 * block) {
        this.range(i0, b0 * block, tmp)
        if (tmp[0] < lo) lo = tmp[0]
        if (tmp[1] > hi) hi = tmp[1]
      }
      if (b1 * block < i1) {
        this.range(b1 * block, i1, tmp)
        if (tmp[0] < lo) lo = tmp[0]
        if (tmp[1] > hi) hi = tmp[1]
      }
    }
    out[0] = lo
    out[1] = hi
  }
}
