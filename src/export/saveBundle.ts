import type { NamedData } from './bundle'
import type { BundleReply, BundleRequest } from './bundleWorker'

/**
 * A session bundle (see bundle.ts) of the session files and the analysis, packed in a Web Worker
 * that ends when it is done: a session of some hundred MB would block the page for a second or
 * more. The files are moved to the worker, not copied: `sources` cannot be used afterwards.
 */
export async function saveBundle(sources: NamedData[], analysisJson: string): Promise<Blob> {
  const worker = new Worker(new URL('./bundleWorker.ts', import.meta.url), { type: 'module' })
  try {
    const reply = await new Promise<BundleReply>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<BundleReply>) => resolve(e.data)
      worker.onerror = (e) => reject(new Error(e.message || 'The bundle could not be packed'))
      const request: BundleRequest = { sources, analysisJson }
      worker.postMessage(request, [...new Set(sources.map((s) => s.data))])
    })
    if (!reply.ok) throw new Error(reply.error)
    return reply.blob
  } finally {
    worker.terminate()
  }
}
