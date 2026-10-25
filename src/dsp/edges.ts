import { measure, type Measurements } from './measure'

/** Reference levels of a bi-level signal: 10 %, 50 % and 90 % of its amplitude above base */
export interface EdgeLevels {
  lo: number
  mid: number
  hi: number
}

/** The reference levels of the samples [i0, i1), or undefined without clear signal levels (noise, flat line) */
export function edgeLevels(data: Float32Array, i0: number, i1: number): EdgeLevels | undefined {
  return levelsOf(measure(data, i0, i1, 0, 1))
}

/** The reference levels of measured samples (their top and base), or undefined without clear signal levels */
export function levelsOf(m: Measurements): EdgeLevels | undefined {
  if (!m.levelsOk) return undefined
  const a = m.top - m.base
  return { lo: m.base + 0.1 * a, mid: m.base + 0.5 * a, hi: m.base + 0.9 * a }
}

/**
 * The edge nearest to the fractional sample index `x`, at most `maxN` samples away: the
 * interpolated index where the signal crosses the 50 % level, on its way from below 10 % to
 * above 90 % (or back), so noise around the middle is not taken for an edge. Only samples in
 * [lim0, lim1) are looked at. Undefined when there is no such edge.
 */
export function nearestEdge(data: Float32Array, x: number, maxN: number, lv: EdgeLevels, lim0 = 0, lim1 = data.length): number | undefined {
  lim0 = Math.max(0, lim0)
  lim1 = Math.min(data.length, lim1)
  const a = Math.max(lim0 + 1, Math.floor(x - maxN))
  const b = Math.min(lim1 - 1, Math.ceil(x + maxN))
  let best: number | undefined
  let bestD = maxN
  for (let i = a; i <= b; i++) {
    const p = data[i - 1]
    const q = data[i]
    // Comparisons with NaN are false: invalid samples never make a crossing
    const up = p < lv.mid && q >= lv.mid
    const down = p >= lv.mid && q < lv.mid
    if (!up && !down) continue
    const xi = i - 1 + (lv.mid - p) / (q - p)
    const d = Math.abs(xi - x)
    if (d > bestD || !isFullEdge(data, i, lv, lim0, lim1, up)) continue
    best = xi
    bestD = d
  }
  return best
}

/** Does the crossing between samples i-1 and i belong to an edge from one level to the other? */
function isFullEdge(data: Float32Array, i: number, lv: EdgeLevels, lim0: number, lim1: number, rising: boolean): boolean {
  const inBand = (v: number) => v > lv.lo && v < lv.hi
  let j = i - 1
  while (j > lim0 && inBand(data[j])) j--
  let k = i
  while (k < lim1 - 1 && inBand(data[k])) k++
  return rising ? data[j] <= lv.lo && data[k] >= lv.hi : data[j] >= lv.hi && data[k] <= lv.lo
}
