import { Hash } from 'lucide-react'
import { MEASUREMENT_DEFS } from '../dsp/measureDefs'
import type { Callout } from '../model/callouts'
import { DEFAULT_REGION_KEYS, MEASURE_SHORT } from '../model/calloutValues'
import { channelName } from '../util/names'

interface Props {
  callout: Callout
  /** Channels with a waveform */
  sources: string[]
  onUpdate: (patch: Partial<Callout>) => void
  /** Pressing a button keeps the focus where it is (in the inline editor: on the text) */
  keepFocus?: boolean
}

/**
 * The values a callout shows: a note the value of its trace at the anchor, a region the
 * measurements of a channel over its time span. Markers have none.
 */
export function CalloutValueEditor({ callout: c, sources, onUpdate, keepFocus }: Props) {
  const hold = keepFocus ? (e: React.MouseEvent) => e.preventDefault() : undefined

  if (c.type === 'note') {
    return (
      <div className="callout-values">
        <button
          type="button"
          className={`toggle-btn ${c.showValue ? 'active' : ''}`}
          aria-pressed={!!c.showValue}
          title={c.channel ? 'Show the value of the trace and the time at the anchor' : 'Show the time at the anchor'}
          onMouseDown={hold}
          onClick={() => onUpdate({ showValue: c.showValue ? undefined : true })}
        >
          <Hash size={13} aria-hidden /> {c.channel ? 'Show value' : 'Show time'}
        </button>
      </div>
    )
  }
  if (c.type !== 'region') return null

  const m = c.measure
  const allKeys = MEASUREMENT_DEFS.map((d) => d.key)
  return (
    <div className="callout-values">
      <label className="inline-field">
        Measure
        <select
          value={m?.channel ?? ''}
          aria-label="Channel to measure in this region"
          onChange={(e) => onUpdate({ measure: e.target.value ? { channel: e.target.value, keys: m?.keys.length ? m.keys : DEFAULT_REGION_KEYS } : undefined })}
        >
          <option value="">nothing</option>
          {m && !sources.includes(m.channel) && <option value={m.channel}>{channelName(m.channel)}</option>}
          {sources.map((s) => (
            <option key={s} value={s}>
              {channelName(s)}
            </option>
          ))}
        </select>
      </label>
      {m && (
        <div className="measure-pills" role="group" aria-label="Measurements shown in the label">
          {MEASUREMENT_DEFS.map((d) => {
            const on = m.keys.includes(d.key)
            return (
              <button
                key={d.key}
                type="button"
                className={`pill ${on ? 'active' : ''}`}
                aria-pressed={on}
                title={`${d.label}: ${d.short}`}
                onMouseDown={hold}
                // Shown in the order of the measurement list
                onClick={() => onUpdate({ measure: { ...m, keys: allKeys.filter((k) => (k === d.key ? !on : m.keys.includes(k))) } })}
              >
                {MEASURE_SHORT[d.key]}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
