import type { MeasurementKey } from '../dsp/measure'
import { measurementDef } from '../dsp/measureDefs'
import type { MathResult } from '../math/expr'
import { calloutTitle, type Callout } from '../model/callouts'
import type { MathDef } from '../model/math'
import type { SpectrumDef, SpectrumOptions } from '../model/spectrum'
import type { ChannelDisplay, Session } from '../model/types'
import { valueAt } from '../render/draw'
import { loadTex, texHtml } from '../render/tex'
import { THEMES, type Appearance } from '../render/theme'
import { downloadBlob, stem } from '../util/download'
import { si } from '../util/format'
import { channelName } from '../util/names'
import type { ExportKind, ExportPrefs, WaveformOptions } from '../components/ExportDialog'
import type { PlotAreaHandle } from '../components/PlotArea'
import type { SpectrumViewHandle } from '../components/SpectrumView'
import { RANGE_LABEL, type CursorState, type LiveChannel, type MeasureRange, type TimeWindow } from '../components/state'
import { buildMeasurementsCsv, buildSpectrumCsv, buildWaveformCsv, csvFormat, waveformRowCount } from './csv'
import { canvasToBlob, composeImage } from './image'
import { measureChannels, measurementTable } from './measureRows'
import { blobToDataUrl, buildReport, type ReportTable } from './report'

/** What an export needs to know about the open session and its view */
export interface ExportContext {
  session: Session
  /** Channels with a waveform (inputs and math) */
  channels: LiveChannel[]
  math: { def: MathDef; display: ChannelDisplay; result?: MathResult }[]
  callouts: Callout[]
  cursors: CursorState
  win: TimeWindow
  record: TimeWindow
  minDt: number
  timePerDiv: number
  measKeys: MeasurementKey[]
  measRange: MeasureRange
  spectra: SpectrumDef[]
  specOptions: SpectrumOptions
  notes: string
  plot: PlotAreaHandle | null
  spectrum: SpectrumViewHandle | null
}

const visible = (ctx: ExportContext) => ctx.channels.filter((c) => c.display.visible)

/** Time window of a measurement / export range */
export function rangeWindow(ctx: ExportContext, r: MeasureRange): TimeWindow {
  if (r === 'screen') return ctx.win
  if (r === 'cursors') return { start: Math.min(ctx.cursors.a, ctx.cursors.b), end: Math.max(ctx.cursors.a, ctx.cursors.b) }
  return ctx.record
}

export function waveformRows(ctx: ExportContext, o: WaveformOptions): { rows: number; columns: number } {
  const list = o.channels === 'all' ? ctx.channels : visible(ctx)
  if (!list.length) return { rows: 0, columns: 0 }
  const w = rangeWindow(ctx, o.range)
  return { rows: waveformRowCount(list[0].wave, w.start, w.end, o.step), columns: list.length }
}

function infoLines(ctx: ExportContext): string[] {
  const { session, record, win, cursors } = ctx
  const first = session.channels[0].wave
  const trig = session.trigger
  const lines = [
    `${session.format} · ${first.data.length.toLocaleString()} pts · ${si(1 / ctx.minDt, 'S/s', 3)} · record ${si(record.start, 's')} … ${si(record.end, 's')}`,
    `${si(ctx.timePerDiv, 's/div', 3)} · shown ${si(win.start, 's')} … ${si(win.end, 's')}` +
      (trig ? ` · trigger ${trig.source} ${trig.slope === 'FALL' ? '↘' : '↗'} ${trig.level !== undefined ? si(trig.level, 'V', 3) : ''}` : ''),
  ]
  if (cursors.on) {
    const dt = cursors.b - cursors.a
    lines.push(`cursors A ${si(cursors.a, 's')} · B ${si(cursors.b, 's')} · Δt ${si(dt, 's')} · 1/Δt ${si(1 / Math.abs(dt), 'Hz')}`)
  }
  return lines
}

