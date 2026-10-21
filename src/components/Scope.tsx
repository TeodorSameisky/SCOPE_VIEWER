import { useCallback, useMemo, useRef, useState } from 'react'
import type { ChannelDisplay, Session } from '../model/types'
import type { MeasurementKey } from '../dsp/measure'
import { MinMaxPyramid } from '../dsp/minmax'
import { buildCsv } from '../export/csv'
import { downloadBlob, stem } from '../util/download'
import { si } from '../util/format'
import { ChannelPanel } from './ChannelPanel'
import { CursorPanel } from './CursorPanel'
import { InfoPanel } from './InfoPanel'
import { MeasurementTable } from './MeasurementTable'
import { PlotArea, type PlotAreaHandle } from './PlotArea'
import { timeTicks, type CursorState, type DisplayPatch, type LiveChannel, type MeasureRange, type TimeWindow } from './state'

/** Map Tektronix measurement types from the setup to our measurement keys */
const TEK_MEAS: Record<string, MeasurementKey> = {
  MAXIMUM: 'max',
  MINIMUM: 'min',
  PK2PK: 'pkpk',
  MEAN: 'mean',
  RMS: 'rms',
  TOP: 'top',
  BASE: 'base',
  AMPLITUDE: 'amplitude',
  FREQUENCY: 'frequency',
  PERIOD: 'period',
  RISETIME: 'riseTime',
  FALLTIME: 'fallTime',
  PWIDTH: 'posWidth',
  PDUTY: 'duty',
}
const DEFAULT_MEAS: MeasurementKey[] = ['max', 'min', 'pkpk', 'mean', 'rms', 'frequency', 'riseTime', 'fallTime']

type Tab = 'channels' | 'cursors' | 'info'

interface Props {
  session: Session
  onOpen: () => void
  onClose: () => void
}

