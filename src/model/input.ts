import { si, siTick } from '../util/format'
import type { ChannelInput } from './types'

/** Coupling as the scopes write it → as shown */
const COUPLING_LABEL: Record<string, string> = { DC: 'DC', AC: 'AC', GND: 'GND', DCREJ: 'DC reject', DCREJECT: 'DC reject' }

/** A ratio without floating-point noise, e.g. 1 / 0.1 → 10 */
const ratio = (v: number) => String(parseFloat(v.toPrecision(4)))

const coupling = (c: string) => COUPLING_LABEL[c.toUpperCase()] ?? c
const probeMode = (m: string) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase()

/** The settings of a channel's input as label / value pairs, in a fixed order; settings the file does not have are left out */
export function inputItems(i: ChannelInput): { label: string; value: string }[] {
  const items: [string, string | undefined][] = [
    ['Coupling', i.coupling && coupling(i.coupling)],
    ['Termination', i.termination !== undefined ? siTick(i.termination, 'Ω') : undefined],
    ['Bandwidth', i.bandwidth === 'full' ? 'Full' : i.bandwidth !== undefined ? siTick(i.bandwidth, 'Hz') : undefined],
    ['Probe', i.attenuation !== undefined ? `${ratio(i.attenuation)}×` : undefined],
    ['External attenuation', i.extAttenuation !== undefined ? `${ratio(i.extAttenuation)}×` : undefined],
    ['Probe input', i.probeMode && probeMode(i.probeMode)],
    ['Probe delay', i.probeDelay ? si(i.probeDelay, 's') : undefined],
    ['Current via shunt', i.ampsPerVolt !== undefined ? `${ratio(i.ampsPerVolt)} A/V` : undefined],
    ['Inverted', i.invert ? 'yes' : undefined],
    ['Deskew', i.deskew ? si(i.deskew, 's') : undefined],
  ]
  return items.flatMap(([label, value]) => (value ? [{ label, value }] : []))
}

/** The same in one line, e.g. "DC · 1 MΩ · 200 MHz · probe 10×" */
export function inputSummary(i: ChannelInput): string {
  return inputItems(i)
    .map(({ label, value }) =>
      label === 'Coupling' || label === 'Termination' ? value : label === 'Bandwidth' ? `BW ${value === 'Full' ? 'full' : value}` : label === 'Inverted' ? 'inverted' : `${label.toLowerCase()} ${value}`,
    )
    .join(' · ')
}

/**
 * Short marks for the channel badge, as the scope shows them: only for settings that differ from
 * the usual DC coupling into a high-impedance input
 */
export function inputFlags(i: ChannelInput | undefined): string[] {
  if (!i) return []
  const flags: string[] = []
  const c = i.coupling?.toUpperCase()
  if (c && c !== 'DC') flags.push(c === 'DCREJ' || c === 'DCREJECT' ? 'DC rej' : coupling(c))
  if (i.termination !== undefined && i.termination <= 100) flags.push(siTick(i.termination, 'Ω'))
  if (i.invert) flags.push('Inv')
  return flags
}
