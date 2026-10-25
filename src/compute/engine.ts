import { MinMaxPyramid } from '../dsp/minmax'
import { parse, references, type MathInput, type MathResult } from '../math/expr'
import type { Spectrum, WindowKind } from '../math/fft'
import type { Waveform } from '../model/types'
import type { ComputeReply, ComputeRequest } from './protocol'

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

const createWorker = (): WorkerLike => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

/**
 * The page's side of the compute worker, which evaluates math channels and computes spectra so
 * that long records do not block the page. The worker starts with the first job (a session without
 * math channels and spectra needs none) and is sent the input channels when a job first needs them.
 * Math evaluations do not pile up: while one runs, only the latest definitions wait for their turn.
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
  /** Definitions being evaluated, and the latest ones waiting meanwhile */
  private running: MathInput[] | null = null
  private queued: MathInput[] | null = null
  private state: MathState | null = null
  private readonly listeners = new Set<(s: MathState) => void>()
  /** Samples of the current math results by ref, and the refs by samples */
  private samples = new Map<string, Samples>()
  private refs = new WeakMap<Float32Array, string>()

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
    if (this.running) this.queued = defs
    else this.sendMath(defs)
  }

  /**
   * Spectrum of samples [i0, i1) of a waveform's `data` (an input or a current math channel). Null
   * when it was not computed: the samples are not (or no longer) known, or the worker failed.
   */
  spectrum(data: Float32Array, dt: number, i0: number, i1: number, window: WindowKind): Promise<{ spec?: Spectrum } | null> {
    const source = this.sourceIds.get(data)
    const ref = source !== undefined ? `src:${source}` : this.refs.get(data)
    if (ref === undefined) return Promise.resolve(null)
    if (source !== undefined) this.sendSources(new Set([source]))
    return new Promise((resolve) =>
      this.request({ type: 'spectrum', seq: ++this.seq, ref, dt, i0, i1, window }, (r) => resolve(r?.type === 'spectrum' && !r.stale ? { spec: r.spec } : null)),
    )
  }

  /** End the worker (jobs still running are dropped); the next job starts a new one */
  stop(): void {
    this.worker?.terminate()
    this.worker = null
    this.sentSources = new Set()
    // The refs belong to the worker: samples shown now get new ones from the next evaluation
    this.samples = new Map()
    this.refs = new WeakMap()
    this.running = null
    this.queued = null
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const done of pending) done(null)
  }

  private emit(state: MathState): void {
    this.state = state
    for (const l of this.listeners) l(state)
  }

  private sendMath(defs: MathInput[]): void {
    this.running = defs
    this.sendSources(sourcesOf(defs, this.channels))
    this.request({ type: 'math', seq: ++this.seq, defs, order: this.channels.map((w) => w.id) }, (r) => {
      // Stopped meanwhile: the next setMath starts again
      if (!r) return
      if (r.type === 'math') this.emit(this.apply(defs, r))
      else if (r.type === 'error') this.emit(failed(defs, r.message))
      this.running = null
      const next = this.queued
      this.queued = null
      if (next) this.sendMath(next)
    })
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

  /** Send the input channels `ids` the worker does not have yet */
  private sendSources(ids: Set<string>): void {
    const waves = this.channels.filter((w) => ids.has(w.id) && !this.sentSources.has(w.id))
    if (!waves.length) return
    for (const w of waves) this.sentSources.add(w.id)
    this.post({ type: 'sources', waves })
  }

  private request(msg: Exclude<ComputeRequest, { type: 'sources' }>, done: (r: ComputeReply | null) => void): void {
    this.pending.set(msg.seq, done)
    this.post(msg)
  }

  private post(msg: ComputeRequest): void {
    if (!this.worker) {
      const worker = this.createWorker()
      worker.onmessage = (e) => {
        const done = this.pending.get(e.data.seq)
        this.pending.delete(e.data.seq)
        done?.(e.data)
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
