import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSession } from './load'

/** A worker that never answers: the file is still being read */
class SlowWorker {
  static created: SlowWorker[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  posted = 0
  terminated = false
  constructor() {
    SlowWorker.created.push(this)
  }
  postMessage() {
    this.posted++
  }
  terminate() {
    this.terminated = true
  }
}

describe('loadSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    SlowWorker.created = []
  })

  it('stops reading when another file is opened meanwhile', async () => {
    vi.stubGlobal('Worker', SlowWorker)
    const run = new AbortController()
    const loading = loadSession([new File([new Uint8Array(16)], 'ch1.wfm')], run.signal)
    // Once the file has been handed to the worker
    await vi.waitFor(() => expect(SlowWorker.created[0]?.posted).toBe(1))
    run.abort(new DOMException('Another file was opened', 'AbortError'))
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' })
    expect(SlowWorker.created[0].terminated).toBe(true)
  })

  it('starts no worker when it was cancelled while the files were read', async () => {
    vi.stubGlobal('Worker', SlowWorker)
    const run = new AbortController()
    const loading = loadSession([new File([new Uint8Array(16)], 'ch1.wfm')], run.signal)
    run.abort()
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' })
    expect(SlowWorker.created).toHaveLength(0)
  })
})
