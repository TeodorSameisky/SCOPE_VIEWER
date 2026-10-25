/**
 * Results computed from the samples of a waveform (measurements, spectra), remembered per sample
 * array and key (range, window …). Keyed by the samples rather than the waveform object: a math
 * channel whose unit is edited gets a new waveform with the same samples, and nothing has to be
 * computed again. The `perArray` most recently used keys of each array are kept, and besides
 * them the key each `slot` (who asks: the measurement table, a callout) asked for last: however
 * many ask for results of one array, none of them loses its result to the others and has it
 * computed again.
 */
export class SampleCache<T> {
  private readonly arrays = new WeakMap<Float32Array, { entries: Map<string, T>; slots: Map<string, string> }>()
  private readonly perArray: number

  constructor(perArray: number) {
    this.perArray = perArray
  }

  /** The result for `key`, computed now if it is not remembered */
  get(data: Float32Array, key: string, compute: () => T, slot?: string): T {
    let a = this.arrays.get(data)
    if (!a) this.arrays.set(data, (a = { entries: new Map(), slots: new Map() }))
    if (slot !== undefined) a.slots.set(slot, key)
    const { entries } = a
    if (entries.has(key)) {
      const hit = entries.get(key) as T
      // Used: move to the end, so it is dropped last
      entries.delete(key)
      entries.set(key, hit)
      return hit
    }
    const value = compute()
    entries.set(key, value)
    if (entries.size > this.perArray) {
      // Least recently used first, except what a slot asked for last
      const asked = new Set(a.slots.values())
      for (const k of entries.keys()) {
        if (entries.size <= this.perArray) break
        if (!asked.has(k)) entries.delete(k)
      }
    }
    return value
  }

  /** Forget a result, so the next `get` computes it again */
  delete(data: Float32Array, key: string): void {
    this.arrays.get(data)?.entries.delete(key)
  }
}
