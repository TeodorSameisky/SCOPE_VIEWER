import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { defaultWorkspace } from '../model/workspace'
import { SETUP_LINES, int16be, isf, ramp, setupText, tss, wfm } from './fixtures'
import type { FormatAdapter } from './formats'
import { loadFiles } from './session'
import { tektronix } from './tektronix'

// These tests run on files built in code (fixtures.ts), so the whole loading path of a session is
// checked everywhere, in CI too: archives, setup files, display settings, views, time base, trigger,
// cursors, measurements, warnings and errors.

const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
const wave = () => wfm({ samples: ramp(1001), xScale: 1e-5, xOffset: -2e-3 })

describe('a .tss session', () => {
  const s = loadFiles([{ name: 'Tek000.tss', data: tss() }])
  const channel = (id: string) => s.channels.find((c) => c.wave.id === id)!

  it('reads the waveform of each channel', () => {
    expect(s.fileName).toBe('Tek000.tss')
    expect(s.format).toBe('Tektronix session (.tss)')
    expect(s.channels.map((c) => c.wave.id)).toEqual(['CH1', 'CH2'])
    const w = channel('CH1').wave
    expect(w.data).toHaveLength(1001)
    expect(w.dt).toBeCloseTo(1e-5, 15)
    expect(w.t0).toBeCloseTo(-2e-3, 12)
    // 1 mV per count + 0.5 V
    expect(w.data[1000]).toBeCloseTo(1.5, 5)
    expect(w.yUnit).toBe('V')
  })

  it('applies the display settings of the setup', () => {
    expect(channel('CH1').display).toEqual({ id: 'CH1', label: 'Supply rail', color: '#f2e32c', visible: true, scale: 0.5, position: -2, offset: 0.25 })
    // a waveform the setup says was switched off is hidden
    expect(channel('CH2').display).toEqual({ id: 'CH2', label: 'Sig', color: '#22c8e6', visible: false, scale: 2, position: 1, offset: 0 })
  })

  it('stacks the views as the source order says', () => {
    expect(s.views).toEqual([['CH1'], ['CH2']])
  })

  it('reads the time base, trigger, cursors and the measurements that are on', () => {
    expect(s.horizontal).toEqual({ scale: 1e-3, position: 20, sampleRate: 1e5, delay: undefined })
    expect(s.trigger).toEqual({ source: 'CH1', level: 1.5, slope: 'RISE' })
    expect(s.cursors).toEqual({ a: -1e-3, b: 1e-3, source: 'CH2' })
    // the second measurement is switched off
    expect(s.measurements).toEqual([{ type: 'PK2PK', source: 'CH1' }])
  })

  it('reads the input settings of each channel', () => {
    expect(channel('CH1').input).toMatchObject({ coupling: 'DC', termination: 1e6, bandwidth: 2e8 })
    expect(channel('CH2').input).toMatchObject({ coupling: 'AC', termination: 50 })
  })

  it('keeps the screenshot and the raw setup, and has nothing to warn about', () => {
    expect(s.screenshot?.type).toBe('image/png')
    expect(s.setup?.[':CH1:SCALE']).toBe('0.5')
    expect(s.warnings).toBeUndefined()
  })

  it('gives the workspace the window the scope showed, the measurements it had on and its trigger channel selected', () => {
    const w = defaultWorkspace(s)
    // the trigger point lies at 20 % of ten divisions of 1 ms
    expect(w.window.start).toBeCloseTo(-2e-3, 12)
    expect(w.window.end).toBeCloseTo(8e-3, 12)
    expect(w.measurements.keys[0]).toBe('pkpk')
    expect(w.selected).toBe('CH1')
    expect(w.cursors).toMatchObject({ on: true, a: -1e-3, b: 1e-3, source: 'CH2' })
  })
})

