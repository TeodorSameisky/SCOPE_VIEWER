import { describe, expect, it } from 'vitest'
import { DEFAULT_SPECTRUM_OPTIONS, levelUnit, newSpectrum, parseStoredSpectra, type SpectrumDef } from './spectrum'

describe('stored spectra', () => {
  it('keeps valid entries and options', () => {
    const defs: SpectrumDef[] = [{ id: 'FFT1', source: 'CH1', window: 'flatTop', visible: false }]
    const options = { range: 'record', scale: 'linear', axis: 'linear', peaks: 10 } as const
    expect(parseStoredSpectra(JSON.parse(JSON.stringify({ defs, options })))).toEqual({ defs, options })
  })

  it('drops invalid entries and falls back to default options', () => {
    const r = parseStoredSpectra({
      defs: [{ id: 'FFT2', source: 'CH2', window: 'kaiser', visible: true }, { id: 'x', source: 'CH1', window: 'hann', visible: true }, null],
      options: { range: 'everything', peaks: 7 },
    })
    expect(r.defs).toEqual([])
    expect(r.options).toEqual(DEFAULT_SPECTRUM_OPTIONS)
    expect(parseStoredSpectra('nonsense')).toEqual({ defs: [], options: DEFAULT_SPECTRUM_OPTIONS })
  })
})

describe('spectrum helpers', () => {
  it('numbers new spectra and reuses the last window', () => {
    const a = newSpectrum([], 'CH1')
    expect(a).toEqual({ id: 'FFT1', source: 'CH1', window: 'hann', visible: true })
    const b = newSpectrum([{ ...a, window: 'blackmanHarris' }], 'MATH1')
    expect(b.id).toBe('FFT2')
    expect(b.window).toBe('blackmanHarris')
  })

  it('names the level unit', () => {
    expect(levelUnit('db', 'V')).toBe('dBV')
    expect(levelUnit('db', 'A')).toBe('dB(A)')
    expect(levelUnit('linear', 'V')).toBe('V RMS')
  })
})
