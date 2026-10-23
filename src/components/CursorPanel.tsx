import { valueAt } from '../render/draw'
import { parseTime, si } from '../util/format'
import { channelName } from '../util/names'
import type { CursorState, LiveChannel, TimeWindow } from '../model/view'

interface Props {
  channels: LiveChannel[]
  cursors: CursorState
  setCursors: (c: CursorState) => void
  win: TimeWindow
}

export function CursorPanel({ channels, cursors, setCursors, win }: Props) {
  const dt = cursors.b - cursors.a
  const center = () => {
    const s = win.end - win.start
    setCursors({ ...cursors, on: true, a: win.start + s * 0.3, b: win.start + s * 0.7 })
  }
  return (
    <div className="panel-body">
      <div className="row">
        <label className="switch">
          <input type="checkbox" checked={cursors.on} onChange={(e) => setCursors({ ...cursors, on: e.target.checked })} />
          Cursors
        </label>
        <button className="text-btn" onClick={center}>
          Bring to screen
        </button>
      </div>
      <div className="form-grid">
        <span>Source</span>
        <select value={cursors.source} onChange={(e) => setCursors({ ...cursors, source: e.target.value })}>
          {channels.map((c) => (
            <option key={c.wave.id} value={c.wave.id}>
              {channelName(c.wave.id)} {c.display.label}
            </option>
          ))}
        </select>
        <span>A</span>
        <TimeInput value={cursors.a} onChange={(a) => setCursors({ ...cursors, a })} />
        <span>B</span>
        <TimeInput value={cursors.b} onChange={(b) => setCursors({ ...cursors, b })} />
      </div>
      <div className="readout-grid">
        <span>Δt</span>
        <b className="mono">{si(dt, 's')}</b>
        <span>1/Δt</span>
        <b className="mono">{si(1 / Math.abs(dt), 'Hz')}</b>
      </div>
      <table className="data-table compact">
        <thead>
          <tr>
            <th></th>
            <th>@A</th>
            <th>@B</th>
            <th>Δv</th>
          </tr>
        </thead>
        <tbody>
          {channels
            .filter((c) => c.display.visible)
            .map((c) => {
              const a = valueAt(c.wave, cursors.a)
              const b = valueAt(c.wave, cursors.b)
              return (
                <tr key={c.wave.id}>
                  <td>
                    <span className="dot" style={{ background: c.display.color }} />
                    {channelName(c.wave.id)}
                  </td>
                  <td className="mono">{si(a, c.wave.yUnit)}</td>
                  <td className="mono">{si(b, c.wave.yUnit)}</td>
                  <td className="mono">{si(b - a, c.wave.yUnit)}</td>
                </tr>
              )
            })}
        </tbody>
      </table>
      <p className="hint">Drag the cursor lines in the plot. Values are interpolated between samples.</p>
    </div>
  )
}

/** Numeric input in seconds that shows engineering units; accepts e.g. "-5.5m" or "25u". */
function TimeInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      className="mono"
      key={value}
      defaultValue={si(value, 's', 6)}
      onBlur={(e) => {
        const v = parseTime(e.target.value)
        if (v !== undefined) onChange(v)
        else e.target.value = si(value, 's', 6)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}
