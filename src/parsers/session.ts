import { unzipSync, strFromU8 } from 'fflate'
import type { Channel, ChannelDisplay, Session, Waveform } from '../model/types'
import { isTekWfm, parseTekWfm } from './tekWfm'
import { parseTekSetup, setupNumber, setupString } from './tekSetup'

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
const FALLBACK_COLORS = ['#f2e32c', '#22c8e6', '#ff3d5a', '#8fd43a', '#ff8a1c', '#4a63ff', '#c86bff', '#2fd6a0']

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

function channelIdFromName(name: string): string {
  const stem = baseName(name).replace(/\.[^.]+$/, '')
  const m = stem.match(/(ch|math|ref)\s*_?(\d+)/i)
  return m ? `${m[1].toUpperCase()}${m[2]}` : stem.toUpperCase()
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
  const span = Math.max(max - min, 1e-9)
  const raw = span / 8
  const exp = Math.pow(10, Math.floor(Math.log10(raw)))
  const scale = [1, 2, 5, 10].map((m) => m * exp).find((s) => s >= raw) ?? 10 * exp
  return { scale, offset: (max + min) / 2 }
}

function buildSession(fileName: string, format: string, waves: Waveform[], setup?: Record<string, string>, screenshot?: Blob): Session {
  const s = setup ?? {}
  waves.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))

  const channels: Channel[] = waves.map((wave, i) => {
    const id = wave.id
    const scale = setupNumber(s[`:${id}:SCALE`])
    const auto = scale === undefined ? autoScale(wave) : undefined
    const state = s[`:DISPLAY:WAVEVIEW1:${id}:STATE`]
    const display: ChannelDisplay = {
      id,
      label: setupString(s[`:${id}:LABEL:NAME`]) ?? '',
      color: TEK_COLORS[id] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      visible: state === undefined ? true : state !== '0',
      scale: scale ?? auto!.scale,
      position: setupNumber(s[`:${id}:POSITION`]) ?? 0,
      offset: setupNumber(s[`:${id}:OFFSET`]) ?? auto?.offset ?? 0,
    }
    return { wave, display }
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

  const session: Session = { fileName, format, channels, views, screenshot }
  if (setup) {
    session.setup = setup
    const hScale = setupNumber(s[':HORIZONTAL:SCALE'])
    if (hScale !== undefined) {
      session.horizontal = {
        scale: hScale,
        position: setupNumber(s[':HORIZONTAL:POSITION']) ?? 50,
        sampleRate: setupNumber(s[':HORIZONTAL:SAMPLERATE']),
      }
    }
    const trigSrc = s[':TRIGGER:A:EDGE:SOURCE']
    if (trigSrc) {
      session.trigger = {
        source: trigSrc,
        level: setupNumber(s[`:TRIGGER:A:LEVEL:${trigSrc}`]),
        slope: s[':TRIGGER:A:EDGE:SLOPE'],
      }
    }
    if (s[':DISPLAY:WAVEVIEW1:CURSOR:CURSOR:STATE'] === '1') {
      const a = setupNumber(s[':DISPLAY:WAVEVIEW1:CURSOR:CURSOR:WAVEFORM:APOSITION'])
      const b = setupNumber(s[':DISPLAY:WAVEVIEW1:CURSOR:CURSOR:WAVEFORM:BPOSITION'])
      if (a !== undefined && b !== undefined) {
        session.cursors = { a, b, source: s[':DISPLAY:WAVEVIEW1:CURSOR:CURSOR:ASOURCE'] }
      }
    }
    const meas: { type: string; source: string }[] = []
    for (const key of Object.keys(s)) {
      const m = key.match(/^:MEASUREMENT:(MEAS\d+):TYPE$/)
      if (m) meas.push({ type: s[key], source: s[`:MEASUREMENT:${m[1]}:SOURCE1`] ?? '' })
    }
    session.measurements = meas
  }
  return session
}

/** Tektronix session file (*.tss): a zip with channel .wfm files, a zipped setup and a screenshot. */
function parseTss(file: InputFile): Session {
  const entries = unzipSync(new Uint8Array(file.data))
  const waves: Waveform[] = []
  let setup: Record<string, string> | undefined
  let screenshot: Blob | undefined

  for (const [path, content] of Object.entries(entries)) {
    const name = baseName(path)
    const lower = name.toLowerCase()
    if (lower.endsWith('.wfm')) {
      waves.push(parseTekWfm(toBuffer(content), channelIdFromName(name)))
    } else if (lower.endsWith('.set')) {
      // Either a zip containing the learn file, or the learn text itself
      if (content[0] === 0x50 && content[1] === 0x4b) {
        for (const inner of Object.values(unzipSync(content))) {
          setup = { ...setup, ...parseTekSetup(strFromU8(inner, true)) }
        }
      } else {
        setup = { ...setup, ...parseTekSetup(strFromU8(content, true)) }
      }
    } else if (lower.endsWith('.png')) {
      screenshot = new Blob([toBuffer(content)], { type: 'image/png' })
    }
  }
  if (!waves.length) throw new Error('Session contains no waveform files')
  return buildSession(file.name, 'Tektronix session (.tss)', waves, setup, screenshot)
}

/**
 * Load one or more files into a session. Supports:
 *  - Tektronix .tss session archives
 *  - one or more Tektronix .wfm files (optionally with a .set setup file)
 */
export function loadFiles(files: InputFile[]): Session {
  if (files.length === 1 && /\.tss$/i.test(files[0].name)) return parseTss(files[0])

  const waves: Waveform[] = []
  let setup: Record<string, string> | undefined
  for (const f of files) {
    if (/\.tss$/i.test(f.name)) return parseTss(f)
    if (/\.set$/i.test(f.name)) {
      setup = { ...setup, ...parseTekSetup(new TextDecoder('latin1').decode(f.data)) }
    } else if (isTekWfm(f.data)) {
      waves.push(parseTekWfm(f.data, channelIdFromName(f.name)))
    } else {
      throw new Error(`${f.name}: unsupported file format`)
    }
  }
  if (!waves.length) throw new Error('No waveform files found')
  const name = files.length === 1 ? files[0].name : `${files.length} files`
  return buildSession(name, 'Tektronix waveform (.wfm)', waves, setup)
}
