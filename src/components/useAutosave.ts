import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnalysisStore } from '../model/analysisStore'
import type { Session } from '../model/types'
import { announce } from '../model/tabSync'
import type { TimeWindow } from '../model/view'
import { saveWorkspace, workspaceOf, type LoadSource, type SaveStatus, type Workspace } from '../model/workspace'

/** Delay after the last change before the workspace is written */
const SAVE_DELAY_MS = 400

interface Options {
  /** Saving removed the saved analyses of other sessions to make room (storage was full) */
  onRemoved?: (fileNames: string[]) => void
  /** Not saved: a newer analysis of the session was saved meanwhile in another tab */
  onNewer?: () => void
}

/** The view on the analysis, which is saved with it: the time window and the selected channel */
export interface SavedView {
  window: TimeWindow
  selected: string | undefined
}

/**
 * Saves the workspace of a session in the browser shortly after each change, and at once when
 * the page is hidden or closed or the session is left. It follows the analysis store itself, and the
 * view (the time window and the selected channel, which are not in the store) through its arguments.
 * `boot` is the workspace the session started with: a file that is only opened is not stored (saving
 * starts with the first change), an imported or migrated workspace is not in storage yet and is saved
 * right away. A save never overwrites a newer analysis of the session (the store knows when its
 * analysis was changed) and is announced to the other tabs (see tabSync).
 *
 * Returns the save status and `cancel`, which drops a pending save (before the workspace is replaced).
 */
export function useAutosave(
  session: Session,
  store: AnalysisStore,
  view: SavedView,
  boot: { workspace: Workspace; source: LoadSource | 'file' },
  options: Options,
) {
  const [status, setStatus] = useState<SaveStatus>(() => (boot.source === 'saved' ? { state: 'saved', at: new Date().toISOString() } : { state: 'clean' }))
  // Comparing with the initial state (instead of skipping the first run) also holds when
  // effects run twice in development
  const [initialJson] = useState(() => (boot.source === 'saved' || boot.source === 'default' ? JSON.stringify(boot.workspace) : null))
  const changed = useRef(initialJson === null)
  const viewRef = useRef(view)
  const timer = useRef<number | undefined>(undefined)
  const opts = useRef(options)
  useEffect(() => {
    opts.current = options
  })

  const current = useCallback((): Workspace => workspaceOf(store.get(), viewRef.current.window, viewRef.current.selected), [store])

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }, [])
  const flush = useCallback(() => {
    cancel()
    const workspace = current()
    const changedAt = store.changedAt
    const res = saveWorkspace(session, workspace, changedAt)
    if (!res.ok && res.newer) return opts.current.onNewer?.()
    setStatus(res.ok ? { state: 'saved', at: res.savedAt } : { state: 'error', error: res.error })
    if (!res.ok) return
    if (res.removed) opts.current.onRemoved?.(res.removed)
    if (session.fingerprint) announce({ fingerprint: session.fingerprint, changedAt, workspace })
  }, [session, store, cancel, current])

  // Something may have changed: save after a pause, unless it is the state the session started with
  const schedule = useCallback(() => {
    // Once something changed, every state is saved (also a change back to the initial one)
    if (!changed.current && JSON.stringify(current()) === initialJson) return
    changed.current = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS)
  }, [current, flush, initialJson])

  // A change of the analysis
  useEffect(() => store.subscribe(schedule), [store, schedule])
  // A change of the view
  useEffect(() => {
    viewRef.current = view
    schedule()
  }, [view, schedule])

  // Save pending changes when the page is hidden (another tab, minimised: its timers may be held
  // back from then on) or closed, or the session is left
  useEffect(() => {
    const onHide = () => timer.current !== undefined && flush()
    const onVisibility = () => document.visibilityState === 'hidden' && onHide()
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      onHide()
    }
  }, [flush])

  return { status, cancel }
}
