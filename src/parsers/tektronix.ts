/**
 * The Tektronix family: waveforms (.wfm of the 4/5/6-Series and the bigger scopes, .isf of the older
 * ones), their SCPI setup (.set) and screenshot. Turns them into a session, reading the display
 * settings from the setup keys of both generations of instruments.
 */
import { strFromU8, unzipSync } from 'fflate'
import type { Channel, ChannelDisplay, Session, Waveform } from '../model/types'
import { fitBand } from '../model/view'
import { DIVS_Y } from '../render/draw'
import { CHANNEL_COLORS, channelIdFromName, reasonFor, unsupportedFile, type Entry, type FormatAdapter, type InputFile, type LoadContext } from './formats'
import { isTekIsf, parseTekIsf, type IsfDisplayHints } from './tekIsf'
import { parseTekSetup, readChannelInput, setupNumber, setupString } from './tekSetup'
import { isTekWfm, parseTekWfm } from './tekWfm'

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

/** Min and max of the finite samples; undefined without any */
function finiteRange(data: Float32Array): [number, number] | undefined {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  return min <= max ? [min, max] : undefined
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

  /** Channels whose V/div the files do not give: fitted below */
  const unscaled = new Set<string>()
  const channels: Channel[] = waves.map((wave, i) => {
    const id = wave.id
    const hint = o.hints?.[id] ?? {}
    const scale = setupNumber(get(id, ':SCALE')) ?? setupNumber(get(id, ':VERTICAL:SCALE')) ?? hint.scale
    if (scale === undefined) unscaled.add(id)
    const state = s[`:DISPLAY:WAVEVIEW1:${id}:STATE`] ?? s[`:SELECT:${id}`] ?? (id === 'MATH1' ? s[':SELECT:MATH'] : undefined)
    const display: ChannelDisplay = {
      id,
      label: setupString(get(id, ':LABEL:NAME')) ?? setupString(get(id, ':LABEL')) ?? '',
      color: colors[id] ?? CHANNEL_COLORS[i % CHANNEL_COLORS.length],
      // A waveform that was saved is shown, unless the setup says it was switched off
      visible: state === undefined ? true : state !== '0' && state.toUpperCase() !== 'OFF',
      scale: scale ?? 1,
      position: setupNumber(get(id, ':POSITION')) ?? setupNumber(get(id, ':VERTICAL:POSITION')) ?? hint.position ?? 0,
      offset: setupNumber(get(id, ':OFFSET')) ?? hint.offset ?? 0,
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

  // Channels without a V/div in the files (waveforms opened without their setup) are fitted as
  // Autoscale fits them over the whole record: a band each among the visible channels of their
  // view, in the order of the view, instead of all on top of each other
  for (const c of channels) {
    const id = c.wave.id
    const range = unscaled.has(id) ? finiteRange(c.wave.data) : undefined
    if (!range) continue
    const band = (views.find((v) => v.includes(id)) ?? [id]).filter((x) => x === id || channels.find((ch) => ch.wave.id === x)?.display.visible)
    Object.assign(c.display, fitBand(range[0], range[1], band.indexOf(id), band.length, DIVS_Y, c.display.scale))
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

function readSetup(file: InputFile): Record<string, string> {
  const content = new Uint8Array(file.data)
  // Either a zip containing the learn file (4/5/6-Series sessions), or the setup text itself
  if (content[0] === 0x50 && content[1] === 0x4b) {
    let inner: Record<string, Uint8Array>
    try {
      inner = unzipSync(content)
    } catch {
      throw new Error(`${file.name}: the setup file is damaged`)
    }
    let setup: Record<string, string> = {}
    for (const text of Object.values(inner)) setup = { ...setup, ...parseTekSetup(strFromU8(text, true)) }
    return setup
  }
  return parseTekSetup(strFromU8(content, true))
}

const isSetup = (name: string) => /\.set$/i.test(name)
const isImage = (name: string) => /\.(png|jpe?g|bmp)$/i.test(name)

const isWaveform = (file: InputFile): boolean => /\.(wfm|isf)$/i.test(file.name) || isTekWfm(file.data) || isTekIsf(file.data)

/**
 * Load Tektronix files:
 *  - .wfm waveforms (WFM#001–003) of the 4/5/6-Series and the bigger families
 *  - .isf waveforms (TDS, DPO/MSO2000–4000, MDO3000/4000)
 *  - with a .set setup file and a screenshot, as separate files or in the archive (.tss or .zip) they come in
 */
function load(entries: Entry[], ctx: LoadContext): Session {
  const waves: Waveform[] = []
  const hints: Record<string, IsfDisplayHints> = {}
  const ids = new Set<string>()
  const kinds = new Set<'wfm' | 'isf'>()
  let setup: Record<string, string> | undefined
  let screenshot: Blob | undefined
  // A file that cannot be read (e.g. a waveform in a format not supported, a damaged setup) is
  // left out and reported: the session opens with the others
  const problems: string[] = []
  for (const { file, fromArchive } of entries) {
    const lower = file.name.toLowerCase()
    try {
      if (isSetup(lower)) {
        setup = { ...setup, ...readSetup(file) }
      } else if (lower.endsWith('.wfm') || isTekWfm(file.data)) {
        // Its id is taken only once it has been read
        const wave = parseTekWfm(file.data, file.name)
        waves.push({ ...wave, id: channelIdFromName(file.name, ids) })
        kinds.add('wfm')
      } else if (lower.endsWith('.isf') || isTekIsf(file.data)) {
        // The channel comes from the waveform id inside the file ("Ch1, DC coupling, …"), else from the name
        const probe = parseTekIsf(file.data, file.name)
        const id = channelIdFromName(file.name, ids, probe.channel && !ids.has(probe.channel) ? probe.channel : undefined)
        waves.push({ ...probe.wave, id })
        hints[id] = probe.hints
        kinds.add('isf')
      } else if (isImage(lower)) {
        const type = lower.endsWith('.png') ? 'image/png' : lower.endsWith('.bmp') ? 'image/bmp' : 'image/jpeg'
        screenshot ??= new Blob([file.data], { type })
      } else if (!fromArchive && !ctx.recognised(file)) {
        // Of no format: named here, in the order of the files. (Other files inside an archive:
        // manifest.json, CSV copies … are ignored.)
        problems.push(unsupportedFile(file.name))
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      problems.push(reason.startsWith(file.name) ? reason : `${file.name}: ${reason}`)
    }
  }
  // Nothing to show: the reason is what went wrong with the files
  if (!waves.length) throw new Error(problems.length ? reasonFor(problems) : 'No waveform files found')

  const format =
    ctx.archive === 'tss'
      ? 'Tektronix session (.tss)'
      : `Tektronix waveform${waves.length > 1 ? 's' : ''} (${[...kinds].map((k) => `.${k}`).join(', ')})${ctx.archive === 'zip' ? ' in .zip' : ''}`
  const session = buildSession(ctx.name, format, waves, { setup, screenshot, hints, colors: kinds.has('isf') && !kinds.has('wfm') ? TEK_LEGACY_COLORS : TEK_COLORS })
  if (problems.length) session.warnings = problems
  return session
}

export const tektronix: FormatAdapter = {
  id: 'tektronix',
  waveformExtensions: ['.wfm', '.isf'],
  isWaveform,
  recognises: (file) => isWaveform(file) || isSetup(file.name) || isImage(file.name),
  load,
}
