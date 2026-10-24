import { describe, expect, it } from 'vitest'
import { parseTekSetup, readChannelInput } from './tekSetup'

const inputOf = (setup: string, ch = 'CH1') => {
  const s = parseTekSetup(setup)
  return readChannelInput((suffix) => s[`:${ch}${suffix}`])
}

describe('channel input settings', () => {
  it('reads the 4/5/6-Series keys', () => {
    const setup = [
      ':CH1:BANDWIDTH 200.0000E+6;:CH1:COUPLING DC;:CH1:DESKEW 0.0E+0;:CH1:INVERT 0',
      ':CH1:PROBE:INPUTMODE DEFAULT;:CH1:PROBEFUNC:EXTATTEN 1.0;:CH1:PROBETYPE ANALOG;:CH1:TERMINATION 1.0000E+6',
      ':CH2:COUPLING AC;:CH2:TERMINATION 50.0000;:CH2:INVERT 1;:CH2:PROBEFUNC:EXTATTEN 100.0;:CH2:PROBE:INPUTMODE DIFFERENTIAL;:CH2:DESKEW 2.0E-9',
    ].join('\n')
    expect(inputOf(setup)).toEqual({ coupling: 'DC', termination: 1e6, bandwidth: 200e6, invert: false, deskew: 0 })
    expect(inputOf(setup, 'CH2')).toEqual({ coupling: 'AC', termination: 50, extAttenuation: 100, probeMode: 'DIFFERENTIAL', invert: true, deskew: 2e-9 })
  })

  it('reads the keys of the older families', () => {
    const setup = [
      ':CH1:PROBE:GAIN 100.0000E-3;:CH1:PROBE:PROPDELAY 0.0E+0;:CH1:BANDWIDTH 350.0000E+6;:CH1:COUPLING DC;:CH1:TERMINATION 1.0000E+6',
      ':CH3:PROBE:GAIN 1.0000;:CH3:PROBE:PROPDELAY 14.5000E-9;:CH3:AMPSVIAVOLTS:ENABLE 1;:CH3:AMPSVIAVOLTS:FACTOR 10.0000',
      ':CH4:PROBE 10;:CH4:BANDWIDTH ON;:CH4:IMPEDANCE FIFTY;:CH4:COUPLING GND;:CH4:INVERT OFF',
    ].join(';')
    expect(inputOf(setup)?.attenuation).toBeCloseTo(10)
    expect(inputOf(setup)).toMatchObject({ coupling: 'DC', termination: 1e6, bandwidth: 350e6 })
    expect(inputOf(setup, 'CH3')).toEqual({ attenuation: 1, probeDelay: 14.5e-9, ampsPerVolt: 10 })
    expect(inputOf(setup, 'CH4')).toEqual({ coupling: 'GND', termination: 50, bandwidth: 20e6, attenuation: 10, invert: false })
  })

  it('has nothing for a channel without input settings', () => {
    expect(inputOf(':CH1:SCALE 1.0;:CH1:LABEL "x"')).toBeUndefined()
  })
})
