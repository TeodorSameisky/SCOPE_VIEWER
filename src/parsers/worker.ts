import { isBundleName, unpackBundle } from '../export/bundle'
import { sha256Hex } from '../util/sha256'
import { loadFiles, type InputFile } from './session'

/** Content hash identifying the opened file(s), used to remember the workspace per session */
async function fingerprint(files: InputFile[]): Promise<string> {
  const hashes = await Promise.all(files.map((f) => sha256Hex(f.data)))
  if (hashes.length === 1) return hashes[0]
  return sha256Hex(hashes.sort().join(','))
}

export interface WorkerResult {
  ok: true
  session: import('../model/types').Session
  /** The session file(s): for a bundle the files inside it */
  sources: InputFile[]
  /** Analysis JSON from a bundle */
  analysis?: string
}

self.onmessage = async (e: MessageEvent<InputFile[]>) => {
  try {
    let files = e.data
    let analysis: string | undefined
    if (files.length === 1 && isBundleName(files[0].name)) {
      const b = unpackBundle(files[0].data)
      files = b.files
      analysis = b.analysis
    }
    // The fingerprint is taken from the session files, so a bundle shares the saved state of its file.
    // A failing hash must never prevent opening the file; the workspace is then just not remembered.
    const fp = await fingerprint(files).catch(() => undefined)
    const session = loadFiles(files)
    session.fingerprint = fp
    const result: WorkerResult = { ok: true, session, sources: files, analysis }
    const transfer = [...session.channels.map((c) => c.wave.data.buffer as ArrayBuffer), ...files.map((f) => f.data)]
    self.postMessage(result, { transfer: [...new Set(transfer)] })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
