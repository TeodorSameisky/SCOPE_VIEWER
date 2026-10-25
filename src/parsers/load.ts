import { MinMaxPyramid } from '../dsp/minmax'
import type { Session } from '../model/types'
import type { InputFile } from './session'
import type { WorkerResult } from './worker'

export interface LoadedSession {
  session: Session
  /** Min/max pyramid of each channel (by id) for drawing long records */
  pyramids: Map<string, MinMaxPyramid>
  /** The session file(s), kept to save a bundle later */
  sources: InputFile[]
  /** Analysis stored in a .scopeview bundle */
  analysis?: string
}

/**
 * Parse files (and build the pyramids of their channels) in a Web Worker so large records do not
 * block the UI. Aborting `signal` (another file opened meanwhile) stops the worker and rejects
 * with its reason.
 */
export async function loadSession(files: File[], signal?: AbortSignal): Promise<LoadedSession> {
  const inputs: InputFile[] = await Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })))
  signal?.throwIfAborted()
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  let abort = () => {}
  try {
    const r = await new Promise<WorkerResult>((resolve, reject) => {
      worker.onmessage = (e) => (e.data.ok ? resolve(e.data) : reject(new Error(e.data.error)))
      worker.onerror = (e) => reject(new Error(e.message || 'Failed to parse file'))
      abort = () => reject(signal!.reason)
      signal?.addEventListener('abort', abort)
      worker.postMessage(inputs, inputs.map((i) => i.data))
    })
    const pyramids = new Map(r.session.channels.map((c) => [c.wave.id, new MinMaxPyramid(c.wave.data, r.pyramids[c.wave.id])]))
    return { session: r.session, pyramids, sources: r.sources, analysis: r.analysis }
  } finally {
    signal?.removeEventListener('abort', abort)
    worker.terminate()
  }
}
