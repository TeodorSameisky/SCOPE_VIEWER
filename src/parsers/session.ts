import { unzipSync } from 'fflate'
import type { Session } from '../model/types'
import { baseName, reasonFor, unsupportedFile, type ArchiveKind, type Entry, type FormatAdapter, type InputFile } from './formats'
import { tektronix } from './tektronix'

export { CHANNEL_COLORS, type InputFile } from './formats'

/**
 * The file formats the viewer reads, in the order they are tried: the first adapter that finds a
 * waveform of its own among the files loads them all. To read another family (Rigol …), write its
 * adapter (see formats.ts) and add it here.
 */
const ADAPTERS: FormatAdapter[] = [tektronix]

function toBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

const isZipData = (data: ArrayBuffer) => {
  const b = new Uint8Array(data, 0, Math.min(4, data.byteLength))
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}

/**
 * Unpack archives: a .tss session, or a .zip of saved scope files (a "Save All" folder). Anything
 * that starts like a zip is one, except setups (a zipped learn file) and bundles. The files in the
 * archives are named without their folders; folders and the junk macOS adds are left out.
 */
export function unpack(files: InputFile[]): { entries: Entry[]; archive: ArchiveKind | undefined } {
  let archive: ArchiveKind | undefined
  const entries: Entry[] = []
  for (const f of files) {
    const tss = /\.tss$/i.test(f.name)
    if (tss || /\.zip$/i.test(f.name) || (isZipData(f.data) && !/\.(set|scopeview)$/i.test(f.name))) {
      archive = tss ? 'tss' : (archive ?? 'zip')
      let unzipped: Record<string, Uint8Array>
      try {
        unzipped = unzipSync(new Uint8Array(f.data))
      } catch {
        throw new Error(`${f.name}: the archive is damaged`)
      }
      for (const [path, content] of Object.entries(unzipped)) {
        if (path.endsWith('/') || path.startsWith('__MACOSX/') || baseName(path).startsWith('._')) continue
        entries.push({ file: { name: baseName(path), data: toBuffer(content) }, fromArchive: true })
      }
    } else {
      entries.push({ file: f, fromArchive: false })
    }
  }
  return { entries, archive }
}

/**
 * Load one or more files into a session: the waveforms of a scope with its setup and screenshot, as
 * separate files or in an archive. See the adapters for the formats; this finds the one to use and
 * says what is wrong when there is none. `adapters` is the list to choose from (tests pass their own).
 */
export function loadFiles(files: InputFile[], adapters: FormatAdapter[] = ADAPTERS): Session {
  const { entries, archive } = unpack(files)
  const recognised = (file: InputFile) => adapters.some((a) => a.recognises(file))
  const adapter = adapters.find((a) => entries.some((e) => a.isWaveform(e.file)))
  if (!adapter) {
    // Nothing to show: say what is wrong with the files
    const unsupported = entries.filter((e) => !e.fromArchive && !recognised(e.file)).map((e) => unsupportedFile(e.file.name))
    if (unsupported.length) throw new Error(reasonFor(unsupported))
    const extensions = adapters.flatMap((a) => a.waveformExtensions).join(' or ')
    throw new Error(archive ? `The archive contains no waveform files (${extensions})` : 'No waveform files found')
  }
  const name = files.length === 1 ? files[0].name : `${files.length} files`
  return adapter.load(entries, { archive, name, recognised })
}
