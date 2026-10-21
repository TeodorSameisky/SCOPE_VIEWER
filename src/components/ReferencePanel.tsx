import { useEffect, useRef, useState } from 'react'
import type { MeasurementKey } from '../dsp/measure'
import { MEASURE_GROUP_LABEL, MEASUREMENT_DEFS, MEASUREMENT_NOTES } from '../dsp/measureDefs'
import { FUNCTION_DOCS, OPERATOR_DOCS } from '../math/expr'
import { MeasureInfo } from './MeasureInfo'

export type ReferenceSection = 'measurements' | 'math'

interface Props {
  section: ReferenceSection
  setSection: (s: ReferenceSection) => void
  /** Measurement to scroll to */
  focus?: MeasurementKey
}

/** Look-up documentation for measurements and math channel expressions. */
export function ReferencePanel({ section, setSection, focus }: Props) {
  const [query, setQuery] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()

  useEffect(() => {
    if (focus && section === 'measurements') bodyRef.current?.querySelector(`[data-key="${focus}"]`)?.scrollIntoView({ block: 'start' })
  }, [focus, section])

  const defs = MEASUREMENT_DEFS.filter((d) => !q || `${d.label} ${d.short} ${d.method}`.toLowerCase().includes(q))
  const fns = FUNCTION_DOCS.filter((f) => !q || `${f.name} ${f.description}`.toLowerCase().includes(q))

  return (
    <div className="panel-body reference" ref={bodyRef}>
      <div className="segmented full">
        <button type="button" className={section === 'measurements' ? 'active' : ''} onClick={() => setSection('measurements')}>
          Measurements
        </button>
        <button type="button" className={section === 'math' ? 'active' : ''} onClick={() => setSection('math')}>
          Math channels
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
    </div>
  )
}