describe('waveforms with their setup as separate files', () => {
  const setup = { name: 'Tek000.set', data: buffer(strToU8(setupText(SETUP_LINES))) }

  it('applies a plain-text setup like the one in a session', () => {
    const s = loadFiles([{ name: 'ch1.wfm', data: wave() }, { name: 'ch2.wfm', data: wave() }, setup])
    expect(s.format).toBe('Tektronix waveforms (.wfm)')
    expect(s.fileName).toBe('3 files')
    expect(s.channels.map((c) => c.display.label)).toEqual(['Supply rail', 'Sig'])
    expect(s.views).toEqual([['CH1'], ['CH2']])
  })

  it('reads a setup that is zipped, as the 4/5/6-Series store it', () => {
    const zipped = zipSync({ 'learn.set': strToU8(setupText(SETUP_LINES)) })
    const s = loadFiles([{ name: 'ch1.wfm', data: wave() }, { name: 'Tek000.set', data: buffer(zipped) }])
    expect(s.channels[0].display.scale).toBe(0.5)
  })

  it('puts channels without a view in the setup into the last view', () => {
    const only = { name: 'x.set', data: buffer(strToU8(':MAINWINDOW:SOURCEORDER "0;ch1"\n')) }
    const s = loadFiles([{ name: 'ch1.wfm', data: wave() }, { name: 'ch2.wfm', data: wave() }, only])
    expect(s.views).toEqual([['CH1', 'CH2']])
  })

  it('shows every channel in one view when the setup says the views overlay', () => {
    const lines = [':DISPLAY:WAVEVIEW1:VIEWSTYLE OVERLAY', ':MAINWINDOW:SOURCEORDER "0;ch1;ch2"']
    const s = loadFiles([{ name: 'ch1.wfm', data: wave() }, { name: 'ch2.wfm', data: wave() }, { name: 'x.set', data: buffer(strToU8(setupText(lines))) }])
    expect(s.views).toEqual([['CH1', 'CH2']])
  })

  it('uses the time base of the setup only when it overlaps the record', () => {
    // 5 ms per division, the trigger at the left edge: 0 … 50 ms, far beyond the 10 ms record
    const lines = [':HORIZONTAL:SCALE 5E-3;:HORIZONTAL:POSITION 0;:HORIZONTAL:SAMPLERATE 1E5']
    const s = loadFiles([{ name: 'ch1.wfm', data: wave() }, { name: 'x.set', data: buffer(strToU8(setupText(lines))) }])
    expect(s.horizontal?.scale).toBe(5e-3)
    const w = defaultWorkspace(s).window
    expect(w.start).toBeCloseTo(0, 12)
    expect(w.end).toBeCloseTo(50e-3, 12)
    // a window that does not overlap the record at all is replaced by the whole record
    const far = [':HORIZONTAL:SCALE 1E-3;:HORIZONTAL:POSITION 50;:HORIZONTAL:DELAY:MODE 1;:HORIZONTAL:DELAY:TIME 100']
    const t = loadFiles([{ name: 'ch1.wfm', data: wave() }, { name: 'x.set', data: buffer(strToU8(setupText(far))) }])
    expect(defaultWorkspace(t).window.start).toBeCloseTo(-2e-3, 12)
  })
})

