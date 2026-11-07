import { describe, expect, it } from 'vitest'
import { measure } from '../dsp/measure'
import { MinMaxPyramid } from '../dsp/minmax'
import { computeSpectrum } from '../math/fft'
import type { Waveform } from '../model/types'
import { ComputeCore } from './core'
import { ComputeEngine, PAGE_MEASURE_MAX, type MathState, type WorkerLike } from './engine'
import type { ComputeReply, ComputeRequest } from './protocol'

/** Runs ComputeCore in place: messages are copied and arrive later, as with a real worker */
class FakeWorker implements WorkerLike {
  readonly core = new ComputeCore()
  readonly posted: ComputeRequest[] = []
  onmessage: ((e: MessageEvent<ComputeReply>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  stopped = false

  postMessage(msg: ComputeRequest): void {
    this.posted.push(msg)
    const copy = structuredClone(msg)
    setTimeout(() => {
      if (this.stopped) return
      const handled = this.core.handle(copy)
      if (handled) this.onmessage?.({ data: structuredClone(handled.reply, { transfer: handled.transfer }) } as MessageEvent<ComputeReply>)
    })
  }

  terminate(): void {
    this.stopped = true
  }
}

const wave = (id: string, f: (i: number) => number, n = 2000): Waveform => ({ id, data: Float32Array.from({ length: n }, (_, i) => f(i)), t0: 0, dt: 1e-6, yUnit: 'V', xUnit: 's' })
const ch1 = wave('CH1', (i) => Math.sin(i / 10))
const ch2 = wave('CH2', (i) => i % 7)
/** A pulse train longer than the page measures itself */
const long = wave('CH3', (i) => (Math.floor(i / 1000) % 2) * 3.3, PAGE_MEASURE_MAX + 10_000)

/** Let the fake worker answer (and the engine send what waited meanwhile) */
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r))
}

function setup(channels = [ch1, ch2]) {
  const workers: FakeWorker[] = []
  const pyramids = new Map(channels.map((w) => [w.id, new MinMaxPyramid(w.data)]))
  const engine = new ComputeEngine(channels, pyramids, () => {
    const w = new FakeWorker()
    workers.push(w)
    return w
  })
  const states: MathState[] = []
  engine.onMath((s) => states.push(s))
  const mathRequests = () => workers.flatMap((w) => w.posted).filter((m) => m.type === 'math')
  /** Types of the requests the workers got (without the input channels they were sent) */
  const requests = () => workers.flatMap((w) => w.posted).filter((m) => m.type !== 'sources')
  return { engine, workers, pyramids, states, latest: () => states[states.length - 1], mathRequests, requests }
}

