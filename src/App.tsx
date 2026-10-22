import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from './model/types'
import { deleteStoredSession, parseAnalysisJson } from './model/workspace'
import { keepFilesEnabled, keepSessionFiles, loadSessionFiles } from './model/fileStore'
import type { RecentSession } from './model/recent'
import { RecentSessions } from './components/RecentSessions'
import { loadSession } from './parsers/load'
import { Scope, type InitialState, type ScopeHandle, type SourceFile } from './components/Scope'
import { Logo } from './components/ui/Logo'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ContextMenuProvider } from './components/ui/ContextMenu'
import { PwaStatus } from './components/PwaStatus'
import { installApp, useCanInstall } from './pwa/install'
import { onLaunchFiles } from './pwa/launch'
import { MonitorDown } from 'lucide-react'

const ACCEPT = '.tss,.wfm,.isf,.set,.zip,.png,.scopeview,.json'
const isJson = (f: File) => /\.json$/i.test(f.name)

interface Current {
  session: Session
  sources: SourceFile[]
  initial: InitialState
  /** Bumped to remount the workspace (new file, imported analysis, reset) */
  generation: number
}

export default function App() {
  const [current, setCurrent] = useState<Current | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scopeRef = useRef<ScopeHandle>(null)
  const hasSession = current !== null

  /**
   * Open session files. An analysis file (.scopeview.json) can be opened together with
   * its session file, or on its own to apply it to the open session.
   */
  // Session files are kept in the browser after opening, so stored sessions can be reopened
  const [filesVersion, setFilesVersion] = useState(0)
  const keepFiles = useCallback(async (session: Session, sources: SourceFile[]) => {
    if (!keepFilesEnabled() || !session.fingerprint) return
    const r = await keepSessionFiles(session.fingerprint, session.fileName, sources)
    if (r.kept) setFilesVersion((v) => v + 1)
  }, [])

  const open = useCallback(
    /** `expected`: the stored session the user is locating (checked against the chosen file) */
    async (files: File[], expected?: RecentSession) => {
      if (!files.length) return
      const jsons = files.filter(isJson)
      const data = files.filter((f) => !isJson(f))
      setError(null)
      if (!data.length) {
        if (hasSession) await scopeRef.current?.importAnalysisFile(jsons[0])
        else setError('Open the session file (.tss, .wfm or .scopeview) together with the analysis file.')
        return
      }
      setBusy(true)
      try {
        const loaded = await loadSession(data)
        let initial: InitialState = { kind: 'stored' }
        const text = jsons.length ? await jsons[0].text() : loaded.analysis
        if (text) {
          const parsed = parseAnalysisJson(text)
          const fp = loaded.session.fingerprint
          const foreign = parsed.fingerprint && fp && parsed.fingerprint !== fp
          if (!foreign || confirm('The analysis file was saved for a different session file. Apply it anyway?')) {
            initial = parsed.kind === 'analysis' ? { kind: 'analysis', workspace: parsed.workspace } : { kind: 'stored', addCallouts: parsed.callouts }
          }
        }
        // Keep the session files for "Save bundle": the dropped files, or the files inside a bundle
        const sources: SourceFile[] = loaded.analysis !== undefined || /\.scopeview$/i.test(data[0].name)
          ? loaded.sources.map((s) => ({ name: s.name, blob: new Blob([s.data]) }))
          : data.map((f) => ({ name: f.name, blob: f }))
        setCurrent((c) => ({ session: loaded.session, sources, initial, generation: (c?.generation ?? 0) + 1 }))
        if (expected && loaded.session.fingerprint && expected.fingerprint !== loaded.session.fingerprint) {
          setError(`This is not the stored session “${expected.fileName}” (the content differs), so it was opened on its own.`)
        }
        void keepFiles(loaded.session, sources)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [hasSession, keepFiles],
  )

  /** Switch to a session stored in this browser; without its kept file, ask for the file */
  const locateRef = useRef<RecentSession | null>(null)
  const openStored = useCallback(
    async (r: RecentSession) => {
      const files = r.fileBytes !== undefined ? await loadSessionFiles(r.fingerprint) : undefined
      if (files?.length) return open(files)
      locateRef.current = r
      inputRef.current?.click()
    },
    [open],
  )

  /** Remount the open session with another workspace (imported analysis or reset) */
  const replaceWorkspace = useCallback((initial: InitialState) => {
    setCurrent((c) => (c ? { ...c, initial, generation: c.generation + 1 } : c))
  }, [])

  // Allow dropping a file anywhere, also while a session is open
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      setDragOver(true)
    }
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragOver(false)
    }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      open(Array.from(e.dataTransfer?.files ?? []))
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [open])

  // Files opened from the operating system with the installed app ("Open with", double-click)
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  })
  const launched = useRef(false)
  useEffect(
    () =>
      onLaunchFiles((files) => {
        launched.current = true
        openRef.current(files)
      }),
    [],
  )

  // Stay in the session across a page reload (F5, or "Reload" for a new version): the open session
  // is remembered per tab and reopened from the files kept in the browser. A new tab or window
  // starts on the start page.
  const [toRestore] = useState(readOpenSession)
  const [restoring, setRestoring] = useState(toRestore !== null)
  useEffect(() => {
    if (!toRestore) return
    let cancelled = false
    ;(async () => {
      const files = await loadSessionFiles(toRestore.fingerprint)
      // A file launched from the operating system takes precedence
      if (cancelled || launched.current) return
      if (files?.length) await openRef.current(files)
      else setError(`“${toRestore.fileName}” could not be reopened after reloading, because its file is not kept in this browser. Open it again.`)
      setRestoring(false)
    })()
    return () => {
      cancelled = true
    }
  }, [toRestore])
  useEffect(() => {
    const fp = current?.session.fingerprint
    if (restoring) return
    rememberOpenSession(fp ? { fingerprint: fp, fileName: current!.session.fileName } : null)
  }, [current, restoring])

  // Closing the file dialog without a file ends a "Locate…"
  useEffect(() => {
    const input = inputRef.current
    const cancel = () => (locateRef.current = null)
    input?.addEventListener('cancel', cancel)
    return () => input?.removeEventListener('cancel', cancel)
  }, [])

  const canInstall = useCanInstall()
  const [recentCount, setRecentCount] = useState(0)

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      multiple
      hidden
      onChange={(e) => {
        open(Array.from(e.target.files ?? []), locateRef.current ?? undefined)
        locateRef.current = null
        e.target.value = ''
      }}

    />
  )

  return (
    <ContextMenuProvider>
      {picker}
      {current ? (
        <ErrorBoundary
          key={current.generation}
          onClose={() => setCurrent(null)}
          onReset={() => {
            // A broken saved state must not make the file unusable: forget it and show the file defaults
            if (current.session.fingerprint) deleteStoredSession(current.session.fingerprint)
            replaceWorkspace({ kind: 'defaults' })
          }}
        >
          <Scope
            ref={scopeRef}
            session={current.session}
            sources={current.sources}
            initial={current.initial}
            onOpen={() => inputRef.current?.click()}
            onClose={() => setCurrent(null)}
            onReplaceWorkspace={replaceWorkspace}
            onOpenStored={openStored}
            onKeepFiles={() => keepFiles(current.session, current.sources)}
            filesVersion={filesVersion}
          />
        </ErrorBoundary>
      ) : restoring && toRestore ? (
        <div className="landing">
          <div className="landing-card">
            <div className="brand big">
              <Logo size={30} /> Scope Viewer
            </div>
            <p>Reopening {toRestore.fileName}…</p>
          </div>
        </div>
      ) : (
        <div className="landing">
          <div className="landing-card">
            <div className="brand big">
              <Logo size={30} /> Scope Viewer
            </div>
            <p>View and analyse oscilloscope session files in your browser. Files are processed locally and never uploaded.</p>
            <button className="drop-target" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? 'Reading file…' : (
                <>
                  <strong>Drop a session file here</strong>
                  <span>or click to choose a file</span>
                </>
              )}
            </button>
            {error && <div className="error">{error}</div>}
            <div className={`recent ${recentCount ? '' : 'hidden'}`}>
              <h4>Recent sessions</h4>
              <RecentSessions onOpen={openStored} refreshKey={filesVersion} onLoaded={(l) => setRecentCount(l.length)} limit={8} />
            </div>
            {canInstall && (
              <div className="install-hint">
                <button type="button" className="primary" onClick={() => installApp()}>
                  <MonitorDown size={16} aria-hidden /> Install Scope Viewer
                </button>
                <span>Runs in its own window, works offline and opens .tss files from the file explorer.</span>
              </div>
            )}
            <ul className="formats">
              <li>
                <b>Tektronix session</b> <code>.tss</code> (4/5/6-Series MSO)
              </li>
              <li>
                <b>Tektronix waveform</b> <code>.wfm</code>, optionally with a <code>.set</code> setup file
              </li>
              <li>
                <b>Older Tektronix scopes</b> <code>.isf</code> (TDS, DPO/MSO2000–4000, MDO3000/4000), with <code>.set</code> and screenshot; or the
                saved files together in a <code>.zip</code>
              </li>
              <li>
                <b>Scope Viewer bundle</b> <code>.scopeview</code>: a session with its analysis; or a session file together with its{' '}
                <code>.scopeview.json</code> analysis
              </li>
              <li className="muted">
                <b>Rigol</b>: coming soon
              </li>
            </ul>
            <p className="legal">
              MIT License ·{' '}
              <a href={`${import.meta.env.BASE_URL}third-party-licenses.txt`} target="_blank" rel="noreferrer">
                Licenses of the software used
              </a>
            </p>
          </div>
        </div>
      )}
      {busy && current && <div className="busy-overlay">Reading file…</div>}
      {error && current && (
        <div className="toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {dragOver && <div className="drop-overlay">Drop to open</div>}
      <PwaStatus />
    </ContextMenuProvider>
  )
}

const OPEN_KEY = 'scope-viewer:open-session'

/** The session that was open in this tab before a reload (sessionStorage is per tab) */
function readOpenSession(): { fingerprint: string; fileName: string } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? 'null')
    return v && typeof v.fingerprint === 'string' && typeof v.fileName === 'string' ? v : null
  } catch {
    return null
  }
}

function rememberOpenSession(v: { fingerprint: string; fileName: string } | null): void {
  try {
    if (v) sessionStorage.setItem(OPEN_KEY, JSON.stringify(v))
    else sessionStorage.removeItem(OPEN_KEY)
  } catch {
    // storage unavailable: the session just is not reopened after a reload
  }
}