async function renderImage(ctx: ExportContext, prefs: ExportPrefs, appearance: Appearance): Promise<HTMLCanvasElement> {
  const o = prefs.image
  const theme = THEMES[appearance]
  const plot = await ctx.plot?.renderImage(o.scale, theme)
  if (!plot) throw new Error('The plot is not ready')
  const spec = o.spectrum ? ctx.spectrum?.renderImage(o.scale, theme) : null
  const rows = o.table ? measureChannels(ctx.channels, ctx.measRange, ctx.win, ctx.cursors) : []
  const table = o.table && ctx.measKeys.length && rows.length ? measurementTable(rows, ctx.measKeys) : undefined
  if (table) table.columns[0] = `Channel (${RANGE_LABEL[ctx.measRange].toLowerCase()})`
  return composeImage({
    scale: o.scale,
    width: plot.width / o.scale,
    header: o.header ? { title: ctx.session.fileName, lines: infoLines(ctx) } : undefined,
    legend: o.legend
      ? visible(ctx).map((c) => {
          const def = ctx.math.find((m) => m.def.id === c.wave.id)?.def
          return {
            name: channelName(c.wave.id),
            label: def ? `${c.display.label ? `${c.display.label}: ` : ''}${def.expr}` : c.display.label,
            color: c.display.color,
            detail: si(c.display.scale, `${c.wave.yUnit}/div`, 3),
          }
        })
      : undefined,
    plots: spec ? [plot, spec] : [plot],
    table,
    footer: `Scope Viewer · ${new Date().toLocaleString()}`,
    theme,
  })
}

function reportTables(ctx: ExportContext, prefs: ExportPrefs): ReportTable[] {
  const o = prefs.report
  const { channels, cursors, callouts } = ctx
  const tables: ReportTable[] = []
  if (o.channels) {
    tables.push({
      title: 'Channels',
      columns: ['Channel', 'Label', 'Scale', 'Offset', 'Position', 'Shown'],
      rows: channels.map((c) => ({
        color: c.display.color,
        cells: [channelName(c.wave.id), c.display.label, si(c.display.scale, `${c.wave.yUnit}/div`, 3), si(c.display.offset, c.wave.yUnit), `${c.display.position} div`, c.display.visible ? 'yes' : 'no'],
      })),
    })
  }
  if (o.math && ctx.math.length) {
    tables.push({
      title: 'Math channels',
      columns: ['Channel', 'Expression', 'Unit'],
      rows: ctx.math.map((m) => ({
        color: m.display.color,
        cells: [channelName(m.def.id), m.def.expr + (m.result?.error ? `  (error: ${m.result.error})` : ''), m.result?.wave?.yUnit ?? ''],
      })),
    })
  }
  if (o.measurements && ctx.measKeys.length) {
    const w = rangeWindow(ctx, ctx.measRange)
    const t = measurementTable(measureChannels(channels, ctx.measRange, ctx.win, cursors), ctx.measKeys)
    tables.push({ title: 'Measurements', note: `Range: ${RANGE_LABEL[ctx.measRange].toLowerCase()} (${si(w.start, 's')} … ${si(w.end, 's')})`, ...t })
  }
  if (o.cursors && cursors.on) {
    const dt = cursors.b - cursors.a
    tables.push({
      title: 'Cursors',
      note: `A ${si(cursors.a, 's')} · B ${si(cursors.b, 's')} · Δt ${si(dt, 's')} · 1/Δt ${si(1 / Math.abs(dt), 'Hz')}`,
      columns: ['Channel', 'At A', 'At B', 'Δ (B − A)'],
      rows: visible(ctx).map((c) => {
        const a = valueAt(c.wave, cursors.a)
        const b = valueAt(c.wave, cursors.b)
        return { color: c.display.color, cells: [channelName(c.wave.id), si(a, c.wave.yUnit), si(b, c.wave.yUnit), si(b - a, c.wave.yUnit)] }
      }),
    })
  }
  if (o.callouts && callouts.length) {
    tables.push({
      title: 'Callouts',
      columns: ['Callout', 'Time', 'Duration', 'Channel', 'Text'],
      rows: [...callouts]
        .sort((a, b) => a.t - b.t)
        .map((c) => ({
          color: c.color,
          cells: [
            `${c.type === 'note' ? 'Note' : c.type === 'marker' ? 'Marker' : 'Region'} ${c.n}`,
            si(c.type === 'region' ? Math.min(c.t, c.t2 ?? c.t) : c.t, 's', 5),
            c.type === 'region' && c.t2 !== undefined ? si(Math.abs(c.t2 - c.t), 's') : '',
            c.channel ? channelName(c.channel) : '',
            { html: texHtml(c.text || calloutTitle(c)) },
          ],
        })),
    })
  }
  if (o.spectra && ctx.spectra.length) {
    const data = ctx.spectrum?.getData()
    if (data?.items.length) {
      tables.push({
        title: 'Spectrum peaks',
        note: `Range: ${RANGE_LABEL[ctx.specOptions.range].toLowerCase()} · levels in ${data.levelUnit}`,
        columns: ['Spectrum', 'Peak', 'Frequency', 'Level'],
        rows: data.items.flatMap((it) =>
          it.peaks.map((pk, i) => ({
            color: it.color,
            cells: [
              `${it.name} (${it.window})`,
              String(i + 1),
              si(pk.freq, 'Hz', 5),
              data.scale === 'db' ? `${(20 * Math.log10(pk.rms)).toFixed(1)} ${data.levelUnit}` : si(pk.rms, data.levelUnit),
            ],
          })),
        ),
      })
    }
  }
  return tables
}

