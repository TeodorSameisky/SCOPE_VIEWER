/** A single analog waveform, already converted to physical units. */
export interface Waveform {
  /** Source id, e.g. "CH1" */
  id: string
  /** Sample values in vertical units */
  data: Float32Array
  /** Time of the first sample (s, relative to trigger) */
  t0: number
  /** Sample interval (s) */
  dt: number
  yUnit: string
  xUnit: string
}

/** Display settings for a channel (taken from the scope setup when available). */
export interface ChannelDisplay {
  id: string
  label: string
  color: string
  visible: boolean
  /** Volts per division */
  scale: number
  /** Vertical position in divisions */
  position: number
  /** Vertical offset in units (subtracted before scaling) */
  offset: number
}

/**
 * How a channel was connected and set on the scope, from the setup file (or the waveform file):
 * settings the file does not have are left out. Setups store what is set for a probe, not which
 * probe it was (model, serial number).
 */
export interface ChannelInput {
  /** As the scope writes it: DC, AC, GND, DCREJ … */
  coupling?: string
  /** Input termination (Ω) */
  termination?: number
  /** Bandwidth setting (Hz), or the full bandwidth of the instrument */
  bandwidth?: number | 'full'
  /** Probe attenuation (×), e.g. 10 for a 10× probe */
  attenuation?: number
  /** Attenuation set by hand for a probe the scope does not recognise (×), when not 1 */
  extAttenuation?: number
  /** Input mode of a probe with several (differential probes), when not the default */
  probeMode?: string
  /** Propagation delay of the probe (s) */
  probeDelay?: number
  /** Current measured as the voltage across a shunt: amperes per volt */
  ampsPerVolt?: number
  invert?: boolean
  /** Deskew (s) */
  deskew?: number
}

export interface Channel {
  wave: Waveform
  display: ChannelDisplay
  /** Input settings on the scope (coupling, termination, probe …), when the files have them */
  input?: ChannelInput
}

export interface SessionCursors {
  a: number
  b: number
  source?: string
}

export interface Session {
  fileName: string
  /** SHA-256 of the opened file(s), identifies the session across visits */
  fingerprint?: string
  /** Instrument family/format, e.g. "Tektronix TSS" */
  format: string
  channels: Channel[]
  /** Channel ids grouped per stacked view, top to bottom */
  views: string[][]
  /** Time base when saved: s/div, trigger position in % of the screen, delay of that point from the trigger */
  horizontal?: { scale: number; position: number; sampleRate?: number; delay?: number }
  trigger?: { source: string; level?: number; slope?: string }
  cursors?: SessionCursors
  measurements?: { type: string; source: string }[]
  /** Screenshot of the instrument screen (PNG) */
  screenshot?: Blob
  /** Raw setup key/values (SCPI) */
  setup?: Record<string, string>
  timestamp?: string
  /** Files that could not be read and were left out, each with the reason ("ch2.wfm: unsupported sample format 3") */
  warnings?: string[]
}
