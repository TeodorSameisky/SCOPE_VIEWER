import { Eye, EyeOff } from 'lucide-react'
import { si } from '../util/format'
import { stepScale, type DisplayPatch, type LiveChannel } from './state'

interface Props {
  channel: LiveChannel
  views: string[][]
  onAdjust: (id: string, patch: DisplayPatch) => void
  onMoveToView: (id: string, view: number) => void
  onAutoscale: (id: string) => void
}

const round = (v: number) => Math.round(v * 100) / 100

/** Vertical settings of one channel (shown in the channel badge popover). */
export function ChannelSettings({ channel: { wave, display: d }, views, onAdjust, onMoveToView, onAutoscale }: Props) {
  const id = wave.id
  const view = views.findIndex((v) => v.includes(id))
  return (
    <div className="channel-settings" style={{ ['--ch' as string]: d.color }}>
      <div className="channel-head">
        <span className="chip">{id.replace(/^CH/, 'Ch ')}</span>
        <input className="label-input" value={d.label} placeholder="Label" aria-label="Label" onChange={(e) => onAdjust(id, { label: e.target.value })} />
        <input type="color" value={d.color} title="Trace colour" aria-label="Trace colour" onChange={(e) => onAdjust(id, { color: e.target.value })} />
        <button type="button" className="icon-btn" title={d.visible ? 'Hide' : 'Show'} aria-label={d.visible ? 'Hide' : 'Show'} onClick={() => onAdjust(id, { visible: !d.visible })}>
          {d.visible ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </div>
      <div className="channel-grid">
        <span>Scale</span>
        <div className="stepper">
          <button type="button" onClick={() => onAdjust(id, { scale: stepScale(d.scale, -1) })} title="Decrease V/div">
            −
          </button>
          <span className="mono">{si(d.scale, `${wave.yUnit}/div`, 3)}</span>
          <button type="button" onClick={() => onAdjust(id, { scale: stepScale(d.scale, 1) })} title="Increase V/div">
            +
          </button>
        </div>
        <span>Position</span>
        <div className="stepper">
          <button type="button" onClick={() => onAdjust(id, { position: round(d.position - 0.2) })}>
            −
          </button>
          <input className="mono num" type="number" step={0.1} value={d.position} aria-label="Position (div)" onChange={(e) => onAdjust(id, { position: Number(e.target.value) || 0 })} />
          <button type="button" onClick={() => onAdjust(id, { position: round(d.position + 0.2) })}>
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
          <span className="unit">{wave.yUnit}</span>
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
          <button type="button" className="text-btn" onClick={() => onAutoscale(id)} title="Fit this channel into its view">
            Autoscale
          </button>
        </div>
      </div>
    </div>
  )
}
