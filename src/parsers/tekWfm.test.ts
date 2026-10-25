import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { isTekWfm, parseTekWfm } from './tekWfm'
import { loadFiles } from './session'

interface WfmOptions {
  samples?: number[]
  /** Sample format (0 = int16) */
  format?: number
  xScale?: number
  /** Overrides the end of the samples in the curve buffer (bytes) */
  postStart?: number
  /** Cut the file to this length */
  length?: number
}

/** A WFM#003 file (little endian, 16-bit samples) with two pre- and post-charge points around the samples */
function wfm({ samples = [0, 100, -100, 32767], format = 0, xScale = 4e-8, postStart, length }: WfmOptions = {}): ArrayBuffer {
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
  dv.setFloat64(0x1f0, -2e-6, true)
  ascii(0x1fc, 's')
  // Curve buffer: offsets of the samples and of the post-charge points behind them
  dv.setUint32(0x336, dataStart, true)
  dv.setUint32(0x33a, postStart ?? dataStart + samples.length * 2, true)
  samples.forEach((v, i) => dv.setInt16(header + dataStart + i * 2, v, true))
  return length === undefined ? buf : buf.slice(0, length)
}

describe('Tektronix WFM', () => {
  it('reads the samples, their scale and the time base', () => {
    const buf = wfm()
    expect(isTekWfm(buf)).toBe(true)
    const w = parseTekWfm(buf, 'ch1.wfm')
    expect(Array.from(w.data)).toEqual([0, 100, -100, 32767].map((v) => Math.fround(v * 1e-3 + 0.5)))
    expect(w.t0).toBe(-2e-6)
    expect(w.dt).toBe(4e-8)
    expect([w.yUnit, w.xUnit]).toEqual(['V', 's'])
  })

  it('reports broken files with their name', () => {
    expect(() => parseTekWfm(wfm({ length: 400 }), 'a.wfm')).toThrow('a.wfm: the file ends inside the WFM header')
    expect(() => parseTekWfm(wfm({ format: 3 }), 'a.wfm')).toThrow('a.wfm: unsupported sample format 3')
    expect(() => parseTekWfm(wfm({ xScale: 0 }), 'a.wfm')).toThrow('a.wfm: invalid sample interval')
    expect(() => parseTekWfm(wfm({ postStart: 2 }), 'a.wfm')).toThrow('a.wfm: invalid curve offsets')
    expect(() => parseTekWfm(wfm({ samples: [] }), 'a.wfm')).toThrow('a.wfm: the waveform has no samples')
    // Header, pre-charge and the first two samples only
    expect(() => parseTekWfm(wfm({ length: 0x346 + 8 }), 'a.wfm')).toThrow('a.wfm: truncated waveform data')
    expect(() => parseTekWfm(new ArrayBuffer(4), 'a.wfm')).toThrow('a.wfm: not a Tektronix WFM file')
  })
})

describe('files that cannot be read', () => {
  const zip = (files: Record<string, ArrayBuffer | Uint8Array>) => {
    const z = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v instanceof Uint8Array ? v : new Uint8Array(v)])))
    return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer
  }

  it('are left out of an archive and reported', () => {
    const s = loadFiles([{ name: 'Tek000.tss', data: zip({ 'ch1.wfm': wfm(), 'ch1_d0.wfm': wfm({ format: 3 }), 'Tek000.set': strToU8('PK\x03\x04 broken') }) }])
    expect(s.channels.map((c) => c.wave.id)).toEqual(['CH1'])
    expect(s.warnings).toEqual(['ch1_d0.wfm: unsupported sample format 3', 'Tek000.set: the setup file is damaged'])
  })

  it('are left out of the files opened together', () => {
    const s = loadFiles([
      { name: 'ch1.wfm', data: wfm() },
      { name: 'ch2.wfm', data: wfm({ length: 100 }) },
      { name: 'notes.txt', data: strToU8('hello').buffer as ArrayBuffer },
    ])
    expect(s.channels.map((c) => c.wave.id)).toEqual(['CH1'])
    expect(s.warnings).toEqual(['ch2.wfm: the file ends inside the WFM header', 'notes.txt: unsupported file format'])
    expect(loadFiles([{ name: 'ch1.wfm', data: wfm() }]).warnings).toBeUndefined()
  })

  it('give the reason when nothing can be read', () => {
    expect(() => loadFiles([{ name: 'ch1.wfm', data: wfm({ xScale: NaN }) }])).toThrow('ch1.wfm: invalid sample interval')
    expect(() => loadFiles([{ name: 'x.zip', data: zip({ 'ch1.wfm': wfm({ format: 3 }), 'ch2.wfm': wfm({ format: 3 }) }) }])).toThrow(
      'ch1.wfm: unsupported sample format 3 (and 1 more)',
    )
  })
})
