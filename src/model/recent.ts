import { deleteSessionFiles, listSessionFiles, type StoredFileInfo } from './fileStore'
import { deleteStoredSession, listStoredSessions, type StoredSessionInfo } from './workspace'

/** A session known to this browser: its saved analysis and/or its kept files */
export interface RecentSession {
  fingerprint: string
  fileName: string
  /** Last time it was opened or its analysis saved */
  lastUsed: string
  /** Size of the saved analysis (undefined: no changes saved) */
  analysisBytes?: number
  /** Size of the kept session files (undefined: file not kept, must be located) */
  fileBytes?: number
}

/** Merge the saved analyses and the kept files into one list, most recently used first */
export function mergeRecent(analyses: StoredSessionInfo[], files: StoredFileInfo[]): RecentSession[] {
  const byFp = new Map<string, RecentSession>()
  for (const a of analyses) byFp.set(a.fingerprint, { fingerprint: a.fingerprint, fileName: a.fileName, lastUsed: a.savedAt, analysisBytes: a.bytes })
  for (const f of files) {
    const r = byFp.get(f.fingerprint)
    if (r) {
      r.fileBytes = f.bytes
      if (f.lastOpened > r.lastUsed) r.lastUsed = f.lastOpened
    } else byFp.set(f.fingerprint, { fingerprint: f.fingerprint, fileName: f.fileName, lastUsed: f.lastOpened, fileBytes: f.bytes })
  }
  return [...byFp.values()].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed))
}

export async function listRecentSessions(): Promise<RecentSession[]> {
  return mergeRecent(listStoredSessions(), await listSessionFiles())
}

/** Remove everything this browser keeps about a session: its analysis and its files */
export async function forgetSession(fingerprint: string): Promise<void> {
  deleteStoredSession(fingerprint)
  await deleteSessionFiles(fingerprint)
}
