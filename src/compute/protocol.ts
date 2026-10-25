import type { PyramidLevel } from '../dsp/minmax'
import type { Measurements } from '../dsp/measure'
import type { MathInput } from '../math/expr'
import type { Spectrum, WindowKind } from '../math/fft'
import type { Waveform } from '../model/types'

/*
 * Messages between the page (ComputeEngine) and the compute worker (ComputeCore). Sample arrays
 * are named by a ref: "src:CH1" for the samples of an input channel, "m:3" for samples a math
 * channel computed. Each array crosses once; afterwards both sides know it by its ref.
 */

/** Work on the samples [i0, i1) of an array */
export type ComputeJob =
  /** Its spectrum */
  | { type: 'spectrum'; ref: string; dt: number; i0: number; i1: number; window: WindowKind }
  /** Its measurements (`t0`, `dt`: its time base, for the timing measurements) */
  | { type: 'measure'; ref: string; t0: number; dt: number; i0: number; i1: number }

export type ComputeRequest =
  /** Input channels the worker needs, each sent once */
  | { type: 'sources'; waves: Waveform[] }
  /** Evaluate the math channels; `order`: the ids of the input channels in the session's order */
  | { type: 'math'; seq: number; defs: MathInput[]; order: string[] }
  | (ComputeJob & { seq: number })

/** The result of one math channel */
export interface MathOutput {
  id: string
  error?: string
  errorPos?: number
  derivedUnit?: string
  wave?: { ref: string; t0: number; dt: number; yUnit: string }
  /** The samples and the levels of their pyramid, only the first time the worker sends the ref */
  data?: Float32Array
  levels?: PyramidLevel[]
}

export type ComputeReply =
  | { type: 'math'; seq: number; results: MathOutput[] }
  /**
   * No `spec`: fewer samples than a spectrum needs. `stale`: the array is gone (a newer math
   * evaluation replaced it, or the input channel was not sent).
   */
  | { type: 'spectrum'; seq: number; spec?: Spectrum; stale?: boolean }
  /** `stale` as for a spectrum */
  | { type: 'measure'; seq: number; m?: Measurements; stale?: boolean }
  /** A request failed */
  | { type: 'error'; seq: number; message: string }
