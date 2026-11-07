/**
 * What a family of scopes has to provide to be read: a `FormatAdapter`. `loadFiles` (session.ts) unpacks
 * archives and hands the files to the first adapter that finds a waveform of its own. A new family
 * (Rigol …) is a new adapter in its own file, added to the list in session.ts: nothing else changes.
 */
import type { Session } from '../model/types'

export interface InputFile {
  name: string
  data: ArrayBuffer
}

/** What the files were packed in: a session archive (.tss) or a plain zip */
export type ArchiveKind = 'tss' | 'zip'

/** A file of the session after archives are unpacked. `fromArchive`: it came out of one (its extras are ignored, not reported) */
export interface Entry {
  file: InputFile
  fromArchive: boolean
}

export interface LoadContext {
  /** What the files were packed in, if anything */
  archive: ArchiveKind | undefined
  /** The name of the session: the file's name, or "3 files" */
  name: string
  /** Whether a file belongs to one of the formats the viewer reads (of any adapter): the others are reported as unsupported */
  recognised: (file: InputFile) => boolean
}

export interface FormatAdapter {
  /** For the log and the tests: "tektronix" */
  id: string
  /** The extensions of its waveform files, for messages: ".wfm" */
  waveformExtensions: string[]
  /** Is the file a waveform of one of its formats, by its name or its content? */
  isWaveform: (file: InputFile) => boolean
  /** Does the file belong to it: a waveform, or what goes with one (a setup, a screenshot)? */
  recognises: (file: InputFile) => boolean
  /**
   * Make a session of the files. Files that cannot be read are left out and named in `session.warnings`;
   * it throws only when no waveform could be read, with the reason of the first file that failed.
   */
  load: (entries: Entry[], ctx: LoadContext) => Session
}

/** Trace colours for channels an instrument has no default for */
export const CHANNEL_COLORS = ['#f2e32c', '#22c8e6', '#ff3d5a', '#8fd43a', '#ff8a1c', '#4a63ff', '#c86bff', '#2fd6a0']

/** The name of a file without its folders (of either kind) */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * Channel id from a file name: "ch1.wfm" or "Tek000_CH1.wfm" → CH1 (also MATHn, REFn). Ids stay
 * unique within a session: a second file mapping to the same id (e.g. a digital channel
 * "ch1_d0.wfm") is named after the file instead. `preferred`: an id the file itself names.
 */
export function channelIdFromName(name: string, taken: Set<string>, preferred?: string): string {
  const stem = baseName(name).replace(/\.[^.]+$/, '')
  const m = stem.match(/(ch|math|ref)\s*_?(\d+)/i)
  let id = preferred ?? (m ? `${m[1].toUpperCase()}${m[2]}` : stem.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))
  if (taken.has(id)) id = stem.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  for (let n = 2; taken.has(id); n++) id = `${id.replace(/_\d+$/, '')}_${n}`
  taken.add(id)
  return id
}

/** The problem of a file no format knows */
export const unsupportedFile = (name: string): string => `${name}: unsupported file format`

/** One message for the files that could not be read: the first reason, and how many more there are */
export function reasonFor(problems: string[]): string {
  return problems.length > 1 ? `${problems[0]} (and ${problems.length - 1} more)` : problems[0]
}
