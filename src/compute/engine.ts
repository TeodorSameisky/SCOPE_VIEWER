import { measure, type Measurements } from '../dsp/measure'
import { MinMaxPyramid } from '../dsp/minmax'
import { parse, references, type MathInput, type MathResult } from '../math/expr'
import type { Spectrum, WindowKind } from '../math/fft'
import type { Waveform } from '../model/types'
import { SampleCache } from '../util/sampleCache'
import type { ComputeJob, ComputeReply, ComputeRequest } from './protocol'

/** What the engine needs of its worker (tests pass one that runs ComputeCore in place) */
export interface WorkerLike {
  postMessage(msg: ComputeRequest): void
  onmessage: ((e: MessageEvent<ComputeReply>) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  terminate(): void
}

/** The math channels as last computed */
export interface MathState {
  /** The definitions the results are for */
  defs: MathInput[]
  results: Map<string, MathResult>
  /** Pyramids of the results that have samples, by math channel id */
  pyramids: Map<string, MinMaxPyramid>
}

interface Samples {
  data: Float32Array
  pyramid: MinMaxPyramid
}

/** A spectrum or measurement waiting on the page until the worker is free */
interface Waiting {
  job: ComputeJob
  slot?: string
  /** The reply; null when it was not computed: the worker stopped or failed, or (`replaced`) a newer job of its slot took its place */
  done: (r: ComputeReply | null, replaced?: boolean) => void
}

/** Ranges up to this many samples are measured at once on the page (well under a millisecond); longer ones in the worker */
export const PAGE_MEASURE_MAX = 50_000

const createWorker = (): WorkerLike => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

/**
 * The page's side of the compute worker, which evaluates math channels and computes spectra and
 * measurements so that long records do not block the page. The worker starts with the first job (a
 * session without math channels, spectra and long measurements needs none) and is sent the input
 * channels when a job first needs them.
 *
 * Work does not pile up while the view is panned or zoomed: the worker is given one request at a
 * time, math channels first. Of the math definitions only the latest wait for their turn; a
 * spectrum or measurement asked for by a `slot` (one spectrum, the measurements of one channel)
 * takes the place of the one that slot asked for before, if that is still waiting.
 * `stop` ends the worker; the next job starts a new one.
 */
export class ComputeEngine {
  private readonly channels: Waveform[]
  private readonly channelPyramids: Map<string, MinMaxPyramid>
  private readonly createWorker: () => WorkerLike
  /** Input channel id by its samples */
  private readonly sourceIds: Map<Float32Array, string>
  private worker: WorkerLike | null = null
  private sentSources = new Set<string>()
  private seq = 0
  private readonly pending = new Map<number, (r: ComputeReply | null) => void>()
  /** A request is in the worker */
  private busy = false
  /** Definitions being evaluated, and the latest ones waiting meanwhile */
  private running: MathInput[] | null = null
  private queued: MathInput[] | null = null
  /** Spectra and measurements waiting for the worker, in turn */
  private jobs: Waiting[] = []
  private state: MathState | null = null
  private readonly listeners = new Set<(s: MathState) => void>()
  /** Samples of the current math results by ref, and the refs by samples */
  private samples = new Map<string, Samples>()
  private refs = new WeakMap<Float32Array, string>()
  /** Measurements by sample array and range; `m` is missing while the worker computes them */
  private readonly measurements = new SampleCache<{ m?: Measurements }>(8)
  private readonly measuredListeners = new Set<() => void>()
  private measuredCount = 0

  constructor(channels: Waveform[], pyramids: Map<string, MinMaxPyramid>, worker: () => WorkerLike = createWorker) {
    this.channels = channels
    this.channelPyramids = pyramids
    this.createWorker = worker
    this.sourceIds = new Map(channels.map((w) => [w.data, w.id]))
  }

  /** Call `listener` with each new state of the math channels (and at once with the current one) */
  onMath(listener: (s: MathState) => void): () => void {
    this.listeners.add(listener)
    if (this.state) listener(this.state)
    return () => void this.listeners.delete(listener)
  }

  /** Evaluate these math channel definitions (the results go to the `onMath` listeners) */
  setMath(defs: MathInput[]): void {
    if (!defs.length && !this.worker) return this.emit({ defs, results: new Map(), pyramids: new Map() })
    this.queued = defs
    this.pump()
  }

