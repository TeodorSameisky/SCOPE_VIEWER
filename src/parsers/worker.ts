import { sha256Hex } from '../util/sha256'
import { loadFiles, type InputFile } from './session'

/** Content hash identifying the opened file(s), used to remember callouts per session */
async function fingerprint(files: InputFile[]): Promise<string> {
  const hashes = await Promise.all(files.map((f) => sha256Hex(f.data)))
  if (hashes.length === 1) return hashes[0]
  return sha256Hex(hashes.sort().join(','))
}

self.onmessage = async (e: MessageEvent<InputFile[]>) => {
  try {
    // A failing hash must never prevent opening the file; callouts are then just not remembered
    const fp = await fingerprint(e.data).catch(() => undefined)
    const session = loadFiles(e.data)
    session.fingerprint = fp
    const transfer = session.channels.map((c) => c.wave.data.buffer as ArrayBuffer)
    self.postMessage({ ok: true, session }, { transfer })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
