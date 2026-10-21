import type { Session } from '../model/types'
import type { InputFile } from './session'
import type { WorkerResult } from './worker'

export interface LoadedSession {
  session: Session
  /** The session file(s), kept to save a bundle later */
  sources: InputFile[]
  /** Analysis stored in a .scopeview bundle */
  analysis?: string
}

/** Parse files in a Web Worker so large records do not block the UI. */
export async function loadSession(files: File[]): Promise<LoadedSession> {
  const inputs: InputFile[] = await Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })))
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  try {
    const r = await new Promise<WorkerResult>((resolve, reject) => {
      worker.onmessage = (e) => (e.data.ok ? resolve(e.data) : reject(new Error(e.data.error)))
      worker.onerror = (e) => reject(new Error(e.message || 'Failed to parse file'))
      worker.postMessage(inputs, inputs.map((i) => i.data))
    })
    return { session: r.session, sources: r.sources, analysis: r.analysis }
  } finally {
    worker.terminate()
  }
}
