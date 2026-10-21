import { useEffect, useRef, useState } from 'react'
import type { MeasurementKey } from '../dsp/measure'
import { MEASURE_GROUP_LABEL, MEASUREMENT_DEFS, MEASUREMENT_NOTES } from '../dsp/measureDefs'
import { FUNCTION_DOCS, OPERATOR_DOCS } from '../math/expr'
import { MAX_FFT, WINDOW_DEFS } from '../math/fft'
import { MeasureInfo } from './MeasureInfo'
import { WindowFigure } from './WindowFigure'

export type ReferenceSection = 'measurements' | 'math' | 'spectrum'

/** Level differences and the amplitude ratio they stand for */
const DB_STEPS: [string, string][] = [
  ['+20 dB', '× 10'],
  ['+6 dB', '× 2'],
  ['−3 dB', '× 0.71 (half the power)'],
  ['−6 dB', '× 0.5'],
  ['−20 dB', '× 0.1'],
  ['−40 dB', '× 0.01'],
  ['−60 dB', '× 0.001'],
]

interface Props {
  section: ReferenceSection
  setSection: (s: ReferenceSection) => void
  /** Measurement to scroll to */
  focus?: MeasurementKey
}

/** Look-up documentation for measurements, math channel expressions and spectrum analysis. */
export function ReferencePanel({ section, setSection, focus }: Props) {
  const [query, setQuery] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()

  useEffect(() => {
    if (focus && section === 'measurements') bodyRef.current?.querySelector(`[data-key="${focus}"]`)?.scrollIntoView({ block: 'start' })
  }, [focus, section])

  const defs = MEASUREMENT_DEFS.filter((d) => !q || `${d.label} ${d.short} ${d.method}`.toLowerCase().includes(q))
  const fns = FUNCTION_DOCS.filter((f) => !q || `${f.name} ${f.description}`.toLowerCase().includes(q))
  const wins = WINDOW_DEFS.filter((w) => !q || `${w.label} ${w.use} window`.toLowerCase().includes(q))

  return (
    <div className="panel-body reference" ref={bodyRef}>
      <div className="segmented full">
        <button type="button" className={section === 'measurements' ? 'active' : ''} onClick={() => setSection('measurements')}>
          Measurements
        </button>
        <button type="button" className={section === 'math' ? 'active' : ''} onClick={() => setSection('math')}>
          Math channels
        </button>
        <button type="button" className={section === 'spectrum' ? 'active' : ''} onClick={() => setSection('spectrum')}>
          Spectrum
        </button>
      </div>
      <input className="search" type="search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search reference" />

      {section === 'measurements' && (
        <>
          {!q &&
            MEASUREMENT_NOTES.map((n) => (
              <div key={n.title} className="note-card">
                <strong>{n.title}</strong>
                <p>{n.text}</p>
              </div>
            ))}
          {(['amplitude', 'timing'] as const).map((g) => {
            const list = defs.filter((d) => d.group === g)
            if (!list.length) return null
            return (
              <section key={g}>
                <h4>{MEASURE_GROUP_LABEL[g]}</h4>
                {list.map((d) => (
                  <div key={d.key} data-key={d.key} className={`ref-item ${focus === d.key ? 'focused' : ''}`}>
                    <MeasureInfo def={d} />
                  </div>
                ))}
              </section>
            )
          })}
          {!defs.length && <div className="empty">Nothing found.</div>}
        </>
      )}

      {section === 'math' && (
        <>
          {!q && (
            <div className="note-card">
              <strong>Math channels</strong>
              <p>
                A math channel computes a new waveform from an expression over channels, sample by sample. Add one with <b>+ Math</b> in the
                channel bar. It can be plotted, measured, used with cursors and callouts, exported and referenced by other math channels.
              </p>
              <p className="examples">
                <code>CH1 - CH2</code> differential voltage · <code>CH1 * CH3</code> power (V × A = W) · <code>integ(CH1 * CH3)</code> energy ·{' '}
                <code>deriv(CH2)</code> slew rate · <code>lowpass(CH5, 100k)</code> remove switching noise
              </p>
            </div>
          )}
          {!q && (
            <section>
              <h4>Operators &amp; values</h4>
              <dl className="op-list">
                {OPERATOR_DOCS.map((o) => (
                  <div key={o.op}>
                    <dt>
                      <code>{o.op}</code>
                    </dt>
                    <dd>{o.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          <section>
            <h4>Functions</h4>
            {fns.map((f) => (
              <div key={f.name} className="fn-item">
                <code className="sig">{f.signature}</code>
                <p>{f.description}</p>
                <p className="muted">
                  e.g. <code>{f.example}</code>
                </p>
              </div>
            ))}
            {!fns.length && <div className="empty">Nothing found.</div>}
          </section>
          {!q && (
            <div className="note-card">
              <strong>Time base &amp; units</strong>
              <p>
                The result uses the time base of the first channel in the expression; other channels are interpolated onto it. The unit is
                derived from the expression (V − V = V, V × A = W, d/dt adds /s) and can be overridden in the math settings.
              </p>
            </div>
          )}
        </>
      )}

      {section === 'spectrum' && (
        <>
          {!q && (
            <>
              <div className="note-card">
                <strong>Spectrum (FFT)</strong>
                <p>
                  Shows which frequencies a signal contains, like the FFT math function of the scope. Click <b>FFT</b> in the channel bar or{' '}
                  <b>Show FFT</b> in a channel&apos;s settings; math channels work too. Each spectrum has its own window; the range, scale and
                  frequency axis are set in the spectrum bar.
                </p>
                <p>
                  The samples on screen, between the cursors or of the whole record are weighted with the window, padded with zeros to the next
                  power of two and transformed with an FFT (at most {MAX_FFT.toLocaleString()} points; longer ranges are first averaged in blocks
                  of samples, which lowers the highest frequency shown). The spectrum reaches from 0 Hz to half the sample rate.
                </p>
              </div>
              <div className="note-card">
                <strong>Levels &amp; the dB scale</strong>
                <p>
                  Levels are RMS values: a sine of amplitude A (peak) reads A/√2 at its frequency, a DC level reads its value. The window&apos;s
                  loss is corrected, so a tone on a bin reads the same with every window.
                </p>
                <p>
                  <b>dBV</b> = 20 · log<sub>10</sub>(V<sub>RMS</sub> / 1 V): 0 dBV is 1 V RMS (a sine of 2.83 V peak-to-peak), −20 dBV is 100 mV,
                  −40 dBV 10 mV. Other units are relative to 1 unit RMS, e.g. dB(A) for a current probe. For power into 50 Ω: dBm = dBV + 13.0.
                </p>
                <dl className="op-list">
                  {DB_STEPS.map(([db, ratio]) => (
                    <div key={db}>
                      <dt>
                        <code>{db}</code>
                      </dt>
                      <dd>amplitude {ratio}</dd>
                    </div>
                  ))}
                </dl>
                <p>
                  <b>Linear</b> shows the RMS value directly (V RMS): small components are hard to see, but it reads like a voltmeter.
                </p>
              </div>
              <div className="note-card">
                <strong>Resolution &amp; noise floor</strong>
                <p>
                  The bins are Δf = sample rate / FFT length apart. Two tones can only be told apart if they are a few resolution bandwidths apart:
                  RBW = ENBW × sample rate / samples, so a longer range resolves finer. Noise spreads over all bins and each bin collects the noise
                  within one RBW, so the noise floor drops by 10 dB for every 10× more samples while tones keep their level.
                </p>
                <p>
                  Tones between two bins read low by up to the window&apos;s scalloping loss. The peak list corrects for this (it interpolates the
                  frequency between bins and undoes the window&apos;s loss); for exact levels in the plot use Flat-top.
                </p>
              </div>
            </>
          )}
          <section>
            <h4>Window functions</h4>
            {!q && (
              <table className="data-table compact window-table">
                <thead>
                  <tr>
                    <th>Window</th>
                    <th title="Equivalent noise bandwidth (bins)">ENBW</th>
                    <th title="Worst-case level error between bins">Scallop</th>
                    <th title="Highest side lobe">Side lobe</th>
                  </tr>
                </thead>
                <tbody>
                  {WINDOW_DEFS.map((w) => (
                    <tr key={w.key}>
                      <td>{w.label}</td>
                      <td className="mono">{w.enbw.toFixed(2)}</td>
                      <td className="mono">{w.scallopDb.toFixed(2)} dB</td>
                      <td className="mono">{w.sidelobeDb.toFixed(0)} dB</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {wins.map((w) => (
              <div key={w.key} className="ref-item">
                <div className="measure-info">
                  <div className="measure-info-head">
                    <strong>{w.label}</strong>
                    <span className="tag">ENBW {w.enbw.toFixed(2)} bins</span>
                  </div>
                  <p className="lead">{w.use}</p>
                  <WindowFigure kind={w.key} />
                  <p className="formula">
                    <span className="muted">Side lobes</span> {w.sidelobeDb.toFixed(0)} dB · <span className="muted">scalloping loss</span>{' '}
                    {w.scallopDb.toFixed(2)} dB · <span className="muted">main lobe</span> ±{w.lobeBins} bins
                  </p>
                </div>
              </div>
            ))}
            {!wins.length && <div className="empty">Nothing found.</div>}
          </section>
          {!q && (
            <div className="note-card">
              <strong>Mouse</strong>
              <p>
                Wheel: zoom frequency · Shift+wheel: pan · Ctrl+wheel: zoom the level axis · Drag: pan · Shift+drag or drag on the frequency axis:
                zoom to a range · Double-click: full span. Point at the spectrum to read frequency and level.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
