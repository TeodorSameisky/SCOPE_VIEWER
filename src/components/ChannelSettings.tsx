import { useState } from 'react'
import { AudioLines, Eye, EyeOff, Plus } from 'lucide-react'
import { inputItems, inputSummary } from '../model/input'
import type { ChannelDisplay, ChannelInput } from '../model/types'
import { parseValue, siTick } from '../util/format'
import { channelName, displayUnit, perDiv } from '../util/names'
import { POSITION_STEP, stepPosition, stepScale, type DisplayPatch } from '../model/view'
import { chipStyle, useTheme } from './ui/themeContext'

interface Props {
  display: ChannelDisplay
  /** Vertical unit of the channel */
  unit: string
  /** Coupling, termination, probe … as set on the scope (read only) */
  input?: ChannelInput
  /** It has a waveform (not a math channel whose expression failed): autoscale and FFT need one */
  hasWave: boolean
  views: string[][]
  onAdjust: (id: string, patch: DisplayPatch) => void
  onMoveToView: (id: string, view: number) => void
  /** The pointer is on the button of a view (undefined: left it), for the plot to outline that view */
  onPreviewView?: (view: number | undefined) => void
  onAutoscale: (id: string) => void
  hasSpectrum: boolean
  canAddSpectrum: boolean
  onToggleSpectrum: () => void
  /** Extra content between the header and the vertical settings (math expression) */
  children?: React.ReactNode
}

