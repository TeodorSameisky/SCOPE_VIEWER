import type { ChannelInput } from '../model/types'

/**
 * Parser for Tektronix SCPI "learn" setup files (*.set as stored in sessions).
 * Each line holds one or more `:HEADER:PATH value` commands separated by ';'.
 * Later occurrences of a header override earlier ones, like on the instrument.
 */
export function parseTekSetup(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    for (const cmd of line.split(/;(?=[:*])/)) {
      const c = cmd.trim()
      if (!c.startsWith(':')) continue
      const sp = c.indexOf(' ')
      const key = (sp < 0 ? c : c.slice(0, sp)).toUpperCase()
      const value = sp < 0 ? '' : c.slice(sp + 1).trim()
      out[key] = value
    }
  }
  return out
}

/** Strip surrounding quotes and URL-style escapes used by the 4/5/6-Series ("STO%20STAT"). */
export function setupString(v: string | undefined): string | undefined {
  if (v === undefined) return undefined
  const s = v.replace(/^"(.*)"$/, '$1')
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function setupNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

/** Named bandwidth settings of the older families */
const BANDWIDTH: Record<string, number | 'full'> = { FULL: 'full', OFF: 'full', ON: 20e6, TWENTY: 20e6, ONEFIFTY: 150e6, TWOFIFTY: 250e6 }
/** 1 / ON, 0 / OFF; undefined when not set */
const flag = (v: string | undefined) => (v === undefined ? undefined : /^(1|ON)$/i.test(v.trim()))

/**
 * The input settings of a channel in a setup: `get(suffix)` gives the value of `:<channel><suffix>`.
 * Reads the keys of the 4/5/6-Series (`:CH1:TERMINATION`, `:CH1:PROBEFUNC:EXTATTEN`, …) and of the
 * older families (`:CH1:IMPEDANCE`, `:CH1:PROBE:GAIN`, `:CH1:PROBE`, …). Undefined when there are none.
 */
export function readChannelInput(get: (suffix: string) => string | undefined): ChannelInput | undefined {
  const input: ChannelInput = {}
  const coupling = setupString(get(':COUPLING'))
  if (coupling) input.coupling = coupling.toUpperCase()

  const impedance = get(':IMPEDANCE')?.toUpperCase()
  const termination = setupNumber(get(':TERMINATION')) ?? (impedance === 'FIFTY' ? 50 : impedance === 'MEG' || impedance === 'ONEMEG' ? 1e6 : setupNumber(impedance))
  if (termination !== undefined && termination > 0) input.termination = termination

  const bw = get(':BANDWIDTH')?.toUpperCase()
  const bandwidth = bw === undefined ? undefined : (BANDWIDTH[bw] ?? setupNumber(bw))
  if (bandwidth !== undefined) input.bandwidth = bandwidth

  // Probe attenuation: the gain of the probe (0.1 for a 10× probe), or the attenuation itself (TDS1000/2000)
  const gain = setupNumber(get(':PROBE:GAIN'))
  const attenuation = gain && gain > 0 ? 1 / gain : setupNumber(get(':PROBE'))
  if (attenuation !== undefined && attenuation > 0) input.attenuation = attenuation
  const ext = setupNumber(get(':PROBEFUNC:EXTATTEN'))
  if (ext !== undefined && ext > 0 && ext !== 1) input.extAttenuation = ext
  const mode = setupString(get(':PROBE:INPUTMODE'))
  if (mode && !/^DEF/i.test(mode)) input.probeMode = mode
  const delay = setupNumber(get(':PROBE:PROPDELAY'))
  if (delay) input.probeDelay = delay
  if (flag(get(':AMPSVIAVOLTS:ENABLE'))) {
    const factor = setupNumber(get(':AMPSVIAVOLTS:FACTOR'))
    if (factor) input.ampsPerVolt = factor
  }

  const invert = flag(get(':INVERT'))
  if (invert !== undefined) input.invert = invert
  const deskew = setupNumber(get(':DESKEW'))
  if (deskew !== undefined) input.deskew = deskew
  return Object.keys(input).length ? input : undefined
}