describe('older scopes: .isf files in a .zip', () => {
  const preamble = (wfid: string) =>
    `:WFMPRE:NR_PT 4;:WFMPRE:BYT_NR 2;BIT_NR 16;ENCDG BINARY;BN_FMT RI;BYT_OR MSB;WFID "${wfid}";PT_FMT Y;XUNIT "s";XINCR 1.0E-6;XZERO 0.0E+0;PT_OFF 0;YUNIT "V";YMULT 1.0E-3;YOFF 0;YZERO 0;VSCALE 2.0;VPOS 1.0;VOFFSET 0.0;:CURVE `
  const archive = () =>
    buffer(
      zipSync({
        'tek0000CH1.isf': new Uint8Array(isf(preamble('Ch1, DC coupling, 2.000V/div'), int16be([0, 1000, 2000, 3000]))),
        'tek0001CH3.isf': new Uint8Array(isf(preamble('Ch3, AC coupling, 2.000V/div'), int16be([0, 500, 1000, 1500]))),
        'tek0000.set': strToU8(setupText([':CH1:LABEL "clock";:SELECT:CH1 1;:SELECT:CH3 0'])),
      }),
    )

  it('takes the channels from the waveform ids and the colours of the older families', () => {
    const s = loadFiles([{ name: 'tek0000.zip', data: archive() }])
    expect(s.format).toBe('Tektronix waveforms (.isf) in .zip')
    expect(s.channels.map((c) => [c.wave.id, c.display.color])).toEqual([
      ['CH1', '#f2e32c'],
      ['CH3', '#e85ad6'],
    ])
  })

  it('reads the labels and visibility of the older setup keys, and the coupling and V/div from the files', () => {
    const s = loadFiles([{ name: 'tek0000.zip', data: archive() }])
    const [ch1, ch3] = s.channels
    expect(ch1.display).toMatchObject({ label: 'clock', visible: true, scale: 2, position: 1 })
    expect(ch3.display.visible).toBe(false)
    expect(ch1.input?.coupling).toBe('DC')
    expect(ch3.input?.coupling).toBe('AC')
  })
})

describe('channel ids', () => {
  it('are made from the file names: ch1, Tek000_CH1, math1, ref2', () => {
    const files = ['Tek000_CH1.wfm', 'math1.wfm', 'REF2.wfm'].map((name) => ({ name, data: wave() }))
    expect(loadFiles(files).channels.map((c) => c.wave.id)).toEqual(['CH1', 'MATH1', 'REF2'])
  })

  it('stay unique when file names map to the same channel', () => {
    const loaded = loadFiles([
      { name: 'Tek000_CH1.wfm', data: wave() },
      { name: 'ch1_d0.wfm', data: wave() },
      { name: 'CH1.wfm', data: wave() },
    ])
    expect(loaded.channels.map((c) => c.wave.id).sort()).toEqual(['CH1', 'CH1_2', 'CH1_D0'])
  })

  it('are sorted by number, not as text', () => {
    const files = ['ch10.wfm', 'ch2.wfm', 'ch1.wfm'].map((name) => ({ name, data: wave() }))
    expect(loadFiles(files).channels.map((c) => c.wave.id)).toEqual(['CH1', 'CH2', 'CH10'])
  })

  it('are made from the name for files that do not look like a channel', () => {
    expect(loadFiles([{ name: 'my capture-1.wfm', data: wave() }]).channels[0].wave.id).toBe('MY_CAPTURE_1')
  })
})

describe('files that cannot be read', () => {
  it('are left out and reported, and the session opens with the others', () => {
    const s = loadFiles([
      { name: 'ch1.wfm', data: wave() },
      // sample format 3 is not one the format has
      { name: 'ch2.wfm', data: wfm({ format: 3 }) },
    ])
    expect(s.channels.map((c) => c.wave.id)).toEqual(['CH1'])
    expect(s.warnings).toEqual(['ch2.wfm: unsupported sample format 3'])
  })

  it('give their own reason when nothing could be read', () => {
    expect(() => loadFiles([{ name: 'ch2.wfm', data: wfm({ format: 3 }) }])).toThrow('ch2.wfm: unsupported sample format 3')
    expect(() => loadFiles([{ name: 'ch1.wfm', data: wfm({ format: 3 }) }, { name: 'ch2.wfm', data: wfm({ format: 3 }) }])).toThrow(/\(and 1 more\)/)
  })

  it('are reported when a file of another kind is dropped', () => {
    expect(() => loadFiles([{ name: 'notes.txt', data: buffer(strToU8('hello')) }])).toThrow('notes.txt: unsupported file format')
  })

  it('say so when there is nothing to show', () => {
    expect(() => loadFiles([])).toThrow('No waveform files found')
    expect(() => loadFiles([{ name: 'shot.png', data: buffer(new Uint8Array([1])) }])).toThrow('No waveform files found')
  })

  it('say so when an archive is damaged or holds no waveforms', () => {
    expect(() => loadFiles([{ name: 'broken.zip', data: buffer(strToU8('not a zip at all')) }])).toThrow(/archive is damaged/)
    const empty = buffer(zipSync({ 'readme.txt': strToU8('nothing here') }))
    expect(() => loadFiles([{ name: 'empty.zip', data: empty }])).toThrow('The archive contains no waveform files (.wfm or .isf)')
  })

  it('name a damaged setup file', () => {
    // starts like a zip but is not one
    const bad = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])
    const s = loadFiles([{ name: 'ch1.wfm', data: wave() }, { name: 'x.set', data: buffer(bad) }])
    expect(s.channels).toHaveLength(1)
    expect(s.warnings?.[0]).toMatch(/x\.set/)
  })
})

