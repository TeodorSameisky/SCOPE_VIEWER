import { useEffect, useState } from 'react'
import { FileSearch, FileText, FolderOpen, Trash2 } from 'lucide-react'
import { forgetSession, listRecentSessions, type RecentSession } from '../model/recent'
import { formatBytes } from '../util/format'
import { useContextMenu } from './ui/menuContext'

interface Props {
  /** Fingerprint of the session that is open (shown, but not offered to open) */
  current?: string
  onOpen: (r: RecentSession) => void
  /** Change to re-read the list (e.g. after files were kept) */
  refreshKey?: unknown
  /** Called with the list whenever it was (re)loaded */
  onLoaded?: (list: RecentSession[]) => void
  /** At most this many entries */
  limit?: number
}

function when(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  return d.toDateString() === today.toDateString() ? `today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

/** Sessions known to this browser: click one to switch to it */
export function RecentSessions({ current, onOpen, refreshKey, onLoaded, limit }: Props) {
  const [list, setList] = useState<RecentSession[] | null>(null)
  const [version, setVersion] = useState(0)
  const menu = useContextMenu()
  const forget = async (r: RecentSession) => {
    await forgetSession(r.fingerprint)
    setVersion((v) => v + 1)
  }

  useEffect(() => {
    let alive = true
    listRecentSessions().then((l) => {
      if (!alive) return
      setList(l)
      onLoaded?.(l)
    })
    return () => {
      alive = false
    }
    // onLoaded is a notification, not an input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, version])

  if (!list) return null
  if (!list.length) return <p className="hint">No sessions stored yet.</p>
  const shown = limit ? list.slice(0, limit) : list

  return (
    <ul className="recent-list">
      {shown.map((r) => {
        const isCurrent = r.fingerprint === current
        const kept = r.fileBytes !== undefined
        return (
          <li
            key={r.fingerprint}
            className={isCurrent ? 'current' : ''}
            onContextMenu={(e) =>
              !isCurrent &&
              menu(e, [
                { kind: 'heading', label: r.fileName },
                kept
                  ? { label: 'Open', icon: FolderOpen, onClick: () => onOpen(r) }
                  : { label: 'Locate the file…', icon: FileSearch, onClick: () => onOpen(r) },
                '-',
                { label: 'Forget this session', icon: Trash2, danger: true, title: 'Delete its analysis and kept file from this browser', onClick: () => forget(r) },
              ])
            }
          >
            <button
              type="button"
              className="recent-open"
              disabled={isCurrent}
              title={isCurrent ? 'This session is open' : kept ? `Open ${r.fileName}` : `${r.fileName} is not kept in this browser: choose the file to open it with its analysis`}
              onClick={() => onOpen(r)}
            >
              {kept || isCurrent ? <FileText size={16} aria-hidden /> : <FileSearch size={16} aria-hidden />}
              <span className="recent-text">
                <strong>{r.fileName}</strong>
                <span className="muted">
                  {isCurrent ? 'open now' : when(r.lastUsed)}
                  {r.analysisBytes !== undefined && ` · analysis ${formatBytes(r.analysisBytes)}`}
                  {kept ? ` · file ${formatBytes(r.fileBytes!)}` : ' · file not kept'}
                </span>
              </span>
              {!isCurrent && <span className="recent-action">{kept ? 'Open' : 'Locate…'}</span>}
            </button>
            {!isCurrent && (
              <button
                type="button"
                className="icon-btn"
                title="Forget this session (its analysis and kept file)"
                aria-label={`Forget ${r.fileName}`}
                onClick={() => forget(r)}
              >
                <Trash2 size={14} />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