  /**
   * Spectrum of samples [i0, i1) of a waveform's `data` (an input or a current math channel). Null
   * when it was not computed: the samples are not (or no longer) known, the worker failed, or a
   * newer spectrum of the same `slot` took its place before it was sent.
   */
  spectrum(data: Float32Array, dt: number, i0: number, i1: number, window: WindowKind, slot?: string): Promise<{ spec?: Spectrum } | null> {
    const ref = this.refFor(data)
    if (ref === undefined) return Promise.resolve(null)
    return new Promise((resolve) => this.enqueue({ type: 'spectrum', ref, dt, i0, i1, window }, slot, (r) => resolve(r?.type === 'spectrum' && !r.stale ? { spec: r.spec } : null)))
  }

  /**
   * Measurements of samples [i0, i1) (whole indexes) of a waveform (an input or a current math
   * channel), as far as they are known. Short ranges are measured at once; a longer one is
   * measured in the worker and is undefined until then: `subscribeMeasured` tells when results
   * arrive. They are remembered per sample array and range, so whoever asks for the same range
   * (the measurement table, edge snapping) shares them. `slot` names who asks, as for `spectrum`;
   * the range a slot asked for last stays remembered however many others ask (callouts).
   */
  measured(w: Pick<Waveform, 'data' | 't0' | 'dt'>, i0: number, i1: number, slot: string): Measurements | undefined {
    const key = `${w.t0}:${w.dt}:${i0}:${i1}`
    if (i1 - i0 <= PAGE_MEASURE_MAX) return this.measurements.get(w.data, key, () => ({ m: measure(w.data, i0, i1, w.t0, w.dt) }), slot).m
    const ref = this.refFor(w.data)
    if (ref === undefined) return undefined
    return this.measurements.get(w.data, key, () => {
      const entry: { m?: Measurements } = {}
      this.enqueue({ type: 'measure', ref, t0: w.t0, dt: w.dt, i0, i1 }, slot, (r, replaced) => {
        if (r?.type === 'measure' && r.m) {
          entry.m = r.m
          return this.notifyMeasured()
        }
        // Not computed: asked for again when needed. Whoever shared the replaced one is told
        // (later: this runs while the slot asks for its new range), the others ask on the next change
        this.measurements.delete(w.data, key)
        if (replaced) queueMicrotask(() => this.notifyMeasured())
      })
      return entry
    }, slot).m
  }

  /** For useSyncExternalStore (with `measuredVersion`): `listener` is called when measurements arrive */
  subscribeMeasured = (listener: () => void): (() => void) => {
    this.measuredListeners.add(listener)
    return () => void this.measuredListeners.delete(listener)
  }

  measuredVersion = (): number => this.measuredCount

  /** End the worker (jobs still running or waiting are dropped); the next job starts a new one */
  stop(): void {
    this.worker?.terminate()
    this.worker = null
    this.busy = false
    this.sentSources = new Set()
    // The refs belong to the worker: samples shown now get new ones from the next evaluation
    this.samples = new Map()
    this.refs = new WeakMap()
    this.running = null
    this.queued = null
    const pending = [...this.pending.values()]
    this.pending.clear()
    const jobs = this.jobs
    this.jobs = []
    for (const done of pending) done(null)
    for (const j of jobs) j.done(null)
  }

  private emit(state: MathState): void {
    this.state = state
    for (const l of this.listeners) l(state)
  }

  private notifyMeasured(): void {
    this.measuredCount++
    for (const l of this.measuredListeners) l()
  }

  /** Queue a spectrum or measurement; a waiting job of the same slot is replaced (it keeps its turn) */
  private enqueue(job: ComputeJob, slot: string | undefined, done: Waiting['done']): void {
    const waiting: Waiting = { job, slot, done }
    const i = slot === undefined ? -1 : this.jobs.findIndex((j) => j.slot === slot)
    if (i < 0) this.jobs.push(waiting)
    else {
      const replaced = this.jobs[i]
      this.jobs[i] = waiting
      replaced.done(null, true)
    }
    this.pump()
  }

  /** Give the worker its next request once it is free: the latest math definitions first, then the jobs in turn */
  private pump(): void {
    if (this.busy) return
    const defs = this.queued
    if (defs) {
      this.queued = null
      this.running = defs
      this.sendSources(sourcesOf(defs, this.channels))
      this.request({ type: 'math', seq: ++this.seq, defs, order: this.channels.map((w) => w.id) }, (r) => {
        // Stopped meanwhile: the next setMath starts again
        if (!r) return
        if (r.type === 'math') this.emit(this.apply(defs, r))
        else if (r.type === 'error') this.emit(failed(defs, r.message))
        this.running = null
      })
      return
    }
    const next = this.jobs.shift()
    if (next) this.request({ ...next.job, seq: ++this.seq }, next.done)
  }

