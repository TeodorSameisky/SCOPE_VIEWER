import { useCallback, useRef, useState } from 'react'
import { ClipboardCopy, Download, FileSpreadsheet, FileText, Image, Table2, Waves, X } from 'lucide-react'
import { CSV_FORMATS, type CsvFormatKey } from '../export/csv'
import type { ExportKind, ExportPrefs, WaveformOptions } from '../export/sessionExport'
import type { Appearance } from '../render/theme'
import { formatBytes } from '../util/format'
import { usePersistentState } from '../util/usePersistentState'
import { MEASURE_RANGES, RANGE_LABEL, type MeasureRange } from '../model/view'
import { useDismiss } from './ui/useDismiss'
import { useTheme } from './ui/themeContext'

const DEFAULT_PREFS: ExportPrefs = {
  csv: 'intl',
  image: { header: true, legend: true, spectrum: true, table: true, scale: 2, appearance: 'dark' },
  report: { image: true, channels: true, math: true, measurements: true, cursors: true, callouts: true, spectra: true, appearance: 'light' },
  waveforms: { range: 'screen', channels: 'visible', step: 1 },
}

const KINDS: { key: ExportKind; label: string; icon: typeof Image; hint: string }[] = [
  { key: 'image', label: 'Image', icon: Image, hint: 'PNG' },
  { key: 'report', label: 'Report', icon: FileText, hint: 'HTML, printable to PDF' },
  { key: 'waveforms', label: 'Waveform data', icon: Waves, hint: 'CSV' },
  { key: 'measurements', label: 'Measurements', icon: Table2, hint: 'CSV' },
  { key: 'spectra', label: 'Spectra', icon: FileSpreadsheet, hint: 'CSV' },
]

const STEPS = [1, 2, 5, 10, 20, 50, 100, 1000]

const APPEARANCES: { key: Appearance; label: string; note: string }[] = [
  { key: 'dark', label: 'Dark', note: 'dark background, trace colours as set' },
  { key: 'light', label: 'Light', note: 'for print: white background, pale trace colours darkened' },
]

/** Stored preferences completed with the defaults of options added since they were saved */
function withDefaults(p: ExportPrefs): ExportPrefs {
  return {
    ...p,
    image: { ...DEFAULT_PREFS.image, ...p.image },
    report: { ...DEFAULT_PREFS.report, ...p.report },
    waveforms: { ...DEFAULT_PREFS.waveforms, ...p.waveforms },
  }
}

interface Props {
  initial: ExportKind
  onClose: () => void
  hasSpectra: boolean
  cursorsOn: boolean
  /** Rows of a waveform export for the given options */
  waveformRows: (o: WaveformOptions) => { rows: number; columns: number }
  /** CSS size of the plot area, to show the image size */
  plotSize: { w: number; h: number }
  measurementInfo: { range: MeasureRange; count: number; channels: number }
  notes: string
  setNotes: (s: string) => void
  defaultTitle: string
  canCopyImage: boolean
  onExport: (kind: ExportKind, prefs: ExportPrefs, extra: { title: string; copy?: boolean }) => Promise<void>
}

