/**
 * Small synthetic files in the formats the parsers read, for tests: a waveform, an older scope's
 * waveform, a setup and a whole session archive. They are built in code, so the tests that use them
 * run everywhere (the real sessions in SessionSample/ are not in git).
 */
import { strToU8, zipSync } from 'fflate'

export interface WfmOptions {
  samples?: number[]
  /** Sample format (0 = int16) */
  format?: number
  xScale?: number
  /** Time of the first sample (s) */
  xOffset?: number
  /** Overrides the end of the samples in the curve buffer (bytes) */
  postStart?: number
  /** Cut the file to this length */
  length?: number
}

/** A WFM#003 file (little endian, 16-bit samples: volts = 1 mV × value + 0.5 V) with two pre- and post-charge points around the samples */
export function wfm({ samples = [0, 100, -100, 32767], format = 0, xScale = 4e-8, xOffset = -2e-6, postStart, length }: WfmOptions = {}): ArrayBuffer {
  const header = 0x346
  const dataStart = 4
  const buf = new ArrayBuffer(header + dataStart + samples.length * 2 + 4)
  const dv = new DataView(buf)
  const ascii = (offset: number, s: string) => new Uint8Array(buf).set(strToU8(s), offset)
  dv.setUint16(0, 0x0f0f, true)
  ascii(2, ':WFM#003')
  dv.setUint8(0x00f, 2)
  dv.setInt32(0x010, header, true)
  // Explicit dimension 1: the vertical scale, unit and sample format
  dv.setFloat64(0x0a8, 1e-3, true)
  dv.setFloat64(0x0b0, 0.5, true)
  ascii(0x0bc, 'V')
  dv.setInt32(0x0f0, format, true)
  // Implicit dimension 1: the time base
  dv.setFloat64(0x1e8, xScale, true)
  dv.setFloat64(0x1f0, xOffset, true)
  ascii(0x1fc, 's')
  // Curve buffer: offsets of the samples and of the post-charge points behind them
  dv.setUint32(0x336, dataStart, true)
  dv.setUint32(0x33a, postStart ?? dataStart + samples.length * 2, true)
  samples.forEach((v, i) => dv.setInt16(header + dataStart + i * 2, v, true))
  return length === undefined ? buf : buf.slice(0, length)
}

/** An .isf file: preamble text + IEEE-488.2 block (or ASCII values) */
export function isf(preamble: string, samples: Uint8Array | string, block = true): ArrayBuffer {
  const enc = new TextEncoder()
  const head = enc.encode(preamble)
  let body: Uint8Array
  if (typeof samples === 'string') body = enc.encode(samples)
  else if (block) {
    const len = String(samples.length)
    body = new Uint8Array([...enc.encode(`#${len.length}${len}`), ...samples])
  } else body = new Uint8Array([...enc.encode('#0'), ...samples])
  const out = new Uint8Array(head.length + body.length + 1)
  out.set(head)
  out.set(body, head.length)
  out[out.length - 1] = 0x0a
  return out.buffer
}

/** 16-bit big-endian samples */
export function int16be(values: number[]): Uint8Array {
  const b = new Uint8Array(values.length * 2)
  const dv = new DataView(b.buffer)
  values.forEach((v, i) => dv.setInt16(i * 2, v, false))
  return b
}

/** A ramp of `n` samples, scaled by `wfm` to 0.5 V … 0.5 V + n mV: n = 1001 at 10 µs covers 10 ms */
export const ramp = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

/** A setup file: SCPI commands, several per line separated by ";" as the scope writes them */
export function setupText(lines: string[]): string {
  return lines.join('\n') + '\n'
}

/** The setup of the synthetic session: two channels (the second switched off), one view each, a time base, trigger, cursors, a measurement */
export const SETUP_LINES = [
  ':CH1:SCALE 0.5;:CH1:POSITION -2;:CH1:OFFSET 0.25;:CH1:LABEL:NAME "Supply%20rail";:CH1:COUPLING DC;:CH1:TERMINATION 1E6;:CH1:BANDWIDTH 2E8',
  ':CH2:SCALE 2;:CH2:POSITION 1;:CH2:LABEL:NAME "Sig";:CH2:COUPLING AC;:CH2:TERMINATION 50',
  ':DISPLAY:WAVEVIEW1:CH1:STATE 1;:DISPLAY:WAVEVIEW1:CH2:STATE 0',
  ':MAINWINDOW:SOURCEORDER "0;ch1;ch2"',
  ':HORIZONTAL:SCALE 1E-3;:HORIZONTAL:POSITION 20;:HORIZONTAL:SAMPLERATE 1E5',
  ':TRIGGER:A:EDGE:SOURCE CH1;:TRIGGER:A:EDGE:SLOPE RISE;:TRIGGER:A:LEVEL:CH1 1.5',
  ':DISPLAY:WAVEVIEW1:CURSOR:CURSOR:STATE 1;:DISPLAY:WAVEVIEW1:CURSOR:CURSOR:WAVEFORM:APOSITION -1E-3;:DISPLAY:WAVEVIEW1:CURSOR:CURSOR:WAVEFORM:BPOSITION 1E-3;:DISPLAY:WAVEVIEW1:CURSOR:CURSOR:ASOURCE CH2',
  ':MEASUREMENT:MEAS1:TYPE PK2PK;:MEASUREMENT:MEAS1:STATE 1;:MEASUREMENT:MEAS1:SOURCE1 CH1',
  ':MEASUREMENT:MEAS2:TYPE FREQUENCY;:MEASUREMENT:MEAS2:STATE 0;:MEASUREMENT:MEAS2:SOURCE1 CH2',
]

/** The first bytes of a PNG file: enough for the loader, which only keeps the screenshot as a Blob */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

/**
 * A session archive as a 4/5/6-Series scope saves it (.tss): a zip of one waveform per channel, a
 * zipped setup (.set), a screenshot and a manifest. Each channel has 1001 samples every 10 µs from -2 ms.
 */
export function tss(): ArrayBuffer {
  const inner = zipSync({ 'Tek000.set': strToU8(setupText(SETUP_LINES)) })
  const wave = () => new Uint8Array(wfm({ samples: ramp(1001), xScale: 1e-5, xOffset: -2e-3 }))
  const zipped = zipSync({
    'ch1.wfm': wave(),
    'ch2.wfm': wave(),
    'Tek000.set': inner,
    'Tek000.png': PNG_BYTES,
    'manifest.json': strToU8('{"version":1}'),
  })
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
}
