import { unzipSync, strFromU8 } from 'fflate'
import type { Channel, ChannelDisplay, Session, Waveform } from '../model/types'
import { niceStep } from '../util/format'
import { isTekWfm, parseTekWfm } from './tekWfm'
import { isTekIsf, parseTekIsf, type IsfDisplayHints } from './tekIsf'
import { parseTekSetup, readChannelInput, setupNumber, setupString } from './tekSetup'

/** Default trace colours of Tektronix 4/5/6-Series scopes, indexed by channel number. */
const TEK_COLORS: Record<string, string> = {
  CH1: '#f2e32c',
  CH2: '#22c8e6',
  CH3: '#ff3d5a',
  CH4: '#8fd43a',
  CH5: '#ff8a1c',
  CH6: '#4a63ff',
  CH7: '#c86bff',
  CH8: '#2fd6a0',
}
/** Trace colours of the older families (TDS, DPO/MSO2000–4000, MDO3000): yellow, cyan, magenta, green */
const TEK_LEGACY_COLORS: Record<string, string> = {
  CH1: '#f2e32c',
  CH2: '#22c8e6',
  CH3: '#e85ad6',
  CH4: '#8fd43a',
  MATH1: '#ff6e2a',
  REF1: '#d9d9d9',
  REF2: '#b8b8b8',
  REF3: '#9a9a9a',
  REF4: '#7d7d7d',
}
/** Trace colours for channels without a Tektronix default */
export const CHANNEL_COLORS = ['#f2e32c', '#22c8e6', '#ff3d5a', '#8fd43a', '#ff8a1c', '#4a63ff', '#c86bff', '#2fd6a0']

export interface InputFile {
  name: string
  data: ArrayBuffer
}

function toBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

const isZipData = (data: ArrayBuffer) => {
  const b = new Uint8Array(data, 0, Math.min(4, data.byteLength))
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}

/**
 * Channel id from a file name: "ch1.wfm" or "Tek000_CH1.wfm" → CH1 (also MATHn, REFn). Ids stay
 * unique within a session: a second file mapping to the same id (e.g. a digital channel
 * "ch1_d0.wfm") is named after the file instead.
 */
function channelIdFromName(name: string, taken: Set<string>, preferred?: string): string {
  const stem = baseName(name).replace(/\.[^.]+$/, '')
  const m = stem.match(/(ch|math|ref)\s*_?(\d+)/i)
  let id = preferred ?? (m ? `${m[1].toUpperCase()}${m[2]}` : stem.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))
  if (taken.has(id)) id = stem.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  for (let n = 2; taken.has(id); n++) id = `${id.replace(/_\d+$/, '')}_${n}`
  taken.add(id)
  return id
}

/** Pick a "nice" V/div that shows the whole waveform in ~8 divisions. */
function autoScale(w: Waveform): { scale: number; offset: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < w.data.length; i++) {
    const v = w.data[i]
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min)) return { scale: 1, offset: 0 }
  return { scale: niceStep(Math.max(max - min, 1e-9) / 8), offset: (max + min) / 2 }
}

interface BuildOptions {
  setup?: Record<string, string>
  screenshot?: Blob
  /** Display settings from the waveform files, used where the setup has none */
  hints?: Record<string, IsfDisplayHints>
  colors?: Record<string, string>
}

/**
 * Turn waveforms plus an optional setup into a session. Understands the setup commands of the
 * 4/5/6-Series (`:CHn:LABEL:NAME`, `:DISPLAY:WAVEVIEW1:…`) as well as those of the older families
 * (`:CHn:LABEL`, `:SELECT:CHn`, `:CURSOR:VBARS:…`).
 */
