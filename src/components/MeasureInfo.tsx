import type { MeasurementDef } from '../dsp/measureDefs'
import { MeasureFigure } from './MeasureFigure'

/** Description card of one measurement: what it is, how it is computed, illustration. */
export function MeasureInfo({ def, compact }: { def: MeasurementDef; compact?: boolean }) {
  return (
    <div className={`measure-info ${compact ? 'compact' : ''}`}>
      <div className="measure-info-head">
        <strong>{def.label}</strong>
        <span className="tag">{def.group === 'amplitude' ? 'Amplitude' : 'Timing'}</span>
      </div>
      <p className="lead">{def.short}</p>
      <MeasureFigure highlight={def.key} />
      {def.formula && (
        <p className="formula">
          <span className="muted">Formula</span> <code>{def.formula}</code>
        </p>
      )}
      <p>{def.method}</p>
    </div>
  )
}