export function Scope({ session, onOpen, onClose }: Props) {
  const pyramids = useMemo(() => new Map(session.channels.map((c) => [c.wave.id, new MinMaxPyramid(c.wave.data)])), [session])
  const [displays, setDisplays] = useState<ChannelDisplay[]>(() => session.channels.map((c) => ({ ...c.display })))
  const [views, setViews] = useState<string[][]>(() => session.views.map((v) => [...v]))

  const record = useMemo<TimeWindow>(() => {
    let start = Infinity
    let end = -Infinity
    for (const { wave } of session.channels) {
      start = Math.min(start, wave.t0)
      end = Math.max(end, wave.t0 + (wave.data.length - 1) * wave.dt)
    }
    return { start, end }
  }, [session])
  const minDt = Math.min(...session.channels.map((c) => c.wave.dt))

  const initialWin = useMemo<TimeWindow>(() => {
    const h = session.horizontal
    if (h) {
      const span = h.scale * 10
      const start = (-h.position / 100) * span
      // Only trust the saved view if it overlaps the record
      if (start < record.end && start + span > record.start) return { start, end: start + span }
    }
    return record
  }, [session, record])
  const [win, setWin] = useState<TimeWindow>(initialWin)

  const [cursors, setCursors] = useState<CursorState>(() => {
    const c = session.cursors
    const s = initialWin.end - initialWin.start
    return {
      on: !!c,
      a: c?.a ?? initialWin.start + s * 0.3,
      b: c?.b ?? initialWin.start + s * 0.7,
      source: c?.source && session.channels.some((ch) => ch.wave.id === c.source) ? c.source : session.channels[0].wave.id,
    }
  })
  const [selected, setSelected] = useState<string | undefined>(session.trigger?.source ?? session.channels[0]?.wave.id)
  const [tab, setTab] = useState<Tab>('channels')
  const [measRange, setMeasRange] = useState<MeasureRange>('screen')
  const [measKeys, setMeasKeys] = useState<MeasurementKey[]>(() => {
    const fromSetup = (session.measurements ?? []).map((m) => TEK_MEAS[m.type]).filter(Boolean)
    return [...new Set([...fromSetup, ...DEFAULT_MEAS])]
  })
  const plotRef = useRef<PlotAreaHandle>(null)

  const channels: LiveChannel[] = useMemo(
    () => session.channels.map((c, i) => ({ wave: c.wave, display: displays[i], pyramid: pyramids.get(c.wave.id)! })),
    [session, displays, pyramids],
  )

  const onAdjust = useCallback((id: string, patch: DisplayPatch) => {
    setDisplays((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }, [])

  const onMoveToView = (id: string, view: number) => {
    setViews((vs) => {
      const next = vs.map((v) => v.filter((x) => x !== id))
      if (view >= next.length) next.push([id])
      else next[view].push(id)
      return next.filter((v) => v.length > 0)
    })
  }

  const onAutoscale = (id: string) => {
    const c = channels.find((ch) => ch.wave.id === id)
    if (!c) return
    const mm: [number, number] = [0, 0]
    c.pyramid.range(0, c.wave.data.length, mm)
    const spanV = Math.max(mm[1] - mm[0], 1e-9)
    const raw = spanV / 8
    const exp = Math.pow(10, Math.floor(Math.log10(raw)))
    const scale = [1, 2, 5, 10].map((m) => m * exp).find((s) => s >= raw) ?? 10 * exp
    // Round the offset to a tenth of a division so it reads nicely
    const offset = Math.round((mm[0] + mm[1]) / 2 / (scale / 10)) * (scale / 10)
    onAdjust(id, { scale, offset: parseFloat(offset.toPrecision(6)), position: 0 })
  }

  const exportCsv = () => {
    const vis = channels.filter((c) => c.display.visible)
    if (!vis.length) return
    const ref = vis[0].wave
    const n = Math.round((Math.min(win.end, record.end) - Math.max(win.start, record.start)) / ref.dt)
    if (n > 5_000_000 && !confirm(`The visible range has ${n.toLocaleString()} samples per channel. Export anyway?`)) return
    downloadBlob(buildCsv(vis, win.start, win.end), `${stem(session.fileName)}.csv`)
  }

  const exportPng = async () => {
    const blob = await plotRef.current?.toPng()
    if (blob) downloadBlob(blob, `${stem(session.fileName)}.png`)
  }

  const ticks = timeTicks(win)
  const tPerDiv = ticks.length > 1 ? ticks[1] - ticks[0] : (win.end - win.start) / 10
  const zoomed = win.start > record.start + minDt || win.end < record.end - minDt

  return (
    <div className="scope">
      <header className="toolbar">
        <div className="brand">
          <span className="logo">◢</span> Scope Viewer
        </div>
        <button onClick={onOpen}>Open…</button>
        <span className="file-name" title={session.fileName}>
          {session.fileName}
        </span>
        <div className="spacer" />
        <button onClick={() => setWin(initialWin)} title="Back to the view saved in the session">
          Saved view
        </button>
        <button onClick={() => setWin(record)} disabled={!zoomed} title="Show the whole record (double-click plot)">
          Full record
        </button>
        <button className={cursors.on ? 'active' : ''} onClick={() => setCursors({ ...cursors, on: !cursors.on })}>
          Cursors
        </button>
        <button onClick={exportCsv}>Export CSV</button>
        <button onClick={exportPng}>Export PNG</button>
        <button className="ghost" onClick={onClose} title="Close session">
          ✕
        </button>
      </header>

      <div className="workspace">
        <main className="main">
          <PlotArea
            ref={plotRef}
            channels={channels}
            views={views}
            win={win}
            setWin={setWin}
            record={record}
            minSpan={minDt * 10}
            cursors={cursors}
            setCursors={setCursors}
            selected={selected}
            setSelected={setSelected}
            trigger={session.trigger}
            onAdjust={onAdjust}
          />
          <MeasurementTable
            channels={channels}
            win={win}
            cursors={cursors}
            range={measRange}
            setRange={setMeasRange}
            keys={measKeys}
            setKeys={setMeasKeys}
          />
        </main>

        <aside className="sidebar">
          <nav className="tabs">
            {(['channels', 'cursors', 'info'] as const).map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </nav>
          {tab === 'channels' && (
            <ChannelPanel
              channels={channels}
              views={views}
              selected={selected}
              setSelected={setSelected}
              onAdjust={onAdjust}
              onMoveToView={onMoveToView}
              onAutoscale={onAutoscale}
            />
          )}
          {tab === 'cursors' && <CursorPanel channels={channels} cursors={cursors} setCursors={setCursors} win={win} />}
          {tab === 'info' && <InfoPanel session={session} />}
        </aside>
      </div>

      <footer className="statusbar mono">
        <span>
          <b>Horizontal</b> {si(tPerDiv, 's/div', 3)}
        </span>
        <span>
          <b>Window</b> {si(win.start, 's')} … {si(win.end, 's')}
        </span>
        <span>
          <b>SR</b> {si(1 / minDt, 'S/s', 3)}
        </span>
        <span>
          <b>RL</b> {session.channels[0].wave.data.length.toLocaleString()} pts
        </span>
        {session.trigger && (
          <span>
            <b>Trigger</b> {session.trigger.source} {session.trigger.slope === 'FALL' ? '↘' : '↗'}{' '}
            {session.trigger.level !== undefined && si(session.trigger.level, 'V', 3)}
          </span>
        )}
        <span className="spacer" />
        <span className="muted">Wheel: zoom · Drag: pan · Shift+drag: box zoom · Double-click: full record</span>
      </footer>
    </div>
  )
}
