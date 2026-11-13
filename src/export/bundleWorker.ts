import { buildBundle, type NamedData } from './bundle'

/** What `saveBundle` sends: the session files and the analysis to pack */
export interface BundleRequest {
  sources: NamedData[]
  analysisJson: string
}

export type BundleReply = { ok: true; blob: Blob } | { ok: false; error: string }

/** Packs a session bundle off the page: the checksums of a large session take a while (see saveBundle.ts) */
self.onmessage = (e: MessageEvent<BundleRequest>) => {
  let reply: BundleReply
  try {
    reply = { ok: true, blob: buildBundle(e.data.sources, e.data.analysisJson) }
  } catch (err) {
    reply = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage(reply)
}
