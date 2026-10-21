import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from './model/types'
import { deleteStoredSession, parseAnalysisJson } from './model/workspace'
import { loadSession } from './parsers/load'
import { Scope, type InitialState, type ScopeHandle, type SourceFile } from './components/Scope'
import { Logo } from './components/ui/Logo'
import { ErrorBoundary } from './components/ErrorBoundary'

const ACCEPT = '.tss,.wfm,.set,.scopeview,.json'
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
  const open = useCallback(
    async (files: File[]) => {
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
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [hasSession],
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

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      multiple
      hidden
      onChange={(e) => {
        open(Array.from(e.target.files ?? []))
        e.target.value = ''
      }}
    />
  )

  return (
    <>
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
          />
        </ErrorBoundary>
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
            <ul className="formats">
              <li>
                <b>Tektronix session</b> <code>.tss</code> (4/5/6-Series MSO)
              </li>
              <li>
                <b>Tektronix waveform</b> <code>.wfm</code>, optionally with a <code>.set</code> setup file
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
    </>
  )
}
