import { measure } from '../dsp/measure'
import { MinMaxPyramid } from '../dsp/minmax'
import { evaluateMath, type MathCache } from '../math/expr'
import { computeSpectrum } from '../math/fft'
import type { Waveform } from '../model/types'
import type { ComputeReply, ComputeRequest, MathOutput } from './protocol'

export interface Handled {
  reply: ComputeReply
  /** Buffers moved to the page instead of copied (the worker does not keep them) */
  transfer: ArrayBuffer[]
}

/**
 * The work of the compute worker, apart from the worker itself so it can be tested: it keeps the
 * input channels it was sent and the samples of the current math channels, evaluates math
 * channels (unchanged ones from the cache) and computes spectra and measurements of either.
 */
export class ComputeCore {
  private readonly sources = new Map<string, Waveform>()
  private readonly cache: MathCache = new Map()
  /** Samples of the current math channels by ref */
  private math = new Map<string, Float32Array>()
  /** Refs of the samples the page has */
  private sent = new Set<string>()
  private readonly refs = new WeakMap<Float32Array, string>()
  private nextRef = 1

  handle(msg: ComputeRequest): Handled | undefined {
    if (msg.type === 'sources') {
      for (const w of msg.waves) {
        this.sources.set(w.id, w)
        this.refs.set(w.data, `src:${w.id}`)
      }
      return undefined
    }
    if (msg.type === 'math') return this.evaluate(msg)
    if (msg.type === 'spectrum') return this.spectrum(msg)
    return this.measure(msg)
  }

  /** The samples of a ref: an input channel that was sent, or a current math channel */
  private samples(ref: string): Float32Array | undefined {
    return ref.startsWith('src:') ? this.sources.get(ref.slice(4))?.data : this.math.get(ref)
  }

  private evaluate({ seq, defs, order }: Extract<ComputeRequest, { type: 'math' }>): Handled {
    const results = evaluateMath(defs, order.flatMap((id) => this.sources.get(id) ?? []), this.cache)
    const math = new Map<string, Float32Array>()
    const sent = new Set<string>()
    const transfer: ArrayBuffer[] = []
    const out = defs.map((d): MathOutput => {
      const r = results.get(d.id)!
      const w = r.wave
      if (!w) return { id: d.id, error: r.error, errorPos: r.errorPos, derivedUnit: r.derivedUnit }
      let ref = this.refs.get(w.data)
      if (!ref) this.refs.set(w.data, (ref = `m:${this.nextRef++}`))
      const o: MathOutput = { id: d.id, derivedUnit: r.derivedUnit, wave: { ref, t0: w.t0, dt: w.dt, yUnit: w.yUnit } }
      // Samples of an input channel (e.g. a delayed one) the page has already
      if (ref.startsWith('src:')) return o
      math.set(ref, w.data)
      if (!this.sent.has(ref) && !sent.has(ref)) {
        // The page gets a copy of the samples (they stay here for spectra and other math channels)
        // and the pyramid, which is not needed here
        o.data = w.data
        o.levels = new MinMaxPyramid(w.data).levels
        for (const l of o.levels) transfer.push(l.min.buffer as ArrayBuffer, l.max.buffer as ArrayBuffer)
      }
      sent.add(ref)
      return o
    })
    // Samples of earlier results are dropped here and on the page alike
    this.math = math
    this.sent = sent
    return { reply: { type: 'math', seq, results: out }, transfer }
  }

  private spectrum({ seq, ref, dt, i0, i1, window }: Extract<ComputeRequest, { type: 'spectrum' }>): Handled {
    const data = this.samples(ref)
    if (!data) return { reply: { type: 'spectrum', seq, stale: true }, transfer: [] }
    const spec = computeSpectrum(data, i0, i1, dt, window)
    return { reply: { type: 'spectrum', seq, spec }, transfer: spec ? [spec.rms.buffer as ArrayBuffer] : [] }
  }

  private measure({ seq, ref, t0, dt, i0, i1 }: Extract<ComputeRequest, { type: 'measure' }>): Handled {
    const data = this.samples(ref)
    if (!data) return { reply: { type: 'measure', seq, stale: true }, transfer: [] }
    return { reply: { type: 'measure', seq, m: measure(data, i0, i1, t0, dt) }, transfer: [] }
  }
}