/** One dialog for all outputs, with the options of each */
export function ExportDialog(p: Props) {
  const [kind, setKind] = useState<ExportKind>(p.initial)
  const [stored, setPrefs] = usePersistentState<ExportPrefs>('scope-viewer:export', DEFAULT_PREFS)
  const prefs = withDefaults(stored)
  const [title, setTitle] = useState(p.defaultTitle)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const screen = useTheme().appearance
  const close = useCallback(() => !busy && p.onClose(), [busy, p])
  useDismiss(ref, true, close)

  const set = <K extends keyof ExportPrefs>(key: K, patch: Partial<ExportPrefs[K]>) =>
    setPrefs((x) => ({ ...x, [key]: typeof x[key] === 'object' ? { ...(x[key] as object), ...patch } : patch }))

  const run = async (copy = false) => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await p.onExport(kind, prefs, { title: title.trim() || p.defaultTitle, copy })
      setDone(copy ? 'Copied to the clipboard' : 'Saved to your downloads')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const check = (label: string, value: boolean, onChange: (v: boolean) => void, disabled = false, hint?: string) => (
    <label className={`check ${disabled ? 'disabled' : ''}`} title={hint}>
      <input type="checkbox" checked={value && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
  const appearanceField = (value: Appearance, onChange: (a: Appearance) => void) => (
    <fieldset>
      <legend>Appearance</legend>
      <div className="segmented">
        {APPEARANCES.map((a) => (
          <button key={a.key} type="button" className={value === a.key ? 'active' : ''} onClick={() => onChange(a.key)}>
            {a.label}
          </button>
        ))}
      </div>
      <span className="muted">
        {value === screen ? 'as on screen' : APPEARANCES.find((a) => a.key === value)?.note}
      </span>
    </fieldset>
  )
  const formatSelect = (
    <label className="field">
      <span>Format</span>
      <select value={prefs.csv} onChange={(e) => setPrefs((x) => ({ ...x, csv: e.target.value as CsvFormatKey }))}>
        {CSV_FORMATS.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
    </label>
  )

  const img = prefs.image
  const wf = prefs.waveforms
  const est = kind === 'waveforms' ? p.waveformRows(wf) : null
  const estBytes = est ? est.rows * (est.columns * 14 + 18) : 0
  const disabled = (kind === 'spectra' && !p.hasSpectra) || (kind === 'measurements' && !p.measurementInfo.count) || (est !== null && est.rows === 0)

  return (
    <div className="modal-backdrop">
      <div className="dialog" ref={ref} role="dialog" aria-modal="true" aria-label="Export">
        <div className="dialog-head">
          <h3>Export</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="dialog-body">
          <nav className="dialog-nav" aria-label="Export type">
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                className={kind === k.key ? 'active' : ''}
                disabled={k.key === 'spectra' && !p.hasSpectra}
                title={k.key === 'spectra' && !p.hasSpectra ? 'Add a spectrum first' : undefined}
                onClick={() => {
                  setKind(k.key)
                  setDone(null)
                  setError(null)
                }}
              >
                <k.icon size={16} aria-hidden />
                <span>
                  {k.label}
                  <small>{k.hint}</small>
                </span>
              </button>
            ))}
          </nav>

          <div className="dialog-options">
            {kind === 'image' && (
              <>
                <p className="hint">The plot as shown, with callouts and cursors, plus the information you choose below.</p>
                <fieldset>
                  <legend>Include</legend>
                  {check('Header (file, time base, trigger, cursors)', img.header, (v) => set('image', { header: v }))}
                  {check('Channel legend (V/div, labels)', img.legend, (v) => set('image', { legend: v }))}
                  {check('Spectrum', img.spectrum, (v) => set('image', { spectrum: v }), !p.hasSpectra, p.hasSpectra ? undefined : 'No spectrum shown')}
                  {check('Measurement table', img.table, (v) => set('image', { table: v }), !p.measurementInfo.count)}
                </fieldset>
                {appearanceField(img.appearance, (a) => set('image', { appearance: a }))}
                <fieldset>
                  <legend>Resolution</legend>
                  <div className="segmented">
                    {([1, 2, 3] as const).map((s) => (
                      <button key={s} type="button" className={img.scale === s ? 'active' : ''} onClick={() => set('image', { scale: s })}>
                        {s}×
                      </button>
                    ))}
                  </div>
                  <span className="muted mono">
                    {Math.round(p.plotSize.w * img.scale)} px wide
                  </span>
                </fieldset>
              </>
            )}

            {kind === 'report' && (
              <>
                <p className="hint">A single HTML file that opens in any browser and can be printed to PDF. The notes are saved with the session.</p>
                <label className="field">
                  <span>Title</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label className="field column">
                  <span>Notes</span>
                  <textarea rows={4} value={p.notes} placeholder="What happened, test conditions, conclusions…" onChange={(e) => p.setNotes(e.target.value)} />
                </label>
                <fieldset>
                  <legend>Include</legend>
                  <div className="check-grid">
                    {check('Image', prefs.report.image, (v) => set('report', { image: v }))}
                    {check('Channel settings', prefs.report.channels, (v) => set('report', { channels: v }))}
                    {check('Math channels', prefs.report.math, (v) => set('report', { math: v }))}
                    {check('Measurements', prefs.report.measurements, (v) => set('report', { measurements: v }))}
                    {check('Cursors', prefs.report.cursors, (v) => set('report', { cursors: v }), !p.cursorsOn)}
                    {check('Callouts', prefs.report.callouts, (v) => set('report', { callouts: v }))}
                    {check('Spectrum peaks', prefs.report.spectra, (v) => set('report', { spectra: v }), !p.hasSpectra)}
                  </div>
                </fieldset>
                {appearanceField(prefs.report.appearance, (a) => set('report', { appearance: a }))}
                <p className="hint">The image uses the image options (header, legend, resolution) with the appearance chosen here.</p>
              </>
            )}

            {kind === 'waveforms' && (
              <>
                <fieldset>
                  <legend>Range</legend>
                  <div className="segmented">
                    {MEASURE_RANGES.map((r) => (
                      <button key={r} type="button" className={wf.range === r ? 'active' : ''} onClick={() => set('waveforms', { range: r })}>
                        {RANGE_LABEL[r]}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Channels</legend>
                  <div className="segmented">
                    <button type="button" className={wf.channels === 'visible' ? 'active' : ''} onClick={() => set('waveforms', { channels: 'visible' })}>
                      Visible
                    </button>
                    <button type="button" className={wf.channels === 'all' ? 'active' : ''} onClick={() => set('waveforms', { channels: 'all' })}>
                      All, incl. hidden
                    </button>
                  </div>
                </fieldset>
                <label className="field">
                  <span>Samples</span>
                  <select value={wf.step} onChange={(e) => set('waveforms', { step: Number(e.target.value) })}>
                    {STEPS.map((s) => (
                      <option key={s} value={s}>
                        {s === 1 ? 'Every sample' : `Every ${s}th sample`}
                      </option>
                    ))}
                  </select>
                </label>
                {formatSelect}
                {est && (
                  <p className={`hint ${est.rows > 2_000_000 ? 'warn' : ''}`}>
                    {est.rows.toLocaleString()} rows × {est.columns} channels, about {formatBytes(estBytes)}.
                    {est.rows > 1_048_576 && ' More rows than Excel can open (1,048,576) — use a larger sample step for Excel.'}
                  </p>
                )}
              </>
            )}

            {kind === 'measurements' && (
              <>
                <p className="hint">
                  The {p.measurementInfo.count} measurements of the table for {p.measurementInfo.channels} visible channels, range “{RANGE_LABEL[p.measurementInfo.range]}”.
                  Values are in base units (V, s, Hz, %), so they stay numeric in a spreadsheet.
                </p>
                {formatSelect}
              </>
            )}

            {kind === 'spectra' && (
              <>
                <p className="hint">The visible spectra with the window and level scale shown (dB or linear RMS), one row per frequency bin.</p>
                {formatSelect}
              </>
            )}

            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {done && <div className="success">{done}</div>}
          </div>
        </div>
        <div className="dialog-foot">
          {kind === 'image' && (
            <button
              type="button"
              className="secondary"
              disabled={busy || !p.canCopyImage}
              title={p.canCopyImage ? 'Copy the image to the clipboard' : 'Copying images needs a secure (HTTPS) connection'}
              onClick={() => run(true)}
            >
              <ClipboardCopy size={15} aria-hidden /> Copy
            </button>
          )}
          <button type="button" className="primary" disabled={busy || disabled} onClick={() => run()}>
            <Download size={15} aria-hidden /> {busy ? 'Exporting…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