function buildSession(fileName: string, format: string, waves: Waveform[], o: BuildOptions = {}): Session {
  const s = o.setup ?? {}
  const colors = o.colors ?? TEK_COLORS
  waves.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  /** Setup value of a channel; the math waveform of the older scopes is just ":MATH" */
  const get = (id: string, suffix: string) => s[`:${id}${suffix}`] ?? (id === 'MATH1' ? s[`:MATH${suffix}`] : undefined)

  const channels: Channel[] = waves.map((wave, i) => {
    const id = wave.id
    const hint = o.hints?.[id] ?? {}
    const scale = setupNumber(get(id, ':SCALE')) ?? setupNumber(get(id, ':VERTICAL:SCALE')) ?? hint.scale
    const auto = scale === undefined ? autoScale(wave) : undefined
    const state = s[`:DISPLAY:WAVEVIEW1:${id}:STATE`] ?? s[`:SELECT:${id}`] ?? (id === 'MATH1' ? s[':SELECT:MATH'] : undefined)
    const display: ChannelDisplay = {
      id,
      label: setupString(get(id, ':LABEL:NAME')) ?? setupString(get(id, ':LABEL')) ?? '',
      color: colors[id] ?? CHANNEL_COLORS[i % CHANNEL_COLORS.length],
      // A waveform that was saved is shown, unless the setup says it was switched off
      visible: state === undefined ? true : state !== '0' && state.toUpperCase() !== 'OFF',
      scale: scale ?? auto!.scale,
      position: setupNumber(get(id, ':POSITION')) ?? setupNumber(get(id, ':VERTICAL:POSITION')) ?? hint.position ?? 0,
      offset: setupNumber(get(id, ':OFFSET')) ?? hint.offset ?? auto?.offset ?? 0,
    }
    // Coupling, termination, probe …: from the setup, the coupling also from an .isf header
    const fromSetup = o.setup ? readChannelInput((suffix) => get(id, suffix)) : undefined
    const input = hint.coupling && !fromSetup?.coupling ? { ...fromSetup, coupling: hint.coupling } : fromSetup
    return input ? { wave, display, input } : { wave, display }
  })

  const ids = new Set(channels.map((c) => c.wave.id))
  let views: string[][] = []
  const order = setupString(s[':MAINWINDOW:SOURCEORDER'])
  if (order && s[':DISPLAY:WAVEVIEW1:VIEWSTYLE'] !== 'OVERLAY') {
    // e.g. "0;ch1,ch6,ch2;ch4,ch5,ch3" - first token is not a source group
    views = order
      .split(';')
      .slice(1)
      .map((g) => g.split(',').map((x) => x.trim().toUpperCase()).filter((x) => ids.has(x)))
      .filter((g) => g.length > 0)
  }
  const placed = new Set(views.flat())
  const rest = channels.map((c) => c.wave.id).filter((id) => !placed.has(id))
  if (rest.length) {
    if (views.length) views[views.length - 1].push(...rest)
    else views = [rest]
  }

  const session: Session = { fileName, format, channels, views, screenshot: o.screenshot }
  if (o.setup) {
    session.setup = o.setup
    const hScale = setupNumber(s[':HORIZONTAL:SCALE']) ?? setupNumber(s[':HORIZONTAL:MAIN:SCALE'])
    if (hScale !== undefined) {
      const delayOn = /^(1|ON)$/i.test(s[':HORIZONTAL:DELAY:MODE'] ?? s[':HORIZONTAL:DELAY:STATE'] ?? '')
      session.horizontal = {
        scale: hScale,
        position: setupNumber(s[':HORIZONTAL:POSITION']) ?? 50,
        sampleRate: setupNumber(s[':HORIZONTAL:SAMPLERATE']),
        delay: delayOn ? setupNumber(s[':HORIZONTAL:DELAY:TIME']) : undefined,
      }
    }
    const trigSrc = s[':TRIGGER:A:EDGE:SOURCE']
    if (trigSrc) {
      session.trigger = {
        source: trigSrc,
        level: setupNumber(s[`:TRIGGER:A:LEVEL:${trigSrc}`]) ?? setupNumber(s[':TRIGGER:A:LEVEL']),
        slope: s[':TRIGGER:A:EDGE:SLOPE'],
      }
    }
    // Cursors: 4/5/6-Series waveform cursors, or the vertical bars of the older families
    if (s[':DISPLAY:WAVEVIEW1:CURSOR:CURSOR:STATE'] === '1') {
      const a = setupNumber(s[':DISPLAY:WAVEVIEW1:CURSOR:CURSOR:WAVEFORM:APOSITION'])
      const b = setupNumber(s[':DISPLAY:WAVEVIEW1:CURSOR:CURSOR:WAVEFORM:BPOSITION'])
      if (a !== undefined && b !== undefined) {
        session.cursors = { a, b, source: s[':DISPLAY:WAVEVIEW1:CURSOR:CURSOR:ASOURCE'] }
      }
    } else if (/^(VBARS|WAVEFORM|WAVEFORMS|SCREEN)$/i.test(s[':CURSOR:FUNCTION'] ?? '')) {
      const a = setupNumber(s[':CURSOR:VBARS:POSITION1'])
      const b = setupNumber(s[':CURSOR:VBARS:POSITION2'])
      if (a !== undefined && b !== undefined) {
        const src = s[':CURSOR:SOURCE']
        session.cursors = { a, b, source: src && ids.has(src.toUpperCase()) ? src.toUpperCase() : undefined }
      }
    }
    // Measurements that are switched on
    const meas: { type: string; source: string }[] = []
    for (const key of Object.keys(s)) {
      const m = key.match(/^:MEASUREMENT:(MEAS\d+):TYPE$/)
      if (!m || s[`:MEASUREMENT:${m[1]}:STATE`] === '0') continue
      meas.push({ type: s[key], source: s[`:MEASUREMENT:${m[1]}:SOURCE1`] ?? '' })
    }
    session.measurements = meas
  }
  return session
}