describe('compute engine', () => {
  it('starts no worker without math channels', () => {
    const { engine, workers, latest } = setup()
    engine.setMath([])
    expect(latest().results.size).toBe(0)
    expect(workers).toHaveLength(0)
  })

  it('evaluates math in the worker and sends it only the inputs it needs', async () => {
    const { engine, workers, latest } = setup()
    engine.setMath([{ id: 'MATH1', expr: 'CH1 * 2' }])
    await settle()
    const r = latest().results.get('MATH1')!
    expect(r.wave!.data[10]).toBeCloseTo(2 * ch1.data[10], 6)
    expect(latest().pyramids.get('MATH1')!.data).toBe(r.wave!.data)
    expect(workers[0].posted[0]).toMatchObject({ type: 'sources', waves: [{ id: 'CH1' }] })
    expect(workers[0].posted.filter((m) => m.type === 'sources')).toHaveLength(1)
  })

  it('keeps the samples when only the unit changes, and uses an input’s own', async () => {
    const { engine, pyramids, latest } = setup()
    engine.setMath([{ id: 'MATH1', expr: 'CH1 * 2' }])
    await settle()
    const data = latest().results.get('MATH1')!.wave!.data
    engine.setMath([{ id: 'MATH1', expr: 'CH1 * 2', unit: 'W' }])
    await settle()
    expect(latest().results.get('MATH1')!.wave).toMatchObject({ data, yUnit: 'W' })
    // A delayed input: its samples and pyramid, at another time
    engine.setMath([{ id: 'MATH1', expr: 'delay(CH2, 3u)' }])
    await settle()
    expect(latest().results.get('MATH1')!.wave!.data).toBe(ch2.data)
    expect(latest().pyramids.get('MATH1')).toBe(pyramids.get('CH2'))
  })

  it('evaluates only the latest definitions that came in while one ran', async () => {
    const { engine, latest, mathRequests } = setup()
    for (const k of [2, 3, 4]) engine.setMath([{ id: 'MATH1', expr: `CH1 * ${k}` }])
    await settle()
    expect(mathRequests().map((m) => m.type === 'math' && m.defs[0].expr)).toEqual(['CH1 * 2', 'CH1 * 4'])
    expect(latest().defs[0].expr).toBe('CH1 * 4')
    expect(latest().results.get('MATH1')!.wave!.data[10]).toBeCloseTo(4 * ch1.data[10], 6)
  })

  it('computes spectra of inputs and math channels, and answers once they are there', async () => {
    const { engine, latest, requests } = setup()
    const expected = Array.from(computeSpectrum(ch2.data, 0, 2000, 1e-6, 'flatTop')!.rms)
    let arrived = 0
    engine.subscribeResults(() => arrived++)
    // Not there yet: undefined, and the listeners are told when it is
    expect(engine.spectrum(ch2.data, 1e-6, 0, 2000, 'flatTop', 'spectrum:FFT1')).toBeUndefined()
    await settle()
    expect(arrived).toBe(1)
    expect(Array.from(engine.spectrum(ch2.data, 1e-6, 0, 2000, 'flatTop', 'spectrum:FFT1')!.spec!.rms)).toEqual(expected)
    engine.setMath([{ id: 'MATH1', expr: 'CH2 + 0' }])
    await settle()
    const math = latest().results.get('MATH1')!.wave!.data
    expect(engine.spectrum(math, 1e-6, 0, 2000, 'flatTop', 'spectrum:FFT2')).toBeUndefined()
    await settle()
    expect(Array.from(engine.spectrum(math, 1e-6, 0, 2000, 'flatTop', 'spectrum:FFT2')!.spec!.rms)).toEqual(expected)
    // Too few samples: computed, but there is no spectrum
    engine.spectrum(ch2.data, 1e-6, 0, 8, 'hann', 'spectrum:FFT1')
    await settle()
    expect(engine.spectrum(ch2.data, 1e-6, 0, 8, 'hann', 'spectrum:FFT1')).toEqual({ spec: undefined })
    // Samples it does not know: nothing is asked of the worker
    const before = requests().length
    expect(engine.spectrum(new Float32Array(100), 1e-6, 0, 100, 'hann', 'spectrum:FFT3')).toBeUndefined()
    await settle()
    expect(requests()).toHaveLength(before)
  })

  it('computes a spectrum once for everyone asking for the same range and window', async () => {
    const { engine, requests } = setup()
    engine.spectrum(ch1.data, 1e-6, 0, 2000, 'hann', 'spectrum:FFT1')
    engine.spectrum(ch1.data, 1e-6, 0, 2000, 'hann', 'spectrum:FFT2')
    await settle()
    expect(requests().filter((m) => m.type === 'spectrum')).toHaveLength(1)
    // another window is another spectrum
    engine.spectrum(ch1.data, 1e-6, 0, 2000, 'flatTop', 'spectrum:FFT2')
    await settle()
    expect(requests().filter((m) => m.type === 'spectrum')).toHaveLength(2)
  })

  it('gives the worker one request at a time, the math channels first', async () => {
    const { engine, latest, requests } = setup()
    engine.spectrum(ch1.data, 1e-6, 0, 2000, 'hann', 'spectrum:FFT1')
    engine.spectrum(ch2.data, 1e-6, 0, 2000, 'hann', 'spectrum:FFT2')
    engine.setMath([{ id: 'MATH1', expr: 'CH1 + CH2' }])
    expect(requests().map((m) => m.type)).toEqual(['spectrum'])
    await settle()
    // The math channels went before the spectrum that waited
    expect(requests().map((m) => m.type)).toEqual(['spectrum', 'math', 'spectrum'])
    expect(latest().results.get('MATH1')!.wave!.data[3]).toBeCloseTo(ch1.data[3] + 3, 6)
    expect(engine.spectrum(ch1.data, 1e-6, 0, 2000, 'hann', 'spectrum:FFT1')).toBeDefined()
    expect(engine.spectrum(ch2.data, 1e-6, 0, 2000, 'hann', 'spectrum:FFT2')).toBeDefined()
  })

  it('computes only the latest range a slot asked for while the worker was busy', async () => {
    const { engine, requests } = setup()
    let arrived = 0
    engine.subscribeResults(() => arrived++)
    // The first is sent at once; each later one of the same slot takes the place of the one waiting
    for (const k of [0, 1, 2, 3]) engine.spectrum(ch1.data, 1e-6, 0, 1000 + 100 * k, 'hann', 'spectrum:FFT1')
    engine.spectrum(ch2.data, 1e-6, 0, 2000, 'hann', 'spectrum:FFT2')
    await settle()
    // The waiting one of FFT1 kept its turn before FFT2
    expect(requests().map((m) => m.type === 'spectrum' && m.i1)).toEqual([1000, 1300, 2000])
    expect(engine.spectrum(ch1.data, 1e-6, 0, 1300, 'hann', 'spectrum:FFT1')!.spec!.samples).toBe(1300)
    // Three results arrived, and the two that were replaced were announced too, so that whoever
    // shared them asks again (asked for again, they would be computed)
    expect(arrived).toBe(5)
  })

  it('measures short ranges at once and long ones in the worker, once for everyone asking', async () => {
    const { engine, workers, requests } = setup([ch1, ch2, long])
    expect(engine.measured(ch1, 0, 2000, 'table:CH1')).toEqual(measure(ch1.data, 0, 2000, 0, 1e-6))
    expect(workers).toHaveLength(0)

    let arrived = 0
    engine.subscribeResults(() => arrived++)
    const n = long.data.length
    expect(engine.measured(long, 0, n, 'table:CH3')).toBeUndefined()
    // Edge snapping asks for the same range meanwhile: no second job
    expect(engine.measured(long, 0, n, 'edges:CH3')).toBeUndefined()
    await settle()
    expect(arrived).toBe(1)
    expect(engine.resultsVersion()).toBe(1)
    const m = engine.measured(long, 0, n, 'edges:CH3')!
    expect(m).toEqual(measure(long.data, 0, n, 0, 1e-6))
    expect(m.frequency).toBeCloseTo(500, 6)
    expect(requests()).toHaveLength(1)
    // Only the input channel that was measured in the worker was sent to it
    expect(workers[0].posted[0]).toMatchObject({ type: 'sources', waves: [{ id: 'CH3' }] })
  })

  it('tells who shared a measurement that was replaced, so they can ask again', async () => {
    const { engine, requests } = setup([ch1, ch2, long])
    const n = long.data.length
    let arrived = 0
    engine.subscribeResults(() => arrived++)
    // Busy with the first; the second waits and is shared by the edges, then the table moves on
    engine.measured(long, 0, n, 'table:CH3')
    engine.measured(long, 1, n, 'table:CH3')
    engine.measured(long, 1, n, 'edges:CH3')
    engine.measured(long, 2, n, 'table:CH3')
    await settle()
    expect(requests().map((m) => m.type === 'measure' && m.i0)).toEqual([0, 2])
    // Told about the replacement (and the two results): the edges ask again and get it measured
    expect(arrived).toBe(3)
    expect(engine.measured(long, 1, n, 'edges:CH3')).toBeUndefined()
    await settle()
    expect(engine.measured(long, 1, n, 'edges:CH3')).toEqual(measure(long.data, 1, n, 0, 1e-6))
  })

  it('keeps each slot’s measurement when many slots measure one channel (callouts)', async () => {
    const { engine, requests } = setup([ch1, ch2, long])
    const n = long.data.length
    // More regions on one channel than ranges are remembered per channel
    const spans = Array.from({ length: 12 }, (_, i) => [i * 100, n - i * 100] as const)
    const ask = () => spans.map(([i0, i1], i) => engine.measured(long, i0, i1, `callout:${i}`))
    expect(ask().every((m) => m === undefined)).toBe(true)
    // One job after the other
    for (let i = 0; i < 3; i++) await settle()
    // All arrived and stay: asking again (on the next render) measures nothing again
    const results = ask()
    expect(results.every((m) => m !== undefined)).toBe(true)
    expect(results[11]).toEqual(measure(long.data, 1100, n - 1100, 0, 1e-6))
    await settle()
    expect(requests()).toHaveLength(12)
  })

  it('stops its worker; the next job starts a new one', async () => {
    const { engine, workers, latest } = setup()
    engine.setMath([{ id: 'MATH1', expr: 'CH1 - CH2' }])
    await settle()
    // One running, one waiting
    engine.spectrum(ch1.data, 1e-6, 0, 2000, 'hann', 'spectrum:FFT1')
    engine.spectrum(ch2.data, 1e-6, 0, 2000, 'hann', 'spectrum:FFT2')
    engine.stop()
    expect(workers[0].stopped).toBe(true)
    engine.setMath([{ id: 'MATH1', expr: 'CH1 - CH2' }])
    await settle()
    expect(workers).toHaveLength(2)
    // The new worker is sent the inputs again
    expect(workers[1].posted[0]).toMatchObject({ type: 'sources', waves: [{ id: 'CH1' }, { id: 'CH2' }] })
    expect(latest().results.get('MATH1')!.wave!.data[3]).toBeCloseTo(ch1.data[3] - 3, 6)
    // What was running or waiting when it stopped left nothing behind: asked for again, it is computed
    expect(engine.spectrum(ch1.data, 1e-6, 0, 2000, 'hann', 'spectrum:FFT1')).toBeUndefined()
    await settle()
    expect(engine.spectrum(ch1.data, 1e-6, 0, 2000, 'hann', 'spectrum:FFT1')?.spec).toBeDefined()
  })
})
