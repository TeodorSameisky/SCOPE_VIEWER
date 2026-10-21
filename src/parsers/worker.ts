import { loadFiles, type InputFile } from './session'

self.onmessage = (e: MessageEvent<InputFile[]>) => {
  try {
    const session = loadFiles(e.data)
    const transfer = session.channels.map((c) => c.wave.data.buffer as ArrayBuffer)
    self.postMessage({ ok: true, session }, { transfer })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
