/**
 * Results computed from the samples of a waveform (measurements, spectra), remembered per sample
 * array and key (range, window …). Keyed by the samples rather than the waveform object: a math
 * channel whose unit is edited gets a new waveform with the same samples, and nothing has to be
 * computed again. The `perArray` most recently used keys of each array are kept.
 */
export class SampleCache<T> {
  private readonly arrays = new WeakMap<Float32Array, Map<string, T>>()
  private readonly perArray: number

  constructor(perArray: number) {
    this.perArray = perArray
  }

  /** The result for `key`, computed now if it is not remembered */
  get(data: Float32Array, key: string, compute: () => T): T {
    let entries = this.arrays.get(data)
    if (!entries) this.arrays.set(data, (entries = new Map()))
    if (entries.has(key)) {
      const hit = entries.get(key) as T
      // Used: move to the end, so it is dropped last
      entries.delete(key)
      entries.set(key, hit)
      return hit
    }
    const value = compute()
    entries.set(key, value)
    if (entries.size > this.perArray) entries.delete(entries.keys().next().value!)
    return value
  }

  /** Forget a result, so the next `get` computes it again */
  delete(data: Float32Array, key: string): void {
    this.arrays.get(data)?.delete(key)
  }
}
