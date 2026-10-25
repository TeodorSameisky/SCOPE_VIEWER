import { ComputeCore } from './core'
import type { ComputeReply, ComputeRequest } from './protocol'

/** Evaluates math channels and computes spectra off the page (see ComputeEngine) */
const core = new ComputeCore()

self.onmessage = (e: MessageEvent<ComputeRequest>) => {
  const msg = e.data
  try {
    const handled = core.handle(msg)
    if (handled) self.postMessage(handled.reply, { transfer: handled.transfer })
  } catch (err) {
    if (msg.type === 'sources') return
    const reply: ComputeReply = { type: 'error', seq: msg.seq, message: err instanceof Error ? err.message : String(err) }
    self.postMessage(reply)
  }
}
