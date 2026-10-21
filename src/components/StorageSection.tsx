import { useState } from 'react'
import { Archive, FileJson, RotateCcw, Trash2 } from 'lucide-react'
import { MAX_STORED_SESSIONS, deleteStoredSession, listStoredSessions } from '../model/workspace'
import type { SaveStatus } from './TopBar'

interface Props {
  fingerprint?: string
  status: SaveStatus
  notes: string
  setNotes: (s: string) => void
  onSaveAnalysis: () => void
  onSaveBundle: () => void
  onReset: () => void
}

/** Session panel section: where the work is kept, saving it to files, managing stored sessions */
export function StorageSection(p: Props) {
  // Read when the panel opens and after forgetting sessions (the list lives in localStorage)
  const [stored, setStored] = useState(listStoredSessions)
  const forget = (fingerprints: string[]) => {
    fingerprints.forEach(deleteStoredSession)
    setStored(listStoredSessions())
  }
  const totalBytes = stored.reduce((n, s) => n + s.bytes, 0)
  const others = stored.filter((s) => s.fingerprint !== p.fingerprint)

  return (
    <section className="storage">
      <h4>Notes</h4>
      <textarea rows={3} value={p.notes} placeholder="Describe the event, test conditions, conclusions… (saved with the session, used in reports)" onChange={(e) => p.setNotes(e.target.value)} />

      <h4>Saving</h4>
      <p className={`hint ${p.status.state === 'error' ? 'warn' : ''}`}>
        {p.status.state === 'error'
          ? `Changes cannot be saved in this browser: ${p.status.error}. Save an analysis file to keep them.`
          : 'Channel settings, math channels, spectra, callouts, cursors, notes and the view are saved automatically in this browser and come back when you open the same file again.'}
      </p>
      <div className="button-row">
        <button type="button" onClick={p.onSaveAnalysis} title="A small file with your analysis, to keep or share; open it together with the session file">
          <FileJson size={14} aria-hidden /> Save analysis
        </button>
        <button type="button" onClick={p.onSaveBundle} title="One file with the session data and your analysis">
          <Archive size={14} aria-hidden /> Save with session
        </button>
        <button type="button" className="text-btn danger" onClick={p.onReset} title="Discard your changes and show the file as saved on the scope">
          <RotateCcw size={13} aria-hidden /> Reset
        </button>
      </div>

      <h4>
        Stored in this browser <span className="muted">({stored.length}, {Math.ceil(totalBytes / 1024)} kB)</span>
      </h4>
      {stored.length === 0 ? (
        <p className="hint">Nothing stored yet.</p>
      ) : (
        <ul className="stored-list">
          {stored.map((s) => (
            <li key={s.fingerprint} className={s.fingerprint === p.fingerprint ? 'current' : ''}>
              <div>
                <strong title={s.fileName}>{s.fileName}</strong>
                <span className="muted">
                  {s.fingerprint === p.fingerprint ? 'open now · ' : ''}
                  {new Date(s.savedAt).toLocaleString()} · {Math.ceil(s.bytes / 1024)} kB
                </span>
              </div>
              {s.fingerprint !== p.fingerprint && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Forget this session"
                  aria-label={`Forget ${s.fileName}`}
                  onClick={() => forget([s.fingerprint])}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {others.length > 1 && (
        <button
          type="button"
          className="text-btn danger"
          onClick={() => {
            if (!confirm(`Forget the saved state of ${others.length} other session files?`)) return
            forget(others.map((s) => s.fingerprint))
          }}
        >
          Forget all other sessions
        </button>
      )}
      <p className="hint">Sessions are recognised by the content of the file, not its name. The {MAX_STORED_SESSIONS} most recently used are kept.</p>
    </section>
  )
}
