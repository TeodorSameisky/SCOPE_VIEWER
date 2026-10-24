import { useState } from 'react'
import { Archive, FileJson, RotateCcw } from 'lucide-react'
import { MAX_SESSION_BYTES, MAX_TOTAL_BYTES, clearSessionFiles, keepFilesEnabled, setKeepFiles } from '../model/fileStore'
import { forgetSession, type RecentSession } from '../model/recent'
import { MAX_STORED_SESSIONS, type SaveStatus } from '../model/workspace'
import { formatBytes } from '../util/format'
import { RecentSessions } from './RecentSessions'
import { useFeedback } from './ui/feedbackContext'

interface Props {
  fingerprint?: string
  status: SaveStatus
  notes: string
  setNotes: (s: string) => void
  onSaveAnalysis: () => void
  onSaveBundle: () => void
  onReset: () => void
  /** Switch to another stored session */
  onOpenStored: (r: RecentSession) => void
  /** Keep the files of the open session (when keeping files is switched on) */
  onKeepCurrent: () => Promise<void>
  /** Changes when files were kept, to refresh the list */
  filesVersion: number
}

/** Session panel section: where the work is kept, saving it to files, managing stored sessions */
export function StorageSection(p: Props) {
  const { confirm } = useFeedback()
  const [recent, setRecent] = useState<RecentSession[]>([])
  const [keep, setKeep] = useState(keepFilesEnabled)
  // Bumped after changes made here (forget all, keep files on/off) to reload the list
  const [version, setVersion] = useState(0)
  const others = recent.filter((r) => r.fingerprint !== p.fingerprint)

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

      <h4>Sessions in this browser</h4>
      <p className="hint">Click a session to switch to it; your changes to this one are saved first.</p>
      <RecentSessions current={p.fingerprint} onOpen={p.onOpenStored} refreshKey={`${p.filesVersion}:${version}`} onLoaded={setRecent} />
      <label className="check keep-files" title="Keep the session files, so they can be reopened from this list without choosing them again">
        <input
          type="checkbox"
          checked={keep}
          onChange={async (e) => {
            if (e.target.checked) {
              setKeepFiles(true)
              setKeep(true)
              await p.onKeepCurrent()
            } else {
              const kept = recent.filter((r) => r.fileBytes !== undefined).length
              const ok =
                !kept ||
                (await confirm({
                  title: 'Stop keeping session files?',
                  message: `The ${kept} kept file${kept > 1 ? 's are' : ' is'} deleted from this browser. Saved analyses stay.`,
                  confirmLabel: 'Delete kept files',
                  danger: true,
                }))
              if (!ok) return
              setKeepFiles(false)
              setKeep(false)
              await clearSessionFiles()
            }
            setVersion((v) => v + 1)
          }}
        />
        Keep session files in this browser
      </label>
      <p className="hint storage-usage">
        In use: {formatBytes(recent.reduce((n, r) => n + (r.fileBytes ?? 0), 0))} of session files, {formatBytes(recent.reduce((n, r) => n + (r.analysisBytes ?? 0), 0))} of analyses
      </p>
      {others.length > 1 && (
        <button
          type="button"
          className="text-btn danger"
          onClick={async () => {
            const ok = await confirm({
              title: `Forget ${others.length} other sessions?`,
              message: 'Their saved analyses and kept files are deleted from this browser. This cannot be undone.',
              confirmLabel: 'Forget them',
              danger: true,
            })
            if (!ok) return
            for (const r of others) await forgetSession(r.fingerprint)
            setVersion((v) => v + 1)
          }}
        >
          Forget all other sessions
        </button>
      )}
      <p className="hint">
        Sessions are recognised by the content of the file, not its name. The {MAX_STORED_SESSIONS} most recently changed analyses are kept; files up to{' '}
        {MAX_SESSION_BYTES / 1024 / 1024} MB each and {MAX_TOTAL_BYTES / 1024 / 1024 / 1024} GB in total, the least recently opened are dropped first.
      </p>
    </section>
  )
}
