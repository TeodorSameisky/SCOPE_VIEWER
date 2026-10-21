import { loadFiles, type InputFile } from './session'

async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Content hash identifying the opened file(s), used to remember callouts per session */
async function fingerprint(files: InputFile[]): Promise<string> {
  const hashes = await Promise.all(files.map((f) => sha256Hex(f.data)))
  if (hashes.length === 1) return hashes[0]
  return sha256Hex(hashes.sort().join(','))
}

self.onmessage = async (e: MessageEvent<InputFile[]>) => {
  try {
    const fp = await fingerprint(e.data)
    const session = loadFiles(e.data)
    session.fingerprint = fp
    const transfer = session.channels.map((c) => c.wave.data.buffer as ArrayBuffer)
    self.postMessage({ ok: true, session }, { transfer })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
