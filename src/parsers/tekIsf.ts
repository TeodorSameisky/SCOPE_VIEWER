import type { Waveform } from '../model/types'

/**
 * Parser for Tektronix "Internal Save Format" waveforms (*.isf), written by the TDS1000/2000,
 * TPS2000, DPO/MSO2000, DPO/MSO3000, DPO/MSO4000 and MDO3000/4000 families. The file is the
 * answer to `WFMPRE?;CURVE?`: an ASCII preamble with the scaling, then the samples as an
 * IEEE-488.2 block (`#<n><length><bytes>`), or as comma-separated numbers for ASCII encoding.
 *
 *   value = YZERO + YMULT · (sample − YOFF)        time = XZERO + XINCR · (index − PT_OFF)
 */

/** Display settings stored in the preamble of newer models (used when there is no setup file) */
export interface IsfDisplayHints {
  /** V/div */
  scale?: number
  /** divisions */
  position?: number
  offset?: number
}

export interface IsfWaveform {
  wave: Waveform
  /** Channel from the waveform id (e.g. "Ch1, DC coupling, …" → CH1), if recognisable */
  channel?: string
  /** WFID text, e.g. "Ch1, DC coupling, 1.000V/div, 200.0us/div, 10000 points, Sample mode" */
  description?: string
  hints: IsfDisplayHints
}

/** Preamble keywords; the instruments accept (and may write) them shortened to their capitals */
const KEYS = ['BYT_NR', 'BIT_NR', 'ENCDG', 'BN_FMT', 'BYT_OR', 'NR_PT', 'WFID', 'PT_FMT', 'XUNIT', 'XINCR', 'XZERO', 'PT_OFF', 'YUNIT', 'YMULT', 'YOFF', 'YZERO', 'VSCALE', 'HSCALE', 'VPOS', 'VOFFSET', 'HDELAY', 'DOMAIN', 'WFMTYPE']
const SHORT: Record<string, string> = {
  BYT_N: 'BYT_NR',
  BIT_N: 'BIT_NR',
  ENC: 'ENCDG',
  BN_F: 'BN_FMT',
  BYT_O: 'BYT_OR',
  NR_P: 'NR_PT',
  PT_F: 'PT_FMT',
  XUN: 'XUNIT',
  XIN: 'XINCR',
  XZE: 'XZERO',
  PT_O: 'PT_OFF',
  YUN: 'YUNIT',
  YMU: 'YMULT',
  YOF: 'YOFF',
  YZE: 'YZERO',
}

function canonicalKey(k: string): string {
  const u = k.toUpperCase()
  if (KEYS.includes(u)) return u
  if (SHORT[u]) return SHORT[u]
  return KEYS.find((c) => c.startsWith(u) && u.length >= 3) ?? u
}

/** The preamble starts with WFMPRE / WFMOUTPRE (possibly shortened to WFMP / WFMO) */
export function isTekIsf(buf: ArrayBuffer): boolean {
  const head = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(64, buf.byteLength)))
  return /^\s*:?WFM(?:OUTPRE|OUTP|PRE|P|O)[:\s]/i.test(head)
}

