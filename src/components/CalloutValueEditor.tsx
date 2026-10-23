import { Hash } from 'lucide-react'
import { MEASUREMENT_DEFS } from '../dsp/measureDefs'
import type { Callout } from '../model/callouts'
import type { ChannelDisplay } from '../model/types'
import { divToValue, valueToDiv } from '../render/draw'
import { DEFAULT_REGION_KEYS, MEASURE_SHORT } from '../model/calloutValues'
import { channelName } from '../util/names'

interface Props {
  callout: Callout
  /** Channels with a waveform */
  sources: string[]
  /** Their display settings: a box can move to another channel, keeping its place on screen */
  displays?: ChannelDisplay[]
  onUpdate: (patch: Partial<Callout>) => void
  /** Pressing a button keeps the focus where it is (in the inline editor: on the text) */
  keepFocus?: boolean
}

/**
 * The values a callout shows: a note the value of its trace at the anchor, a span Δv and 1/Δt,
 * a region or box the measurements of a channel over its time span (and a box its shape).
 * Markers have none.
 */
export function CalloutValueEditor({ callout: c, sources, displays, onUpdate, keepFocus }: Props) {
  const hold = keepFocus ? (e: React.MouseEvent) => e.preventDefault() : undefined

  if (c.type === 'note' || c.type === 'span') {
    const [label, title] =
      c.type === 'span'
        ? ['Show Δv, 1/Δt', 'Also show the difference between the values at the ends (when both channels have the same unit) and 1/Δt']
        : c.channel
          ? ['Show value', 'Show the value of the trace and the time at the anchor']
          : ['Show time', 'Show the time at the anchor']
    return (
      <div className="callout-values">
        <button
          type="button"
          className={`toggle-btn ${c.showValue ? 'active' : ''}`}
          aria-pressed={!!c.showValue}
          title={title}
          onMouseDown={hold}
          onClick={() => onUpdate({ showValue: c.showValue ? undefined : true })}
        >
          <Hash size={13} aria-hidden /> {label}
        </button>
      </div>
    )
  }
  if (c.type !== 'region' && c.type !== 'box') return null

  const m = c.measure
  const allKeys = MEASUREMENT_DEFS.map((d) => d.key)
  /** The box on another channel, in the same place on screen (in that channel's values) */
  const attach = (id: string) => {
    const from = displays?.find((d) => d.id === c.channel)
    const to = displays?.find((d) => d.id === id)
    if (!from || !to || c.v === undefined || c.v2 === undefined) return
    const convert = (v: number) => parseFloat(divToValue(valueToDiv(v, from), to).toPrecision(6))
    onUpdate({ channel: id, v: convert(c.v), v2: convert(c.v2) })
  }
  return (
    <div className="callout-values">
      {c.type === 'box' && c.channel && displays && (
        <label className="inline-field" title="The trace the box stays with when you change its V/div or position">
          On
          <select value={c.channel} aria-label="Channel the box stays with" onChange={(e) => attach(e.target.value)}>
            {displays
              .filter((d) => sources.includes(d.id))
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {channelName(d.id)}
                </option>
              ))}
          </select>
        </label>
      )}
      {c.type === 'box' && (
        <div className="segmented" role="group" aria-label="Shape">
          {(['rect', 'ellipse'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={(c.shape ?? 'rect') === s ? 'active' : ''}
              aria-pressed={(c.shape ?? 'rect') === s}
              onMouseDown={hold}
              onClick={() => onUpdate({ shape: s === 'rect' ? undefined : s })}
            >
              {s === 'rect' ? 'Rectangle' : 'Ellipse'}
            </button>
          ))}
        </div>
      )}
      <label className="inline-field">
        Measure
        <select
          value={m?.channel ?? ''}
          aria-label={`Channel to measure in this ${c.type}`}
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
