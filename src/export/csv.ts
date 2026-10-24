import type { Channel } from '../model/types'
import { valueAt } from '../render/draw'
import { channelName } from '../util/names'

export type CsvFormatKey = 'intl' | 'excel-de' | 'tab'

export interface CsvFormat {
  key: CsvFormatKey
  label: string
  sep: string
  decimal: '.' | ','
  /** UTF-8 byte order mark, so Excel shows µ, ä etc. correctly */
  bom: boolean
}

export const CSV_FORMATS: CsvFormat[] = [
  { key: 'intl', label: 'Comma separated, decimal point', sep: ',', decimal: '.', bom: false },
  { key: 'excel-de', label: 'Semicolon separated, decimal comma (Excel in DE/EU)', sep: ';', decimal: ',', bom: true },
  { key: 'tab', label: 'Tab separated, decimal point', sep: '\t', decimal: '.', bom: false },
]

export function csvFormat(key: CsvFormatKey): CsvFormat {
  return CSV_FORMATS.find((f) => f.key === key) ?? CSV_FORMATS[0]
}

/** Writer that formats numbers and quotes text for one CSV dialect */
function writer(f: CsvFormat) {
  const num = (v: number, digits = 7): string => {
    if (!Number.isFinite(v)) return ''
    const s = v.toPrecision(digits)
    return f.decimal === ',' ? s.replace('.', ',') : s
  }
  const text = (s: string): string => (/[",;\t\n\r]/.test(s) || s.includes(f.sep) ? `"${s.replace(/"/g, '""')}"` : s)
  const row = (cells: string[]) => cells.join(f.sep)
  return { num, text, row, start: f.bom ? '﻿' : '' }
}

/** Number of rows a waveform export would have */
export function waveformRowCount(ref: Channel['wave'], tStart: number, tEnd: number, step: number): number {
  const i0 = Math.max(0, Math.ceil((tStart - ref.t0) / ref.dt))
  const i1 = Math.min(ref.data.length - 1, Math.floor((tEnd - ref.t0) / ref.dt))
  return i1 < i0 ? 0 : Math.floor((i1 - i0) / step) + 1
}

/**
 * Waveform samples between tStart and tEnd on the time base of the first channel
 * (other channels are interpolated if their time base differs); every `step`-th sample.
 */
export function buildWaveformCsv(channels: Channel[], tStart: number, tEnd: number, format: CsvFormat, step = 1): Blob {
  const w = writer(format)
  const ref = channels[0].wave
  const i0 = Math.max(0, Math.ceil((tStart - ref.t0) / ref.dt))
  const i1 = Math.min(ref.data.length - 1, Math.floor((tEnd - ref.t0) / ref.dt))
  const same = channels.map((c) => c.wave.t0 === ref.t0 && c.wave.dt === ref.dt && c.wave.data.length === ref.data.length)
  // Channels named as everywhere else in the app and the other exports ("Ch 1")
  const header = ['Time (s)', ...channels.map((c) => `${channelName(c.wave.id)}${c.display.label ? ` ${c.display.label}` : ''}${c.wave.yUnit ? ` (${c.wave.yUnit})` : ''}`)]
  const parts: string[] = [w.start + w.row(header.map(w.text)) + '\n']
  const CHUNK = 20000
  let lines: string[] = []
  for (let i = i0; i <= i1; i += step) {
    const t = ref.t0 + i * ref.dt
    const cells = [w.num(t, 10)]
    for (let k = 0; k < channels.length; k++) cells.push(w.num(same[k] ? channels[k].wave.data[i] : valueAt(channels[k].wave, t)))
    lines.push(w.row(cells))
    if (lines.length >= CHUNK) {
      parts.push(lines.join('\n') + '\n')
      lines = []
    }
  }
  if (lines.length) parts.push(lines.join('\n') + '\n')
  return new Blob(parts, { type: 'text/csv;charset=utf-8' })
}

export interface MeasurementRow {
  channel: string
  label: string
  unit: string
  values: number[]
}

/** One row per channel; values in base units, with the vertical unit in its own column */
export function buildMeasurementsCsv(columns: { label: string; unit: 'y' | 's' | 'Hz' | '%' }[], rows: MeasurementRow[], format: CsvFormat): Blob {
  const w = writer(format)
  const header = ['Channel', 'Label', 'Unit', ...columns.map((c) => (c.unit === 'y' ? c.label : `${c.label} (${c.unit})`))]
  const lines = [w.row(header.map(w.text)), ...rows.map((r) => w.row([w.text(r.channel), w.text(r.label), w.text(r.unit), ...r.values.map((v) => w.num(v))]))]
  return new Blob([w.start + lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' })
}

export interface SpectrumColumn {
  name: string
  /** Unit of the levels, e.g. dBV */
  unit: string
  df: number
  values: Float64Array | Float32Array | number[]
}

/**
 * Spectra as columns. Spectra with the same frequency grid share one frequency column,
 * otherwise each gets its own.
 */
export function buildSpectrumCsv(spectra: SpectrumColumn[], format: CsvFormat): Blob {
  const w = writer(format)
  const shared = spectra.every((s) => s.df === spectra[0].df && s.values.length === spectra[0].values.length)
  const header = shared
    ? ['Frequency (Hz)', ...spectra.map((s) => `${s.name} (${s.unit})`)]
    : spectra.flatMap((s) => [`${s.name} frequency (Hz)`, `${s.name} (${s.unit})`])
  const n = Math.max(0, ...spectra.map((s) => s.values.length))
  const lines = [w.row(header.map(w.text))]
  for (let k = 0; k < n; k++) {
    const cells = shared
      ? [w.num(k * spectra[0].df, 10), ...spectra.map((s) => w.num(s.values[k]))]
      : spectra.flatMap((s) => (k < s.values.length ? [w.num(k * s.df, 10), w.num(s.values[k])] : ['', '']))
    lines.push(w.row(cells))
  }
  return new Blob([w.start + lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' })
}
