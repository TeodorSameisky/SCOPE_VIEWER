import { describe, expect, it } from 'vitest'
import { inputFlags, inputItems, inputSummary } from './input'

describe('channel input display', () => {
  it('lists the settings the file has, skipping the defaults', () => {
    const items = inputItems({ coupling: 'DC', termination: 1e6, bandwidth: 200e6, attenuation: 1 / 0.1, invert: false, deskew: 0 })
    expect(items).toEqual([
      { label: 'Coupling', value: 'DC' },
      { label: 'Termination', value: '1 MΩ' },
      { label: 'Bandwidth', value: '200 MHz' },
      { label: 'Probe', value: '10×' },
    ])
  })

  it('sums up a channel in one line', () => {
    expect(inputSummary({ coupling: 'DC', termination: 1e6, bandwidth: 200e6 })).toBe('DC · 1 MΩ · BW 200 MHz')
    expect(inputSummary({ coupling: 'DCREJ', bandwidth: 'full', attenuation: 10, invert: true, deskew: 2e-9 })).toBe('DC reject · BW full · probe 10× · inverted · deskew 2.000 ns')
  })

  it('marks only what differs from DC into a high impedance', () => {
    expect(inputFlags({ coupling: 'DC', termination: 1e6 })).toEqual([])
    expect(inputFlags({ coupling: 'AC', termination: 50, invert: true })).toEqual(['AC', '50 Ω', 'Inv'])
    expect(inputFlags(undefined)).toEqual([])
  })
})
