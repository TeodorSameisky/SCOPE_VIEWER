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

export interface Channel {
  wave: Waveform
  display: ChannelDisplay
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
}