/** Create one of the outputs of the export dialog and download (or copy) it */
export async function runExport(ctx: ExportContext, kind: ExportKind, prefs: ExportPrefs, extra: { title: string; copy?: boolean }): Promise<void> {
  const { session } = ctx
  const fileStem = stem(session.fileName)
  const format = csvFormat(prefs.csv)

  if (kind === 'image') {
    const blob = await canvasToBlob(await renderImage(ctx, prefs, prefs.image.appearance))
    if (!blob) throw new Error('Could not create the image')
    if (extra.copy) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    else downloadBlob(blob, `${fileStem}.png`)
    return
  }

  if (kind === 'report') {
    const image = prefs.report.image ? await canvasToBlob(await renderImage(ctx, prefs, prefs.report.appearance)) : null
    if (prefs.report.callouts) await loadTex(ctx.callouts.map((c) => c.text))
    // Colour dots of the tables as in the image (pale trace colours darkened in a light one)
    const { ink } = THEMES[prefs.report.appearance]
    const first = session.channels[0].wave
    const trig = session.trigger
    const meta: [string, string][] = [
      ['File', session.fileName],
      ['Format', session.format],
      ['Record', `${first.data.length.toLocaleString()} points, ${si(1 / ctx.minDt, 'S/s', 4)}, ${si(ctx.record.start, 's')} … ${si(ctx.record.end, 's')}`],
    ]
    if (trig) meta.push(['Trigger', `${trig.source} ${trig.slope?.toLowerCase() ?? ''} ${trig.level !== undefined ? si(trig.level, 'V', 4) : ''}`])
    meta.push(['Shown', `${si(ctx.win.start, 's')} … ${si(ctx.win.end, 's')} (${si(ctx.timePerDiv, 's/div', 3)})`])
    meta.push(['Report created', new Date().toLocaleString()])
    if (session.fingerprint) meta.push(['File SHA-256', session.fingerprint])
    const html = buildReport({
      title: extra.title,
      notes: ctx.notes,
      meta,
      image: image ? await blobToDataUrl(image) : undefined,
      tables: reportTables(ctx, prefs).map((t) => ({ ...t, rows: t.rows.map((r) => (r.color ? { ...r, color: ink(r.color) } : r)) })),
      generatedBy: `Created with Scope Viewer ${__APP_VERSION__} from ${session.fileName}`,
    })
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${fileStem}-report.html`)
    return
  }

  if (kind === 'waveforms') {
    const o = prefs.waveforms
    const list = o.channels === 'all' ? ctx.channels : visible(ctx)
    if (!list.length) throw new Error('No channels to export')
    const w = rangeWindow(ctx, o.range)
    downloadBlob(buildWaveformCsv(list, w.start, w.end, format, o.step), `${fileStem}-${o.range}.csv`)
    return
  }

  if (kind === 'measurements') {
    const rows = measureChannels(ctx.channels, ctx.measRange, ctx.win, ctx.cursors)
    downloadBlob(
      buildMeasurementsCsv(
        ctx.measKeys.map((k) => measurementDef(k)),
        rows.map(({ channel, m }) => ({ channel: channelName(channel.wave.id), label: channel.display.label, unit: channel.wave.yUnit, values: ctx.measKeys.map((k) => m[k]) })),
        format,
      ),
      `${fileStem}-measurements.csv`,
    )
    return
  }

  const data = ctx.spectrum?.getData()
  if (!data?.items.length) throw new Error('No visible spectrum')
  const db = data.scale === 'db'
  downloadBlob(
    buildSpectrumCsv(
      data.levelUnit,
      data.items.map((it) => ({ name: `${it.name} ${it.window}`, df: it.spec.df, values: db ? Array.from(it.spec.rms, (v) => 20 * Math.log10(v)) : it.spec.rms })),
      format,
    ),
    `${fileStem}-spectra.csv`,
  )
}
