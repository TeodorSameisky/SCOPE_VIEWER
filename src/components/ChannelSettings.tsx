import { AudioLines, Eye, EyeOff } from 'lucide-react'
import type { ChannelDisplay } from '../model/types'
import { channelName, perDiv } from '../util/names'
import { POSITION_STEP, stepPosition, stepScale, type DisplayPatch } from '../model/view'
import { chipStyle, useTheme } from './ui/themeContext'

interface Props {
  display: ChannelDisplay
  /** Vertical unit of the channel */
  unit: string
  /** It has a waveform (not a math channel whose expression failed): autoscale and FFT need one */
  hasWave: boolean
  views: string[][]
  onAdjust: (id: string, patch: DisplayPatch) => void
  onMoveToView: (id: string, view: number) => void
  onAutoscale: (id: string) => void
  hasSpectrum: boolean
  canAddSpectrum: boolean
  onToggleSpectrum: () => void
  /** Extra content between the header and the vertical settings (math expression) */
  children?: React.ReactNode
}

/** Vertical settings of one channel (shown in the channel badge popover). */
export function ChannelSettings({ display: d, unit, hasWave, views, onAdjust, onMoveToView, onAutoscale, hasSpectrum, canAddSpectrum, onToggleSpectrum, children }: Props) {
  const id = d.id
  const view = views.findIndex((v) => v.includes(id))
  const { ink, onInk } = useTheme().theme
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
        <span>Scale</span>
        <div className="stepper">
          <button type="button" onClick={() => onAdjust(id, { scale: stepScale(d.scale, -1) })} title="Decrease V/div" aria-label="Decrease V/div">
            −
          </button>
          <span className="mono">{perDiv(d.scale, unit)}</span>
          <button type="button" onClick={() => onAdjust(id, { scale: stepScale(d.scale, 1) })} title="Increase V/div" aria-label="Increase V/div">
            +
          </button>
        </div>
        <span>Position</span>
        <div className="stepper">
          <button type="button" title="Move down" aria-label="Move down" onClick={() => onAdjust(id, { position: stepPosition(d.position, -POSITION_STEP) })}>
            −
          </button>
          <input className="mono num" type="number" step={POSITION_STEP} value={d.position} aria-label="Position (div)" onChange={(e) => onAdjust(id, { position: Number(e.target.value) || 0 })} />
          <button type="button" title="Move up" aria-label="Move up" onClick={() => onAdjust(id, { position: stepPosition(d.position, POSITION_STEP) })}>
            +
          </button>
          <span className="unit">div</span>
        </div>
        <span>Offset</span>
        <div className="stepper">
          <input
            className="mono num wide"
            type="number"
            step={d.scale / 10}
            value={d.offset}
            aria-label="Offset"
            onChange={(e) => onAdjust(id, { offset: Number(e.target.value) || 0 })}
          />
          <span className="unit">{unit}</span>
        </div>
        <span>View</span>
        <div className="stepper">
          <select value={view} aria-label="View" onChange={(e) => onMoveToView(id, Number(e.target.value))}>
            {views.map((_, i) => (
              <option key={i} value={i}>
                View {i + 1}
              </option>
            ))}
            <option value={views.length}>New view</option>
          </select>
          <button type="button" className="text-btn" disabled={!hasWave} onClick={() => onAutoscale(id)} title={hasWave ? 'Fit this channel into its view' : 'No waveform (the expression has an error)'}>
            Autoscale
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
      </div>
    </div>
  )
}
