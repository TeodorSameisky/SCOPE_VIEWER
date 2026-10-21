import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from './model/types'
import { loadSession } from './parsers/load'
import { Scope } from './components/Scope'

const ACCEPT = '.tss,.wfm,.set'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [generation, setGeneration] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const open = useCallback(async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    setError(null)
    try {
      setSession(await loadSession(files))
      setGeneration((g) => g + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
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
      {session ? (
        <Scope key={generation} session={session} onOpen={() => inputRef.current?.click()} onClose={() => setSession(null)} />
      ) : (
        <div className="landing">
          <div className="landing-card">
            <div className="brand big">
              <span className="logo">◢</span> Scope Viewer
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
              <li className="muted">
                <b>Rigol</b>: coming soon
              </li>
            </ul>
          </div>
        </div>
      )}
      {busy && session && <div className="busy-overlay">Reading file…</div>}
      {error && session && (
        <div className="toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {dragOver && <div className="drop-overlay">Drop to open</div>}
    </>
  )
}
