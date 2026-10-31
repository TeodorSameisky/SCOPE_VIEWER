import type { Workspace } from './workspace'

/**
 * Tabs and windows of this browser that have the same session open tell each other about every
 * analysis they save and about a reset to the file defaults. A tab takes newer news over, so one
 * that was left open does not later overwrite the work done in another with its older state.
 */
export interface WorkspaceNews {
  fingerprint: string
  /** When the analysis was changed (ms since 1970): of two versions, the later one counts */
  changedAt: number
  /** The workspace as saved; null: reset to the file defaults */
  workspace: Workspace | null
}

const listeners = new Set<(news: WorkspaceNews) => void>()
let channel: BroadcastChannel | null | undefined

/** One channel per tab, opened on first use (none where the browser has no BroadcastChannel) */
function open(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('scope-viewer:workspace')
    if (channel) channel.onmessage = (e: MessageEvent<WorkspaceNews>) => listeners.forEach((l) => l(e.data))
  }
  return channel
}

/** Tell the other tabs (a tab does not hear its own news) */
export function announce(news: WorkspaceNews): void {
  try {
    open()?.postMessage(news)
  } catch {
    // The other tabs find the newer version when they next save (saveWorkspace refuses to overwrite it)
  }
}

/** Call `listener` with the news of one session from the other tabs */
export function onNews(fingerprint: string, listener: (news: WorkspaceNews) => void): () => void {
  const l = (news: WorkspaceNews) => {
    if (news?.fingerprint === fingerprint) listener(news)
  }
  listeners.add(l)
  open()
  return () => void listeners.delete(l)
}
