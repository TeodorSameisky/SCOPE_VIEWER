import { describe, expect, it } from 'vitest'
import { DEFAULT_SPECTRUM_OPTIONS, levelUnit, newSpectrum, parseStoredSpectra, spectrumSource, type SpectrumDef } from './spectrum'

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

  it('does not repeat a channel in the same window', () => {
    const a = newSpectrum([], 'CH1')
    const b = newSpectrum([a], 'CH1')
    expect(b.source).toBe('CH1')
    expect(b.window).not.toBe(a.window)
    expect(newSpectrum([a, b], 'CH1').window).not.toBe(a.window)
    expect(newSpectrum([a, b], 'CH1').window).not.toBe(b.window)
  })

  it('adds a spectrum of the selected channel, else of the next visible one without a spectrum', () => {
    const channels = [
      { id: 'CH1', visible: true },
      { id: 'CH2', visible: false },
      { id: 'CH3', visible: true },
    ]
    const of = (...sources: string[]): SpectrumDef[] => sources.map((source, i) => ({ id: `FFT${i + 1}`, source, window: 'hann', visible: true }))
    expect(spectrumSource(channels, [], 'CH3')).toBe('CH3')
    expect(spectrumSource(channels, [], undefined)).toBe('CH1')
    expect(spectrumSource(channels, of('CH3'), 'CH3')).toBe('CH1')
    expect(spectrumSource(channels, of('CH1', 'CH3'), 'CH3')).toBe('CH2')
    expect(spectrumSource(channels, of('CH1', 'CH2', 'CH3'), 'CH3')).toBe('CH3')
    expect(spectrumSource([], [], 'CH1')).toBeUndefined()
  })

  it('names the level unit', () => {
    expect(levelUnit('db', 'V')).toBe('dBV')
    expect(levelUnit('db', 'A')).toBe('dB(A)')
    expect(levelUnit('linear', 'V')).toBe('V RMS')
  })
})