  /** The state of a math reply: waveforms on the samples it sent or the page has */
  private apply(defs: MathInput[], reply: Extract<ComputeReply, { type: 'math' }>): MathState {
    const results = new Map<string, MathResult>()
    const pyramids = new Map<string, MinMaxPyramid>()
    const samples = new Map<string, Samples>()
    for (const o of reply.results) {
      const w = o.wave
      if (!w) {
        results.set(o.id, { error: o.error, errorPos: o.errorPos, derivedUnit: o.derivedUnit })
        continue
      }
      const source = w.ref.startsWith('src:') ? this.channels.find((c) => c.id === w.ref.slice(4)) : undefined
      const s: Samples | undefined = source
        ? { data: source.data, pyramid: this.channelPyramids.get(source.id) ?? new MinMaxPyramid(source.data) }
        : o.data
          ? { data: o.data, pyramid: new MinMaxPyramid(o.data, o.levels) }
          : (samples.get(w.ref) ?? this.samples.get(w.ref))
      if (!s) {
        results.set(o.id, { error: 'The samples of the result were lost; apply the expression again' })
        continue
      }
      if (!source) {
        samples.set(w.ref, s)
        this.refs.set(s.data, w.ref)
      }
      results.set(o.id, { wave: { id: o.id, data: s.data, t0: w.t0, dt: w.dt, yUnit: w.yUnit, xUnit: 's' }, derivedUnit: o.derivedUnit })
      pyramids.set(o.id, s.pyramid)
    }
    // As in the worker: samples no result uses any more are dropped
    this.samples = samples
    return { defs, results, pyramids }
  }

  /** The worker's name of an array of samples, sending an input channel it does not have yet; undefined when it does not know them */
  private refFor(data: Float32Array): string | undefined {
    const source = this.sourceIds.get(data)
    if (source === undefined) return this.refs.get(data)
    this.sendSources(new Set([source]))
    return `src:${source}`
  }

  /** Send the input channels `ids` the worker does not have yet */
  private sendSources(ids: Set<string>): void {
    const waves = this.channels.filter((w) => ids.has(w.id) && !this.sentSources.has(w.id))
    if (!waves.length) return
    for (const w of waves) this.sentSources.add(w.id)
    this.post({ type: 'sources', waves })
  }

  private request(msg: Exclude<ComputeRequest, { type: 'sources' }>, done: (r: ComputeReply | null) => void): void {
    this.busy = true
    this.pending.set(msg.seq, done)
    this.post(msg)
  }

  private post(msg: ComputeRequest): void {
    if (!this.worker) {
      const worker = this.createWorker()
      worker.onmessage = (e) => {
        // A reply of a worker that was stopped meanwhile
        if (this.worker !== worker) return
        const done = this.pending.get(e.data.seq)
        this.pending.delete(e.data.seq)
        this.busy = false
        done?.(e.data)
        this.pump()
      }
      // The worker failed (e.g. out of memory): what was waiting fails with it, the next job starts a new one
      worker.onerror = (e) => {
        const defs = this.queued ?? this.running
        this.stop()
        if (defs) this.emit(failed(defs, `The computation stopped${e.message ? `: ${e.message}` : ''}`))
      }
      this.worker = worker
    }
    this.worker.postMessage(msg)
  }
}

/** Every math channel with the same error */
function failed(defs: MathInput[], message: string): MathState {
  return { defs, results: new Map(defs.map((d) => [d.id, { error: message }])), pyramids: new Map() }
}

/**
 * The input channels (ids) math definitions refer to; the first channel when one refers to no
 * channel at all (a constant or `t` takes its time base).
 */
function sourcesOf(defs: MathInput[], channels: Waveform[]): Set<string> {
  const byName = new Map(channels.map((w) => [w.id.toUpperCase(), w.id]))
  const ids = new Set<string>()
  for (const d of defs) {
    let names: string[]
    try {
      names = [...references(parse(d.expr))].filter((n) => n !== 'T' && n !== 'PI' && n !== 'E')
    } catch {
      continue
    }
    for (const n of names) {
      const id = byName.get(n)
      if (id !== undefined) ids.add(id)
    }
    if (!names.length && channels.length) ids.add(channels[0].id)
  }
  return ids
}
