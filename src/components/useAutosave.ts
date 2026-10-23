import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '../model/types'
import { saveWorkspace, type LoadSource, type Workspace } from '../model/workspace'
import type { SaveStatus } from './TopBar'

/** Delay after the last change before the workspace is written */
const SAVE_DELAY_MS = 400

/**
 * Saves the workspace of a session in the browser shortly after each change, and at once when
 * the page is closed or the session is left. `boot` is the workspace the session started with:
 * a file that is only opened is not stored (saving starts with the first change), an imported or
 * migrated workspace is not in storage yet and is saved right away.
 *
 * Returns the save status and `cancel`, which drops a pending save (before the workspace is replaced).
 */
export function useAutosave(session: Session, workspace: Workspace, boot: { workspace: Workspace; source: LoadSource | 'file' }) {
  const [status, setStatus] = useState<SaveStatus>(() => (boot.source === 'saved' ? { state: 'saved', at: new Date().toISOString() } : { state: 'clean' }))
  // Comparing with the initial state (instead of skipping the first effect run) also holds when
  // effects run twice in development
  const [initialJson] = useState(() => (boot.source === 'saved' || boot.source === 'default' ? JSON.stringify(boot.workspace) : null))
  const changed = useRef(initialJson === null)
  const latest = useRef(workspace)
  const timer = useRef<number | undefined>(undefined)

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }, [])
  const flush = useCallback(() => {
    cancel()
    const res = saveWorkspace(session, latest.current)
    setStatus(res.ok ? { state: 'saved', at: res.savedAt } : { state: 'error', error: res.error })
  }, [session, cancel])

  useEffect(() => {
    latest.current = workspace
    // Once something changed, every state is saved (also a change back to the initial one)
    if (!changed.current && JSON.stringify(workspace) === initialJson) return
    changed.current = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS)
  }, [workspace, flush, initialJson])

  // Save pending changes when the page is closed or the session is left
  useEffect(() => {
    const onHide = () => timer.current !== undefined && flush()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      onHide()
    }
  }, [flush])

  return { status, cancel }
}