/** Vertical settings of one channel (shown in the channel badge popover). */
export function ChannelSettings({ display: d, unit, input, hasWave, views, onAdjust, onMoveToView, onPreviewView, onAutoscale, hasSpectrum, canAddSpectrum, onToggleSpectrum, children }: Props) {
  const id = d.id
  const view = views.findIndex((v) => v.includes(id))
  const { ink, onInk } = useTheme().theme
  // What can follow a typed number: the unit as it is shown, and as the scope names it (U without a unit)
  const units = [...new Set([unit, displayUnit(unit)])].filter(Boolean)
  const scaleUnits = units.flatMap((u) => [`${u}/div`, u])
  const offsetUnits = units
  return (
    <div className="channel-settings" style={chipStyle(ink(d.color), onInk)}>
      <div className="channel-head">
        <span className="chip">{channelName(id)}</span>
        <input className="label-input" value={d.label} placeholder="Label" aria-label="Label" onChange={(e) => onAdjust(id, { label: e.target.value })} />
        <input type="color" value={d.color} title="Trace colour" aria-label="Trace colour" onChange={(e) => onAdjust(id, { color: e.target.value })} />
        <button type="button" className="icon-btn" title={d.visible ? 'Hide' : 'Show'} aria-label={d.visible ? 'Hide' : 'Show'} onClick={() => onAdjust(id, { visible: !d.visible })}>
          {d.visible ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </div>
      {children}
      <div className="channel-grid">
        <span title={SCALE_HINT}>Scale</span>
        <div className="stepper">
          <button type="button" onClick={() => onAdjust(id, { scale: stepScale(d.scale, -1) })} title="Smaller value per division: the trace gets taller" aria-label="Decrease V/div">
            −
          </button>
          <ValueField
            className="mono num mid"
            title={SCALE_HINT}
            aria-label="Scale (per division)"
            value={d.scale}
            format={(v) => perDiv(v, unit)}
            parse={(text) => {
              const v = parseValue(text, scaleUnits)
              return v !== undefined && v > 0 ? v : undefined
            }}
            stepBy={(dir) => stepScale(d.scale, dir)}
            onChange={(scale) => onAdjust(id, { scale })}
          />
          <button type="button" onClick={() => onAdjust(id, { scale: stepScale(d.scale, 1) })} title="Larger value per division: the trace gets smaller" aria-label="Increase V/div">
            +
          </button>
          <button type="button" className="text-btn" disabled={!hasWave} onClick={() => onAutoscale(id)} title={hasWave ? 'Fit what is on screen of this channel into its view' : 'No waveform (the expression has an error)'}>
            Autoscale
          </button>
        </div>
        <span title={POSITION_HINT}>Position</span>
        <div className="stepper">
          <button type="button" title="Move down" aria-label="Move down" onClick={() => onAdjust(id, { position: stepPosition(d.position, -POSITION_STEP) })}>
            −
          </button>
          <ValueField
            className="mono num"
            title={POSITION_HINT}
            aria-label="Position (div)"
            value={d.position}
            format={String}
            parse={(text) => parseValue(text, ['div'])}
            stepBy={(dir) => stepPosition(d.position, dir * POSITION_STEP)}
            onChange={(position) => onAdjust(id, { position })}
          />
          <button type="button" title="Move up" aria-label="Move up" onClick={() => onAdjust(id, { position: stepPosition(d.position, POSITION_STEP) })}>
            +
          </button>
          <span className="unit">div</span>
        </div>
        <span title={OFFSET_HINT}>Offset</span>
        <div className="stepper">
          <ValueField
            className="mono num wide"
            title={OFFSET_HINT}
            aria-label="Offset"
            value={d.offset}
            format={(v) => siTick(v, displayUnit(unit))}
            parse={(text) => parseValue(text, offsetUnits)}
            stepBy={(dir) => parseFloat((d.offset + (dir * d.scale) / 10).toPrecision(12))}
            onChange={(offset) => onAdjust(id, { offset })}
          />
        </div>
        <span title={VIEW_HINT}>View</span>
        <div className="view-chips" role="group" aria-label="View">
          {views.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`toggle-btn ${i === view ? 'active' : ''}`}
              aria-pressed={i === view}
              title={i === view ? `In view ${i + 1}` : `Move to view ${i + 1}`}
              onClick={() => i !== view && onMoveToView(id, i)}
              onPointerEnter={() => onPreviewView?.(i)}
              onPointerLeave={() => onPreviewView?.(undefined)}
            >
              {i + 1}
            </button>
          ))}
          <button
            type="button"
            className="toggle-btn"
            disabled={view >= 0 && views[view].length === 1}
            title={view >= 0 && views[view].length === 1 ? 'Already in a view of its own' : 'Move to a new view of its own'}
            onClick={() => onMoveToView(id, views.length)}
          >
            <Plus size={12} aria-hidden /> New
          </button>
        </div>
        <span>Spectrum</span>
        <div className="stepper">
          <button
            type="button"
            className={`toggle-btn ${hasSpectrum ? 'active' : ''}`}
            aria-pressed={hasSpectrum}
            disabled={!hasSpectrum && (!canAddSpectrum || !hasWave)}
            title={hasSpectrum ? 'Remove the spectrum of this channel' : 'Show the frequency spectrum (FFT) of this channel below the time views'}
            onClick={onToggleSpectrum}
          >
            <AudioLines size={14} aria-hidden /> {hasSpectrum ? 'Shown' : 'Show FFT'}
          </button>
        </div>
        {input && (
          <>
            <span>Input</span>
            <span
              className="input-summary"
              title={`As set on the scope when the session was saved:\n${inputItems(input)
                .map(({ label, value }) => `${label}: ${value}`)
                .join('\n')}`}
            >
              {inputSummary(input)}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

const SCALE_HINT = 'Value of one division. Type a value such as 500m or 2 V; ↑ ↓ step through 1-2-5 values'
const POSITION_HINT = 'Moves the trace up or down on the screen, in divisions; its tag on the left edge follows'
const VIEW_HINT = 'The stacked plot the channel is drawn in; the channels of a view share its grid and scale labels'
const OFFSET_HINT = 'The value that sits at the position line, as in the channel tag. Raising it moves the trace down'

interface ValueFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number
  /** The value as shown while the field is not being edited */
  format: (v: number) => string
  /** Typed text as a value; undefined when it is not one (the edit is dropped) */
  parse: (text: string) => number | undefined
  onChange: (v: number) => void
  /** The value a step up or down, for the arrow keys */
  stepBy: (dir: 1 | -1) => number
}

/**
 * A text field for a value with an SI prefix and unit ("500m", "2 V/div"). What is typed is applied
 * on Enter or when the field is left (one undo step); Escape drops it. A value changed elsewhere
 * meanwhile (stepper, wheel) is shown as soon as the field is not being edited.
 */
function ValueField({ value, format, parse, onChange, stepBy, ...rest }: ValueFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    const v = draft === null ? undefined : parse(draft)
    if (v !== undefined && v !== value) onChange(v)
    setDraft(null)
  }
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      spellCheck={false}
      autoComplete="off"
      value={draft ?? format(value)}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape' && draft !== null) {
          e.stopPropagation()
          setDraft(null)
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          setDraft(null)
          onChange(stepBy(e.key === 'ArrowUp' ? 1 : -1))
        }
      }}
    />
  )
}
