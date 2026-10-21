import type { Session } from '../model/types'
import type { InputFile } from './session'

/** Parse files in a Web Worker so large records do not block the UI. */
export async function loadSession(files: File[]): Promise<Session> {
  const inputs: InputFile[] = await Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })))
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<Session>((resolve, reject) => {
      worker.onmessage = (e) => (e.data.ok ? resolve(e.data.session) : reject(new Error(e.data.error)))
      worker.onerror = (e) => reject(new Error(e.message || 'Failed to parse file'))
      worker.postMessage(inputs, inputs.map((i) => i.data))
    })
  } finally {
    worker.terminate()
  }
}
