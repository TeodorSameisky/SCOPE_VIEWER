import { describe, expect, it } from 'vitest'
import { badgeItems, inputItems, inputSummary } from './input'

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

  it('shows termination and bandwidth on the badge, as the scope, and marks what differs from DC into a high impedance', () => {
    expect(badgeItems({ coupling: 'DC', termination: 1e6, bandwidth: 200e6 })).toEqual([
      { text: '1 MΩ', flag: false },
      { text: '200 MHz', flag: false },
    ])
    expect(badgeItems({ coupling: 'AC', termination: 50, bandwidth: 20e6, invert: true })).toEqual([
      { text: 'AC', flag: true },
      { text: '50 Ω', flag: true },
      { text: '20 MHz', flag: false },
      { text: 'Inv', flag: true },
    ])
    expect(badgeItems({ bandwidth: 'full' })).toEqual([{ text: 'Full BW', flag: false }])
    expect(badgeItems(undefined)).toEqual([])
  })
})
