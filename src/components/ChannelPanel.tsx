import { si } from '../util/format'
import { stepScale, type DisplayPatch, type LiveChannel } from './state'

interface Props {
  channels: LiveChannel[]
  views: string[][]
  selected?: string
  setSelected: (id: string) => void
  onAdjust: (id: string, patch: DisplayPatch) => void
  onMoveToView: (id: string, view: number) => void
  onAutoscale: (id: string) => void
}

export function ChannelPanel(p: Props) {
  const viewOf = (id: string) => p.views.findIndex((v) => v.includes(id))
  return (
    <div className="panel-body">
      {p.channels.map(({ wave, display: d }) => (
        <div
          key={wave.id}
          className={`channel-card ${p.selected === wave.id ? 'selected' : ''} ${d.visible ? '' : 'hidden'}`}
          style={{ ['--ch' as string]: d.color }}
          onClick={() => p.setSelected(wave.id)}
        >
          <div className="channel-head">
            <label className="toggle" title="Show / hide" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={d.visible} onChange={(e) => p.onAdjust(wave.id, { visible: e.target.checked })} />
              <span className="chip">{wave.id.replace(/^CH/, 'Ch ')}</span>
            </label>
            <input
              className="label-input"
              value={d.label}
              placeholder="label"
              onChange={(e) => p.onAdjust(wave.id, { label: e.target.value })}
            />
            <input
              type="color"
              value={d.color}
              title="Trace colour"
              onChange={(e) => p.onAdjust(wave.id, { color: e.target.value })}
            />
          </div>
          <div className="channel-grid">
            <span>Scale</span>
            <div className="stepper">
              <button onClick={() => p.onAdjust(wave.id, { scale: stepScale(d.scale, -1) })} title="Decrease V/div">−</button>
              <span className="mono">{si(d.scale, `${wave.yUnit}/div`, 3)}</span>
              <button onClick={() => p.onAdjust(wave.id, { scale: stepScale(d.scale, 1) })} title="Increase V/div">+</button>
            </div>
            <span>Position</span>
            <div className="stepper">
              <button onClick={() => p.onAdjust(wave.id, { position: round(d.position - 0.2) })}>−</button>
              <input
                className="mono num"
                type="number"
                step={0.1}
                value={d.position}
                onChange={(e) => p.onAdjust(wave.id, { position: Number(e.target.value) || 0 })}
              />
              <button onClick={() => p.onAdjust(wave.id, { position: round(d.position + 0.2) })}>+</button>
            </div>
            <span>Offset</span>
            <div className="stepper">
              <input
                className="mono num wide"
                type="number"
                step={d.scale / 10}
                value={d.offset}
                onChange={(e) => p.onAdjust(wave.id, { offset: Number(e.target.value) || 0 })}
              />
              <span className="unit">{wave.yUnit}</span>
            </div>
            <span>View</span>
            <div className="stepper">
              <select value={viewOf(wave.id)} onChange={(e) => p.onMoveToView(wave.id, Number(e.target.value))}>
                {p.views.map((_, i) => (
                  <option key={i} value={i}>
                    View {i + 1}
                  </option>
                ))}
                <option value={p.views.length}>New view</option>
              </select>
              <button className="text-btn" onClick={() => p.onAutoscale(wave.id)} title="Fit this channel into its view">
                Autoscale
              </button>
            </div>
          </div>
        </div>
      ))}
      <p className="hint">
        Click a trace to select it. Ctrl+wheel changes V/div, Alt+wheel moves the position of the selected channel.
      </p>
    </div>
  )
}

const round = (v: number) => Math.round(v * 100) / 100
