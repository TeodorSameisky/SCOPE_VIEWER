import { describe, expect, it } from 'vitest'
import { MinMaxPyramid } from '../dsp/minmax'
import { computeSpectrum } from '../math/fft'
import type { Waveform } from '../model/types'
import { ComputeCore } from './core'
import { ComputeEngine, type MathState, type WorkerLike } from './engine'
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

/** Let the fake worker answer (and the engine send what waited meanwhile) */
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r))
}

function setup() {
  const workers: FakeWorker[] = []
  const pyramids = new Map([ch1, ch2].map((w) => [w.id, new MinMaxPyramid(w.data)]))
  const engine = new ComputeEngine([ch1, ch2], pyramids, () => {
    const w = new FakeWorker()
    workers.push(w)
    return w
  })
  const states: MathState[] = []
  engine.onMath((s) => states.push(s))
  const mathRequests = () => workers.flatMap((w) => w.posted).filter((m) => m.type === 'math')
  return { engine, workers, pyramids, states, latest: () => states[states.length - 1], mathRequests }
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

  it('computes spectra of inputs and math channels', async () => {
    const { engine, latest } = setup()
    const expected = Array.from(computeSpectrum(ch2.data, 0, 2000, 1e-6, 'flatTop')!.rms)
    expect(Array.from((await engine.spectrum(ch2.data, 1e-6, 0, 2000, 'flatTop'))!.spec!.rms)).toEqual(expected)
    engine.setMath([{ id: 'MATH1', expr: 'CH2 + 0' }])
    await settle()
    const math = latest().results.get('MATH1')!.wave!.data
    expect(Array.from((await engine.spectrum(math, 1e-6, 0, 2000, 'flatTop'))!.spec!.rms)).toEqual(expected)
    // Too few samples, and samples it does not know
    expect(await engine.spectrum(ch2.data, 1e-6, 0, 8, 'hann')).toEqual({ spec: undefined })
    expect(await engine.spectrum(new Float32Array(100), 1e-6, 0, 100, 'hann')).toBeNull()
  })

  it('stops its worker; the next job starts a new one', async () => {
    const { engine, workers, latest } = setup()
    engine.setMath([{ id: 'MATH1', expr: 'CH1 - CH2' }])
    await settle()
    const running = engine.spectrum(ch1.data, 1e-6, 0, 2000, 'hann')
    engine.stop()
    expect(workers[0].stopped).toBe(true)
    expect(await running).toBeNull()
    engine.setMath([{ id: 'MATH1', expr: 'CH1 - CH2' }])
    await settle()
    expect(workers).toHaveLength(2)
    // The new worker is sent the inputs again
    expect(workers[1].posted[0]).toMatchObject({ type: 'sources', waves: [{ id: 'CH1' }, { id: 'CH2' }] })
    expect(latest().results.get('MATH1')!.wave!.data[3]).toBeCloseTo(ch1.data[3] - 3, 6)
  })
})