/** Split the preamble into keyword → value, e.g. ":WFMPRE:NR_PT 10000;BYT_NR 2;…" */
export function parseIsfPreamble(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  // Values may be quoted strings containing ';' (WFID): split outside quotes only
  const parts = text.match(/(?:[^;"]|"[^"]*")+/g) ?? []
  for (const part of parts) {
    const m = /^\s*(?::?[A-Za-z_]+:)*([A-Za-z_][A-Za-z_0-9]*)\s+([\s\S]*?)\s*$/.exec(part)
    if (!m) continue
    out[canonicalKey(m[1])] = m[2].replace(/^"(.*)"$/s, '$1')
  }
  return out
}

const num = (v: string | undefined, fallback: number): number => {
  const n = v === undefined ? NaN : parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

function normaliseUnit(u: string | undefined, fallback: string): string {
  if (!u) return fallback
  const s = u.trim()
  const known: Record<string, string> = { volts: 'V', volt: 'V', amps: 'A', amp: 'A', seconds: 's', second: 's', watts: 'W', hertz: 'Hz', db: 'dB' }
  return known[s.toLowerCase()] ?? s
}

/** "Ch1, DC coupling, …" → CH1; "Math, …" → MATH; "Ref2, …" → REF2 */
function channelFromWfid(wfid: string | undefined): string | undefined {
  const m = /^\s*(ch|math|ref)\s*(\d*)\b/i.exec(wfid ?? '')
  if (!m) return undefined
  return `${m[1].toUpperCase()}${m[2] || (m[1].toLowerCase() === 'math' ? '1' : '')}`
}

export function parseTekIsf(buf: ArrayBuffer, id: string): IsfWaveform {
  const bytes = new Uint8Array(buf)
  // The ASCII preamble ends at the CURVE keyword (":CURVE", or shortened ":CURV")
  const headText = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 8192)))
  const curve = /[:;]\s*CURV(?:E)?\s+/i.exec(headText)
  if (!curve) throw new Error(`${id}: no CURVE data in the file`)
  const pre = parseIsfPreamble(headText.slice(0, curve.index))
  let pos = curve.index + curve[0].length

  const encoding = (pre.ENCDG ?? 'BIN').toUpperCase()
  const byteNr = Math.round(num(pre.BYT_NR, 1))
  const format = (pre.BN_FMT ?? 'RI').toUpperCase()
  const little = (pre.BYT_OR ?? 'MSB').toUpperCase().startsWith('L')
  const ymult = num(pre.YMULT, 1)
  const yoff = num(pre.YOFF, 0)
  const yzero = num(pre.YZERO, 0)
  let dt = num(pre.XINCR, NaN)
  if (!(dt > 0)) throw new Error(`${id}: missing or invalid sample interval (XINCR)`)
  const t0 = num(pre.XZERO, 0) - num(pre.PT_OFF, 0) * dt

  let raw: number[] | Float64Array
  if (encoding.startsWith('ASC')) {
    // ASCII curve: comma-separated sample values
    raw = new TextDecoder('latin1')
      .decode(bytes.subarray(pos))
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite)
  } else {
    if (bytes[pos] !== 0x23 /* # */) throw new Error(`${id}: CURVE is not a binary block`)
    const digits = bytes[pos + 1] - 0x30
    if (digits < 0 || digits > 9) throw new Error(`${id}: invalid binary block header`)
    let length: number
    if (digits === 0) {
      // "#0": indefinite length, up to the end of the file (minus a final newline)
      pos += 2
      length = bytes.length - pos - (bytes[bytes.length - 1] === 0x0a ? 1 : 0)
    } else {
      length = parseInt(new TextDecoder('latin1').decode(bytes.subarray(pos + 2, pos + 2 + digits)), 10)
      pos += 2 + digits
    }
    if (!Number.isFinite(length) || length < 0) throw new Error(`${id}: invalid binary block length`)
    if (pos + length > bytes.length) {
      // Truncated file: use what is there
      length = Math.max(0, bytes.length - pos)
    }
    if (![1, 2, 4, 8].includes(byteNr)) throw new Error(`${id}: unsupported sample size ${byteNr} bytes`)
    const n = Math.floor(length / byteNr)
    const dv = new DataView(buf, pos, n * byteNr)
    raw = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const o = i * byteNr
      let v: number
      if (format === 'FP') v = byteNr === 8 ? dv.getFloat64(o, little) : dv.getFloat32(o, little)
      else if (byteNr === 1) v = format === 'RP' ? dv.getUint8(o) : dv.getInt8(o)
      else if (byteNr === 2) v = format === 'RP' ? dv.getUint16(o, little) : dv.getInt16(o, little)
      else if (byteNr === 4) v = format === 'RP' ? dv.getUint32(o, little) : dv.getInt32(o, little)
      else v = Number(format === 'RP' ? dv.getBigUint64(o, little) : dv.getBigInt64(o, little))
      raw[i] = v
    }
  }

  // Envelope mode stores a min/max pair per point: keep both, at half the interval
  const envelope = (pre.PT_FMT ?? 'Y').toUpperCase().startsWith('ENV')
  if (envelope) dt /= 2

  const data = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) data[i] = yzero + ymult * (raw[i] - yoff)
  if (!data.length) throw new Error(`${id}: the waveform has no samples`)

  const hints: IsfDisplayHints = {}
  if (pre.VSCALE !== undefined && num(pre.VSCALE, 0) > 0) hints.scale = num(pre.VSCALE, 1)
  if (pre.VPOS !== undefined) hints.position = num(pre.VPOS, 0)
  if (pre.VOFFSET !== undefined) hints.offset = num(pre.VOFFSET, 0)

  return {
    wave: { id, data, t0, dt, yUnit: normaliseUnit(pre.YUNIT, 'V'), xUnit: normaliseUnit(pre.XUNIT, 's') },
    channel: channelFromWfid(pre.WFID),
    description: pre.WFID,
    hints,
  }
}