function readSetup(content: Uint8Array): Record<string, string> {
  // Either a zip containing the learn file (4/5/6-Series sessions), or the setup text itself
  if (content[0] === 0x50 && content[1] === 0x4b) {
    let setup: Record<string, string> = {}
    for (const inner of Object.values(unzipSync(content))) setup = { ...setup, ...parseTekSetup(strFromU8(inner, true)) }
    return setup
  }
  return parseTekSetup(strFromU8(content, true))
}

/**
 * Load one or more files into a session. Supports:
 *  - Tektronix .tss session archives (4/5/6-Series)
 *  - Tektronix .wfm waveforms (WFM#001–003)
 *  - Tektronix .isf waveforms (TDS, DPO/MSO2000–4000, MDO3000/4000)
 *  - with a .set setup file and a screenshot, as separate files or together in a .zip
 */
export function loadFiles(files: InputFile[]): Session {
  // Unpack archives: a .tss, or a .zip of saved scope files ("Save All" folder)
  let archive: 'tss' | 'zip' | undefined
  const entries: { file: InputFile; fromArchive: boolean }[] = []
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

  const waves: Waveform[] = []
  const hints: Record<string, IsfDisplayHints> = {}
  const ids = new Set<string>()
  const kinds = new Set<'wfm' | 'isf'>()
  let setup: Record<string, string> | undefined
  let screenshot: Blob | undefined
  for (const { file, fromArchive } of entries) {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.set')) {
      setup = { ...setup, ...readSetup(new Uint8Array(file.data)) }
    } else if (lower.endsWith('.wfm') || isTekWfm(file.data)) {
      waves.push(parseTekWfm(file.data, channelIdFromName(file.name, ids)))
      kinds.add('wfm')
    } else if (lower.endsWith('.isf') || isTekIsf(file.data)) {
      // The channel comes from the waveform id inside the file ("Ch1, DC coupling, …"), else from the name
      const probe = parseTekIsf(file.data, file.name)
      const id = channelIdFromName(file.name, ids, probe.channel && !ids.has(probe.channel) ? probe.channel : undefined)
      waves.push({ ...probe.wave, id })
      hints[id] = probe.hints
      kinds.add('isf')
    } else if (/\.(png|jpe?g|bmp)$/i.test(lower)) {
      const type = lower.endsWith('.png') ? 'image/png' : lower.endsWith('.bmp') ? 'image/bmp' : 'image/jpeg'
      screenshot ??= new Blob([file.data], { type })
    } else if (!fromArchive) {
      throw new Error(`${file.name}: unsupported file format`)
    }
    // Other files inside an archive (manifest.json, CSV copies, …) are ignored
  }
  if (!waves.length) throw new Error(archive ? 'The archive contains no waveform files (.wfm or .isf)' : 'No waveform files found')

  const name = files.length === 1 ? files[0].name : `${files.length} files`
  const format =
    archive === 'tss'
      ? 'Tektronix session (.tss)'
      : `Tektronix waveform${waves.length > 1 ? 's' : ''} (${[...kinds].map((k) => `.${k}`).join(', ')})${archive === 'zip' ? ' in .zip' : ''}`
  return buildSession(name, format, waves, { setup, screenshot, hints, colors: kinds.has('isf') && !kinds.has('wfm') ? TEK_LEGACY_COLORS : TEK_COLORS })
}
