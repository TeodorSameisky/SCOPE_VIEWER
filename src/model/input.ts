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
 * What the channel badge shows of the input, as the scope's badge does: the termination and the
 * bandwidth always, and marked (`flag`) the settings that differ from DC coupling into a high
 * impedance (AC, 50 Ω, Inv)
 */
export function badgeItems(i: ChannelInput | undefined): { text: string; flag: boolean }[] {
  if (!i) return []
  const items: { text: string; flag: boolean }[] = []
  const c = i.coupling?.toUpperCase()
  if (c && c !== 'DC') items.push({ text: c === 'DCREJ' || c === 'DCREJECT' ? 'DC rej' : coupling(c), flag: true })
  if (i.termination !== undefined) items.push({ text: siTick(i.termination, 'Ω'), flag: i.termination <= 100 })
  if (i.bandwidth !== undefined) items.push({ text: i.bandwidth === 'full' ? 'Full BW' : siTick(i.bandwidth, 'Hz'), flag: false })
  if (i.invert) items.push({ text: 'Inv', flag: true })
  return items
}
