import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'

/**
 * A session bundle (.scopeview) is a zip with the original session file(s) under
 * files/ and the analysis (workspace) as scopeview.json. Opening it restores both.
 */
export const BUNDLE_ANALYSIS = 'scopeview.json'
const FILES_DIR = 'files/'

export interface NamedData {
  name: string
  data: ArrayBuffer
}

export function buildBundle(sources: NamedData[], analysisJson: string): Blob {
  const entries: Zippable = { [BUNDLE_ANALYSIS]: strToU8(analysisJson) }
  // Session files are zips / binary already: store them without recompressing
  for (const s of sources) entries[FILES_DIR + s.name] = [new Uint8Array(s.data), { level: 0 }]
  const zipped = zipSync(entries)
  return new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
}

export function isBundleName(name: string): boolean {
  return /\.scopeview$/i.test(name)
}

export function unpackBundle(data: ArrayBuffer): { files: NamedData[]; analysis?: string } {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(data))
  } catch {
    throw new Error('The .scopeview file is damaged (not a zip archive)')
  }
  const files: NamedData[] = []
  for (const [path, content] of Object.entries(entries)) {
    if (!path.startsWith(FILES_DIR) || path.endsWith('/')) continue
    files.push({ name: path.slice(FILES_DIR.length), data: content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer })
  }
  if (!files.length) throw new Error('The .scopeview file contains no session file')
  const a = entries[BUNDLE_ANALYSIS]
  return { files, analysis: a ? strFromU8(a) : undefined }
}
