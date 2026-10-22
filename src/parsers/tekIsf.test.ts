import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { measure } from '../dsp/measure'
import { defaultWorkspace } from '../model/workspace'
import { isTekIsf, parseIsfPreamble, parseTekIsf } from './tekIsf'
import { loadFiles } from './session'

/** Build an .isf file: preamble text + IEEE-488.2 block (or ASCII values) */
function isf(preamble: string, samples: Uint8Array | string, block = true): ArrayBuffer {
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

const int16be = (values: number[]) => {
  const b = new Uint8Array(values.length * 2)
  const dv = new DataView(b.buffer)
  values.forEach((v, i) => dv.setInt16(i * 2, v, false))
  return b
}

describe('ISF preamble', () => {
  it('reads keywords with and without the WFMPRE path, quoted values with ";" and short forms', () => {
    const p = parseIsfPreamble(':WFMPRE:NR_PT 3;:WFMPRE:BYT_NR 2;WFID "Ch2, AC; x";YMU 1.0E-3;XIN 4.0E-9;YUNIT "Volts"')
    expect(p).toMatchObject({ NR_PT: '3', BYT_NR: '2', WFID: 'Ch2, AC; x', YMULT: '1.0E-3', XINCR: '4.0E-9', YUNIT: 'Volts' })
  })

  it('recognises ISF files', () => {
    expect(isTekIsf(isf(':WFMPRE:BYT_NR 1;:CURVE ', new Uint8Array(4)))).toBe(true)
    expect(isTekIsf(isf(':WFMOUTPRE:BYT_NR 1;:CURVE ', new Uint8Array(4)))).toBe(true)
    expect(isTekIsf(new TextEncoder().encode('Hello').buffer)).toBe(false)
  })
})

describe('ISF waveforms', () => {
  it('scales 16-bit big-endian samples and builds the time base', () => {
    const buf = isf(
      ':WFMPRE:NR_PT 4;:WFMPRE:BYT_NR 2;BIT_NR 16;ENCDG BINARY;BN_FMT RI;BYT_OR MSB;WFID "Ch1, DC coupling, 1.000V/div";' +
        'PT_FMT Y;XUNIT "s";XINCR 200.0000E-9;XZERO -1.0000E-3;PT_OFF 0;YUNIT "V";YMULT 156.2500E-6;YOFF 2.6880E+3;YZERO 0.0E+0;' +
        'VSCALE 1.0000;VPOS 420.0000E-3;VOFFSET 0.0E+0;:CURVE ',
      int16be([2688, 2688 + 6400, -100, 32767]),
    )
    const r = parseTekIsf(buf, 'x')
    expect(r.channel).toBe('CH1')
    expect(r.hints).toEqual({ scale: 1, position: 0.42, offset: 0 })
    expect(r.wave.t0).toBeCloseTo(-1e-3, 12)
    expect(r.wave.dt).toBeCloseTo(200e-9, 15)
    expect(Array.from(r.wave.data)).toEqual([0, 1, (-100 - 2688) * 156.25e-6, (32767 - 2688) * 156.25e-6].map(Math.fround))
  })

  it('handles 1-byte unsigned little-endian data, WFMOUTPRE, short keys, units and PT_OFF', () => {
    const buf = isf(':WFMOUTPRE:BYT_N 1;BN_F RP;BYT_O LSB;ENC BIN;XIN 1.0E-6;XZE 0;PT_O 2;YMU 0.5;YOF 128;YZE 1;YUN "Volts";WFID "Math, FFT";:CURV ', new Uint8Array([128, 130, 126]))
    const r = parseTekIsf(buf, 'x')
    expect(Array.from(r.wave.data)).toEqual([1, 2, 0])
    expect(r.wave.t0).toBeCloseTo(-2e-6, 12)
    expect(r.wave.yUnit).toBe('V')
    expect(r.channel).toBe('MATH1')
  })

  it('reads ASCII curves, "#0" blocks and envelope data', () => {
    const ascii = parseTekIsf(isf(':WFMPRE:ENCDG ASC;XINCR 1;YMULT 2;YOFF 1;YZERO 0;:CURVE ', '1,2,3'), 'x')
    expect(Array.from(ascii.wave.data)).toEqual([0, 2, 4])
    const indefinite = parseTekIsf(isf(':WFMPRE:BYT_NR 2;BYT_OR MSB;XINCR 1;YMULT 1;YOFF 0;:CURVE ', int16be([5, 6]), false), 'x')
    expect(Array.from(indefinite.wave.data)).toEqual([5, 6])
    const env = parseTekIsf(isf(':WFMPRE:BYT_NR 1;PT_FMT ENV;XINCR 2.0E-6;YMULT 1;YOFF 0;:CURVE ', new Uint8Array([1, 3, 2, 4])), 'x')
    expect(env.wave.dt).toBeCloseTo(1e-6, 12)
    expect(env.wave.data.length).toBe(4)
  })

  it('reports broken files', () => {
    expect(() => parseTekIsf(new TextEncoder().encode(':WFMPRE:XINCR 1;BYT_NR 1').buffer, 'a.isf')).toThrow(/no CURVE/)
    expect(() => parseTekIsf(isf(':WFMPRE:BYT_NR 1;:CURVE ', new Uint8Array(3)), 'a.isf')).toThrow(/XINCR/)
  })
})

const samplePath = new URL('../../SessionSample/tek0000CH1.zip', import.meta.url)
const hasSample = existsSync(samplePath)

describe.skipIf(!hasSample)('older Tektronix "Save All" (SessionSample/tek0000CH1.zip)', () => {
  const zip = hasSample ? readFileSync(samplePath) : Buffer.alloc(0)
  const data = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer
  const s = hasSample ? loadFiles([{ name: 'tek0000CH1.zip', data }]) : undefined!

  it('reads both channels with the settings of the scope', () => {
    expect(s.format).toBe('Tektronix waveforms (.isf) in .zip')
    expect(s.channels.map((c) => c.wave.id)).toEqual(['CH1', 'CH2'])
    const [ch1, ch2] = s.channels
    expect(ch1.wave.data.length).toBe(10000)
    expect(ch1.wave.dt).toBeCloseTo(200e-9, 15)
    expect(ch1.wave.t0).toBeCloseTo(-1e-3, 12)
    expect(ch1.display).toMatchObject({ label: 'IN', scale: 1, position: 0.42, offset: 0, visible: true })
    expect(ch2.display).toMatchObject({ label: 'OUT', scale: 2, position: -3.56 })
    expect(s.trigger).toEqual({ source: 'CH1', level: 2.08, slope: 'RISE' })
    expect(s.horizontal).toMatchObject({ scale: 200e-6, position: 50 })
    expect(s.screenshot).toBeDefined()
  })

  it('measures what the scope measured', () => {
    // Scope: Ch1 amplitude 2.52 V, frequency 1.000 kHz, high 2.46 V; Ch2 high 240 mV
    const w = s.channels[0].wave
    const m = measure(w.data, 0, w.data.length, w.t0, w.dt)
    expect(m.amplitude).toBeGreaterThan(2.4)
    expect(m.amplitude).toBeLessThan(2.6)
    expect(m.frequency).toBeCloseTo(1000, -1)
    expect(m.top).toBeCloseTo(2.46, 1)
    // Ch2 is noise in 80 mV steps: no two levels, so High = Max and Amplitude = Pk-Pk, and no
    // frequency ("Low signal amplitude" on the scope): High 240 mV, Amplitude 560 mV
    const w2 = s.channels[1].wave
    const m2 = measure(w2.data, 0, w2.data.length, w2.t0, w2.dt)
    expect(m2.top).toBeCloseTo(0.24, 3)
    expect(m2.amplitude).toBeCloseTo(0.56, 3)
    expect(m2.frequency).toBeNaN()
  })

  it('takes the measurements that were switched on', () => {
    expect(s.measurements?.map((m) => `${m.type} ${m.source}`)).toEqual(['AMPLITUDE CH1', 'FREQUENCY CH1', 'HIGH CH1', 'AMPLITUDE CH2', 'FREQUENCY CH2', 'HIGH CH2'])
    expect(defaultWorkspace(s).measurements.keys.slice(0, 3)).toEqual(['amplitude', 'frequency', 'top'])
  })

  it('gives the same session from the loose files', () => {
    const files = Object.entries(unzipSync(new Uint8Array(data))).map(([name, u8]) => ({ name, data: u8.slice().buffer as ArrayBuffer }))
    const loose = loadFiles(files)
    expect(loose.format).toBe('Tektronix waveforms (.isf)')
    expect(loose.channels.map((c) => [c.wave.id, c.display.label, c.display.scale])).toEqual([
      ['CH1', 'IN', 1],
      ['CH2', 'OUT', 2],
    ])
    // Without the setup file, scale and position come from the waveform files themselves
    const bare = loadFiles(files.filter((f) => f.name.endsWith('.isf')))
    expect(bare.channels.map((c) => [c.display.scale, c.display.position])).toEqual([
      [1, 0.42],
      [2, -3.56],
    ])
  })
})