describe('file formats (adapters)', () => {
  /** A family of scopes whose waveform files end in .fake */
  const fake: FormatAdapter = {
    id: 'fake',
    waveformExtensions: ['.fake'],
    isWaveform: (f) => f.name.endsWith('.fake'),
    recognises: (f) => f.name.endsWith('.fake') || f.name.endsWith('.fakeset'),
    load: (entries, ctx) => ({
      fileName: ctx.name,
      format: `Fake (${entries.length} files)`,
      channels: [{ wave: { id: 'CH1', data: new Float32Array(4), t0: 0, dt: 1, yUnit: 'V', xUnit: 's' }, display: { id: 'CH1', label: '', color: '#fff', visible: true, scale: 1, position: 0, offset: 0 } }],
      views: [['CH1']],
    }),
  }
  const bytes = buffer(new Uint8Array([1, 2, 3]))

  it('are asked in order: the first that finds a waveform of its own loads all the files', () => {
    expect(loadFiles([{ name: 'a.fake', data: bytes }], [fake, tektronix]).format).toBe('Fake (1 files)')
    expect(loadFiles([{ name: 'ch1.wfm', data: wave() }], [fake, tektronix]).format).toBe('Tektronix waveform (.wfm)')
    // both kinds present: the one listed first wins, and the other's files are not read
    const both = loadFiles([{ name: 'ch1.wfm', data: wave() }, { name: 'a.fake', data: bytes }], [fake, tektronix])
    expect(both.format).toBe('Fake (2 files)')
  })

  it('name the extensions of all of them when an archive holds no waveforms', () => {
    const empty = buffer(zipSync({ 'readme.txt': strToU8('nothing') }))
    expect(() => loadFiles([{ name: 'e.zip', data: empty }], [fake, tektronix])).toThrow('The archive contains no waveform files (.fake or .wfm or .isf)')
  })

  it('do not report files that another adapter knows as unsupported', () => {
    // the setup of the other family is no problem for the Tektronix loader
    const s = loadFiles([{ name: 'ch1.wfm', data: wave() }, { name: 'x.fakeset', data: bytes }], [tektronix, fake])
    expect(s.warnings).toBeUndefined()
  })

  it('report files nobody knows next to the ones that load', () => {
    const s = loadFiles([{ name: 'ch1.wfm', data: wave() }, { name: 'notes.txt', data: bytes }])
    expect(s.channels).toHaveLength(1)
    expect(s.warnings).toEqual(['notes.txt: unsupported file format'])
  })
})

describe('files that are not what their extension says', () => {
  it('are recognised by their content', () => {
    const s = loadFiles([{ name: 'capture.bin', data: wave() }])
    expect(s.channels).toHaveLength(1)
    expect(s.format).toBe('Tektronix waveform (.wfm)')
  })

  it('ignore the other files of an archive', () => {
    const zipped = zipSync({ 'ch1.wfm': new Uint8Array(wave()), 'log.csv': strToU8('a,b'), '__MACOSX/._ch1.wfm': new Uint8Array(4), 'folder/': new Uint8Array(0) })
    const s = loadFiles([{ name: 'x.zip', data: buffer(zipped) }])
    expect(s.channels.map((c) => c.wave.id)).toEqual(['CH1'])
    expect(s.warnings).toBeUndefined()
  })
})
