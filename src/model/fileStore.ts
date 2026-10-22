/**
 * The session files themselves, kept in the browser (IndexedDB) so a stored session can be
 * reopened from the list without choosing the file again. Only the analysis (workspace) lives
 * in localStorage; files can be large, so they have their own store with size limits and
 * least-recently-opened eviction.
 */

const DB_NAME = 'scope-viewer'
const DB_VERSION = 1
const STORE = 'session-files'

/** Sessions larger than this are not kept */
export const MAX_SESSION_BYTES = 300 * 1024 * 1024
/** Upper bound of all kept files together (further limited to a share of the browser's quota) */
export const MAX_TOTAL_BYTES = 1024 * 1024 * 1024
const QUOTA_SHARE = 0.4

const KEEP_KEY = 'scope-viewer:keep-files'

export interface StoredFileInfo {
  fingerprint: string
  fileName: string
  bytes: number
  lastOpened: string
}

interface StoredFiles extends StoredFileInfo {
  files: { name: string; blob: Blob }[]
}

/** Whether opened session files are kept (a user setting, on by default) */
export function keepFilesEnabled(): boolean {
  try {
    return localStorage.getItem(KEEP_KEY) !== '0'
  } catch {
    return false
  }
}

export function setKeepFiles(on: boolean): void {
  try {
    localStorage.setItem(KEEP_KEY, on ? '1' : '0')
  } catch {
    // storage unavailable
  }
}

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'))
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'fingerprint' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('Cannot open the browser database'))
    })
    // Allow a retry after a failure (e.g. private mode)
    dbPromise.catch(() => (dbPromise = null))
  }
  return dbPromise
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await db()).transaction(STORE, mode).objectStore(STORE)
}

/** Kept sessions without their data, most recently opened first */
export async function listSessionFiles(): Promise<StoredFileInfo[]> {
  try {
    const all = (await request((await store('readonly')).getAll())) as StoredFiles[]
    return all.map(({ fingerprint, fileName, bytes, lastOpened }) => ({ fingerprint, fileName, bytes, lastOpened })).sort((a, b) => b.lastOpened.localeCompare(a.lastOpened))
  } catch {
    return []
  }
}

/** The kept files of a session, as File objects ready to open */
export async function loadSessionFiles(fingerprint: string): Promise<File[] | undefined> {
  try {
    const rec = (await request((await store('readonly')).get(fingerprint))) as StoredFiles | undefined
    return rec?.files.map((f) => new File([f.blob], f.name))
  } catch {
    return undefined
  }
}

export async function deleteSessionFiles(fingerprint: string): Promise<void> {
  try {
    await request((await store('readwrite')).delete(fingerprint))
  } catch {
    // nothing to delete
  }
}

/**
 * Sessions to drop (least recently opened first) so that `incoming` fits into `maxTotal`.
 * Returns undefined when it cannot fit even after dropping all others.
 */
export function planEviction(kept: StoredFileInfo[], incoming: { fingerprint: string; bytes: number }, maxTotal: number): string[] | undefined {
  if (incoming.bytes > maxTotal) return undefined
  const others = kept.filter((k) => k.fingerprint !== incoming.fingerprint).sort((a, b) => a.lastOpened.localeCompare(b.lastOpened))
  let total = others.reduce((n, k) => n + k.bytes, 0) + incoming.bytes
  const drop: string[] = []
  for (const k of others) {
    if (total <= maxTotal) break
    drop.push(k.fingerprint)
    total -= k.bytes
  }
  return total <= maxTotal ? drop : undefined
}

export type KeepResult = { kept: true } | { kept: false; reason: string }

/** Keep (or refresh) the files of an opened session */
export async function keepSessionFiles(fingerprint: string, fileName: string, files: { name: string; blob: Blob }[]): Promise<KeepResult> {
  const bytes = files.reduce((n, f) => n + f.blob.size, 0)
  if (bytes > MAX_SESSION_BYTES) return { kept: false, reason: `larger than ${MAX_SESSION_BYTES / 1024 / 1024} MB` }
  try {
    const now = new Date().toISOString()
    const existing = (await request((await store('readonly')).get(fingerprint))) as StoredFiles | undefined
    if (existing) {
      // Already kept: just mark it as recently opened
      await request((await store('readwrite')).put({ ...existing, fileName, lastOpened: now }))
      return { kept: true }
    }
    let limit = MAX_TOTAL_BYTES
    const estimate = await navigator.storage?.estimate?.().catch(() => undefined)
    if (estimate?.quota) limit = Math.min(limit, estimate.quota * QUOTA_SHARE)
    const drop = planEviction(await listSessionFiles(), { fingerprint, bytes }, limit)
    if (!drop) return { kept: false, reason: 'not enough browser storage' }
    for (const fp of drop) await deleteSessionFiles(fp)
    const rec: StoredFiles = { fingerprint, fileName, bytes, lastOpened: now, files }
    await request((await store('readwrite')).put(rec))
    return { kept: true }
  } catch (e) {
    return { kept: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

export async function clearSessionFiles(): Promise<void> {
  try {
    await request((await store('readwrite')).clear())
  } catch {
    // nothing stored
  }
}
