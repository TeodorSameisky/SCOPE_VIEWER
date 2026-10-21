import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ChannelDisplay, Session } from '../model/types'
import type { MeasurementKey } from '../dsp/measure'
import {
  DEFAULT_CALLOUT_COLOR,
  calloutsToJson,
  loadCallouts,
  newCalloutId,
  nextCalloutNumber,
  parseCalloutJson,
  saveCallouts,
  type Callout,
} from '../model/callouts'
import { MinMaxPyramid } from '../dsp/minmax'
import { evaluateMath } from '../math/expr'
import { MATH_COLORS, MAX_MATH, loadMath, nextMathId, saveMath, type MathDef } from '../model/math'
import { MAX_SPECTRA, loadSpectra, newSpectrum, saveSpectra, type SpectrumDef, type SpectrumOptions } from '../model/spectrum'
import { buildCsv } from '../export/csv'
import { downloadBlob, stem } from '../util/download'
import { usePersistentState } from '../util/usePersistentState'
import { CalloutPanel } from './CalloutPanel'
import { ChannelBar, type MathItem } from './ChannelBar'
import { CursorPanel } from './CursorPanel'
import { InfoPanel } from './InfoPanel'
import { MeasurementTable } from './MeasurementTable'
import { Overview } from './Overview'
import { PlotArea, type NewCallout, type PlotAreaHandle } from './PlotArea'
import { ReferencePanel, type ReferenceSection } from './ReferencePanel'
import { Rail, type PanelId } from './Rail'
import { SpectrumView } from './SpectrumView'
import { TopBar } from './TopBar'
import {
  timeTicks,
  zoomAround,
  type CursorState,
  type DisplayPatch,
  type LiveChannel,
  type MeasureRange,
  type NavKind,
  type TimeWindow,
  type Tool,
} from './state'

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

/** Window + vertical settings, restored by "zoom back" */
interface ViewState {
  win: TimeWindow
  vertical: Record<string, { scale: number; position: number; offset: number }>
}

/** Shown in the plot while a tool other than Pan is active */
const TOOL_HINT: Partial<Record<Tool, string>> = {
  zoom: 'Drag a rectangle to zoom time + vertical · Shift+drag: time only · Click: zoom in · Alt+click: out · Esc: done',
  note: 'Click on a trace to attach a note · Esc: cancel',
  marker: 'Click to place a marker · Esc: cancel',
  region: 'Drag to mark a time region · Esc: cancel',
}

const PANEL_TITLE: Record<PanelId, string> = { cursors: 'Cursors', callouts: 'Callouts', info: 'Session', reference: 'Reference' }

interface Layout {
  panel: PanelId | null
  overview: boolean
  measurements: boolean
  measHeight: number
  specHeight: number
}
const DEFAULT_LAYOUT: Layout = { panel: null, overview: true, measurements: true, measHeight: 170, specHeight: 220 }

interface Props {
  session: Session
  onOpen: () => void
  onClose: () => void
}

export function Scope({ session, onOpen, onClose }: Props) {
  const pyramids = useMemo(() => new Map(session.channels.map((c) => [c.wave.id, new MinMaxPyramid(c.wave.data)])), [session])
  // Math channels saved for this session file (only read once, when the session opens)
  const [storedMath] = useState(() => loadMath(session.fingerprint))
  const [mathDefs, setMathDefs] = useState<MathDef[]>(() => storedMath.map((m) => m.def))
  const [displays, setDisplays] = useState<ChannelDisplay[]>(() => [
    ...session.channels.map((c) => ({ ...c.display })),
    ...storedMath.map((m) => ({ ...m.display, id: m.def.id })),
  ])
  const [views, setViews] = useState<string[][]>(() => {
    const vs = session.views.map((v) => [...v])
    for (const m of storedMath) {
      if (m.view >= 0 && m.view < vs.length) vs[m.view].push(m.def.id)
      else vs.push([m.def.id])
    }
    return vs
  })

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
  const [tool, setTool] = useState<Tool>('pan')
  const [history, setHistory] = useState<ViewState[]>([])
  const lastNav = useRef<{ kind: NavKind | null; time: number }>({ kind: null, time: 0 })

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
  const [layout, setLayout] = usePersistentState<Layout>('scope-viewer:layout', DEFAULT_LAYOUT)
  const setPanel = (panel: PanelId | null) => setLayout((l) => ({ ...l, panel }))
  const toggleOverview = () => setLayout((l) => ({ ...l, overview: !l.overview }))
  const toggleMeasurements = () => setLayout((l) => ({ ...l, measurements: !l.measurements }))
  // Focus mode hides every panel and remembers what was open
  const beforeFocus = useRef<Layout | null>(null)
  const focusMode = !layout.panel && !layout.overview && !layout.measurements
  const toggleFocus = () => {
    if (focusMode) {
      const prev = beforeFocus.current ?? DEFAULT_LAYOUT
      setLayout((l) => ({ ...l, panel: prev.panel, overview: prev.overview, measurements: prev.measurements }))
    } else {
      beforeFocus.current = layout
      setLayout((l) => ({ ...l, panel: null, overview: false, measurements: false }))
    }
  }
  const [measRange, setMeasRange] = useState<MeasureRange>('screen')
  const [measKeys, setMeasKeys] = useState<MeasurementKey[]>(() => {
    const fromSetup = (session.measurements ?? []).map((m) => TEK_MEAS[m.type]).filter(Boolean)
    return [...new Set([...fromSetup, ...DEFAULT_MEAS])]
  })
  const plotRef = useRef<PlotAreaHandle>(null)

  // ---------- math channels ----------
  const mathResults = useMemo(() => evaluateMath(mathDefs, session.channels.map((c) => c.wave)), [mathDefs, session])
  const mathPyramids = useMemo(() => {
    const m = new Map<string, MinMaxPyramid>()
    for (const [id, r] of mathResults) if (r.wave) m.set(id, new MinMaxPyramid(r.wave.data))
    return m
  }, [mathResults])

  const displayById = useMemo(() => new Map(displays.map((d) => [d.id, d])), [displays])
  const inputChannels: LiveChannel[] = useMemo(
    () => session.channels.map((c) => ({ wave: c.wave, display: displayById.get(c.wave.id)!, pyramid: pyramids.get(c.wave.id)! })),
    [session, displayById, pyramids],
  )
  const mathItems: MathItem[] = useMemo(
    () => mathDefs.flatMap((def) => (displayById.has(def.id) ? [{ def, display: displayById.get(def.id)!, result: mathResults.get(def.id) }] : [])),
    [mathDefs, displayById, mathResults],
  )
  /** Everything that has a waveform: inputs plus successfully computed math channels */
  const channels: LiveChannel[] = useMemo(
    () => [
      ...inputChannels,
      ...mathItems.flatMap((m) => (m.result?.wave ? [{ wave: m.result.wave, display: m.display, pyramid: mathPyramids.get(m.def.id)! }] : [])),
    ],
    [inputChannels, mathItems, mathPyramids],
  )

  const onAdjust = useCallback((id: string, patch: DisplayPatch) => {
    setDisplays((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }, [])

  // ---------- navigation with zoom history ----------
  const minSpan = minDt * 10
  const maxSpan = (record.end - record.start) * 4
  const pushHistory = () => {
    const vertical = Object.fromEntries(displays.map((d) => [d.id, { scale: d.scale, position: d.position, offset: d.offset }]))
    setHistory((h) => [...h.slice(-49), { win, vertical }])
  }
  /** Continuous changes of the same kind within 800 ms count as one history step */
  const navigate = (w: TimeWindow, kind: NavKind) => {
    const now = performance.now()
    const last = lastNav.current
    if (kind === 'zoom' || last.kind !== kind || now - last.time > 800) pushHistory()
    lastNav.current = { kind, time: now }
    setWin(w)
  }
  const zoomTo = (w: TimeWindow, patches?: { id: string; patch: DisplayPatch }[]) => {
    navigate(w, 'zoom')
    if (patches?.length) {
      const byId = new Map(patches.map((x) => [x.id, x.patch]))
      setDisplays((ds) => ds.map((d) => (byId.has(d.id) ? { ...d, ...byId.get(d.id) } : d)))
    }
  }
  const zoomBack = () => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory(history.slice(0, -1))
    setWin(prev.win)
    setDisplays((ds) => ds.map((d) => (prev.vertical[d.id] ? { ...d, ...prev.vertical[d.id] } : d)))
    lastNav.current = { kind: null, time: 0 }
  }

  // ---------- callouts ----------
  const [callouts, setCallouts] = useState<Callout[]>(() => loadCallouts(session.fingerprint))
  const [selectedCallout, setSelectedCallout] = useState<string | undefined>()
  const [editing, setEditing] = useState<{ id: string; isNew: boolean } | null>(null)
  useEffect(() => saveCallouts(session.fingerprint, callouts), [callouts, session.fingerprint])

  const addCallout = (nc: NewCallout) => {
    const ch = nc.channel ? displays.find((d) => d.id === nc.channel) : undefined
    const c: Callout = {
      id: newCalloutId(),
      n: nextCalloutNumber(callouts),
      text: '',
      color: ch?.color ?? DEFAULT_CALLOUT_COLOR[nc.type],
      ...nc,
      ...(nc.type === 'note' ? { dx: 24, dy: nc.dy ?? -46 } : {}),
    }
    setCallouts([...callouts, c])
    setSelectedCallout(c.id)
    setEditing({ id: c.id, isNew: true })
    setTool('pan')
  }
  const updateCallout = useCallback((id: string, patch: Partial<Callout>) => {
    setCallouts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])
  const deleteCallout = (id: string) => {
    setCallouts((cs) => cs.filter((c) => c.id !== id))
    if (editing?.id === id) setEditing(null)
    if (selectedCallout === id) setSelectedCallout(undefined)
  }
  const editCallout = (id: string | null) => {
    if (id) {
      setEditing({ id, isNew: false })
      setSelectedCallout(id)
      return
    }
    // Finishing the editor: a new note without text is discarded
    const c = editing && callouts.find((x) => x.id === editing.id)
    if (editing?.isNew && c?.type === 'note' && !c.text.trim()) deleteCallout(c.id)
    setEditing(null)
  }
  const jumpToCallout = (c: Callout) => {
    const span = win.end - win.start
    if (c.type === 'region' && c.t2 !== undefined) {
      const a = Math.min(c.t, c.t2)
      const b = Math.max(c.t, c.t2)
      const pad = Math.max((b - a) * 0.15, minSpan)
      zoomTo({ start: a - pad, end: b + pad })
    } else {
      zoomTo({ start: c.t - span / 2, end: c.t + span / 2 })
    }
    setSelectedCallout(c.id)
  }
  const exportCallouts = () => {
    const json = calloutsToJson(session.fileName, session.fingerprint, callouts)
    downloadBlob(new Blob([json], { type: 'application/json' }), `${stem(session.fileName)}.callouts.json`)
  }
  const importCallouts = async (file: File) => {
    try {
      const { callouts: imported, otherFile } = parseCalloutJson(await file.text(), session.fingerprint)
      if (otherFile && !confirm('These callouts were saved for a different session file. Import them anyway?')) return
      const ids = new Set(imported.map((c) => c.id))
      setCallouts((cs) => [...cs.filter((c) => !ids.has(c.id)), ...imported])
      setPanel('callouts')
    } catch (e) {
      alert(`Could not import callouts: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ---------- keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (e.ctrlKey || e.metaKey) return
      const span = win.end - win.start
      const mid = (win.start + win.end) / 2
      if (e.key === 'Escape') {
        setTool('pan')
        setSelectedCallout(undefined)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCallout) {
        deleteCallout(selectedCallout)
      } else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) {
        zoomBack()
      } else if (e.altKey) {
        return
      } else if (e.key === 'Enter' && selectedCallout) {
        editCallout(selectedCallout)
      } else {
        const actions: Record<string, () => void> = {
          p: () => setTool('pan'),
          z: () => setTool('zoom'),
          n: () => setTool('note'),
          m: () => setTool('marker'),
          r: () => setTool('region'),
          f: () => zoomTo(record),
          c: () => setCursors({ ...cursors, on: !cursors.on }),
          o: toggleOverview,
          t: toggleMeasurements,
          '\\': toggleFocus,
          '+': () => zoomTo(zoomAround(win, mid, 0.5, minSpan, maxSpan)),
          '=': () => zoomTo(zoomAround(win, mid, 0.5, minSpan, maxSpan)),
          '-': () => zoomTo(zoomAround(win, mid, 2, minSpan, maxSpan)),
          arrowleft: () => navigate({ start: win.start - span * 0.1, end: win.end - span * 0.1 }, 'pan'),
          arrowright: () => navigate({ start: win.start + span * 0.1, end: win.end + span * 0.1 }, 'pan'),
        }
        const action = actions[e.key.toLowerCase()]
        if (!action) return
        action()
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
    if (c) onAdjust(id, autoscalePatch(c.pyramid, c.wave.data.length))
  }

  // New or changed math channels are scaled to fit once their result is available
  const pendingAutoscale = useRef(new Set<string>())
  useEffect(() => {
    for (const id of [...pendingAutoscale.current]) {
      const r = mathResults.get(id)
      const pyr = mathPyramids.get(id)
      if (r?.wave && pyr) onAdjust(id, autoscalePatch(pyr, r.wave.data.length))
      if (r) pendingAutoscale.current.delete(id)
    }
  }, [mathResults, mathPyramids, onAdjust])

  const addMath = (): string | undefined => {
    if (mathDefs.length >= MAX_MATH) return
    const id = nextMathId(mathDefs)
    const vis = session.channels.filter((c) => displayById.get(c.wave.id)?.visible).map((c) => c.wave.id)
    const a = vis[0] ?? session.channels[0].wave.id
    const b = vis.find((x) => x !== a)
    setMathDefs([...mathDefs, { id, expr: b ? `${a} - ${b}` : `-${a}` }])
    const color = MATH_COLORS[(parseInt(id.slice(4), 10) - 1) % MATH_COLORS.length]
    setDisplays((ds) => [...ds, { id, label: '', color, visible: true, scale: 1, position: 0, offset: 0 }])
    setViews((vs) => [...vs, [id]])
    setSelected(id)
    pendingAutoscale.current.add(id)
    return id
  }
  const changeMath = (id: string, patch: Partial<MathDef>) => {
    setMathDefs((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)))
    if (patch.expr !== undefined) pendingAutoscale.current.add(id)
  }
  const removeMath = (id: string) => {
    setMathDefs((ms) => ms.filter((m) => m.id !== id))
    setDisplays((ds) => ds.filter((d) => d.id !== id))
    setViews((vs) => vs.map((v) => v.filter((x) => x !== id)).filter((v) => v.length > 0))
    setSpectra((ss) => ss.filter((s) => s.source !== id))
    if (selected === id) setSelected(session.channels[0].wave.id)
    if (cursors.source === id) setCursors({ ...cursors, source: session.channels[0].wave.id })
  }
  useEffect(() => {
    saveMath(
      session.fingerprint,
      mathDefs.flatMap((def) => {
        const d = displayById.get(def.id)
        if (!d) return []
        const { id: _id, ...display } = d
        void _id
        return [{ def, display, view: views.findIndex((v) => v.includes(def.id)) }]
      }),
    )
  }, [mathDefs, displayById, views, session.fingerprint])

  // ---------- spectra ----------
  const [storedSpectra] = useState(() => loadSpectra(session.fingerprint))
  const [spectra, setSpectra] = useState<SpectrumDef[]>(() => storedSpectra.defs.filter((d) => displays.some((x) => x.id === d.source)))
  const [specOptions, setSpecOptions] = useState<SpectrumOptions>(storedSpectra.options)
  useEffect(() => saveSpectra(session.fingerprint, { defs: spectra, options: specOptions }), [spectra, specOptions, session.fingerprint])
  const spectrumSources = useMemo(() => new Set(spectra.map((s) => s.source)), [spectra])

  const addSpectrum = (source?: string) => {
    if (spectra.length >= MAX_SPECTRA) return
    const src = source ?? (selected && channels.some((c) => c.wave.id === selected) ? selected : session.channels[0].wave.id)
    setSpectra([...spectra, newSpectrum(spectra, src)])
  }
  /** Channel popover: show the spectrum of a channel, or remove it again */
  const toggleSpectrum = (source: string) => {
    if (spectrumSources.has(source)) setSpectra(spectra.filter((s) => s.source !== source))
    else addSpectrum(source)
  }
  const changeSpectrum = (id: string, patch: Partial<SpectrumDef>) => setSpectra((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  // ---------- reference panel ----------
  const [refSection, setRefSection] = useState<ReferenceSection>('measurements')
  const [refFocus, setRefFocus] = useState<MeasurementKey | undefined>()
  const openReference = (section: ReferenceSection, focus?: MeasurementKey) => {
    setRefSection(section)
    setRefFocus(focus)
    setPanel('reference')
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
      <TopBar
        fileName={session.fileName}
        onOpen={onOpen}
        onClose={onClose}
        tool={tool}
        setTool={setTool}
        canGoBack={history.length > 0}
        onBack={zoomBack}
        onSavedView={() => zoomTo(initialWin)}
        onFullRecord={() => zoomTo(record)}
        zoomed={zoomed}
        cursorsOn={cursors.on}
        onToggleCursors={() => setCursors({ ...cursors, on: !cursors.on })}
        onExportCsv={exportCsv}
        onExportPng={exportPng}
        onExportCallouts={exportCallouts}
        calloutCount={callouts.length}
      />

      <div className={`workspace ${layout.panel ? 'with-panel' : ''}`}>
        <main className="main">
          {layout.overview && <Overview channels={channels} views={views} record={record} win={win} minSpan={minSpan} onNavigate={navigate} />}
          <PlotArea
            ref={plotRef}
            channels={channels}
            views={views}
            win={win}
            record={record}
            minSpan={minSpan}
            tool={tool}
            hint={TOOL_HINT[tool]}
            onNavigate={navigate}
            onZoomTo={zoomTo}
            cursors={cursors}
            setCursors={setCursors}
            selected={selected}
            setSelected={setSelected}
            trigger={session.trigger}
            onAdjust={onAdjust}
            callouts={callouts}
            selectedCallout={selectedCallout}
            editingCallout={editing?.id}
            onSelectCallout={setSelectedCallout}
            onAddCallout={addCallout}
            onUpdateCallout={updateCallout}
            onEditCallout={editCallout}
            onDeleteCallout={deleteCallout}
          />
          {spectra.length > 0 && (
            <SpectrumView
              defs={spectra}
              options={specOptions}
              setOptions={(patch) => setSpecOptions((o) => ({ ...o, ...patch }))}
              channels={channels}
              win={win}
              cursors={cursors}
              height={layout.specHeight}
              setHeight={(specHeight) => setLayout((l) => ({ ...l, specHeight }))}
              onAdd={() => addSpectrum()}
              onChange={changeSpectrum}
              onRemove={(id) => setSpectra((ss) => ss.filter((s) => s.id !== id))}
              onClose={() => setSpectra([])}
              onOpenReference={() => openReference('spectrum')}
            />
          )}
          {layout.measurements && (
            <MeasurementTable
              channels={channels}
              win={win}
              cursors={cursors}
              range={measRange}
              setRange={setMeasRange}
              keys={measKeys}
              setKeys={setMeasKeys}
              height={layout.measHeight}
              setHeight={(measHeight) => setLayout((l) => ({ ...l, measHeight }))}
              onClose={toggleMeasurements}
              onOpenReference={(key) => openReference('measurements', key)}
            />
          )}
        </main>

        {layout.panel && (
          <aside className="sidebar" aria-label={PANEL_TITLE[layout.panel]}>
            <div className="sidebar-head">
              <h3>{PANEL_TITLE[layout.panel]}</h3>
              <button type="button" className="icon-btn" title="Close panel" aria-label="Close panel" onClick={() => setPanel(null)}>
                <X size={16} />
              </button>
            </div>
            {layout.panel === 'cursors' && <CursorPanel channels={channels} cursors={cursors} setCursors={setCursors} win={win} />}
            {layout.panel === 'callouts' && (
              <CalloutPanel
                callouts={callouts}
                channels={channels}
                selectedId={selectedCallout}
                tool={tool}
                setTool={setTool}
                onSelect={setSelectedCallout}
                onUpdate={updateCallout}
                onDelete={deleteCallout}
                onJump={jumpToCallout}
                onExport={exportCallouts}
                onImport={importCallouts}
                onClear={() => {
                  setCallouts([])
                  setEditing(null)
                  setSelectedCallout(undefined)
                }}
              />
            )}
            {layout.panel === 'info' && <InfoPanel session={session} />}
            {layout.panel === 'reference' && <ReferencePanel section={refSection} setSection={setRefSection} focus={refFocus} />}
          </aside>
        )}

        <Rail
          panel={layout.panel}
          setPanel={setPanel}
          overview={layout.overview}
          toggleOverview={toggleOverview}
          measurements={layout.measurements}
          toggleMeasurements={toggleMeasurements}
          focusMode={focusMode}
          toggleFocus={toggleFocus}
          calloutCount={callouts.length}
        />
      </div>

      <ChannelBar
        channels={inputChannels}
        math={mathItems}
        onAddMath={addMath}
        onChangeMath={changeMath}
        onRemoveMath={removeMath}
        onOpenMathReference={() => openReference('math')}
        spectrumSources={spectrumSources}
        canAddSpectrum={spectra.length < MAX_SPECTRA}
        onAddSpectrum={() => addSpectrum()}
        onToggleSpectrum={toggleSpectrum}
        views={views}
        selected={selected}
        setSelected={setSelected}
        onAdjust={onAdjust}
        onMoveToView={onMoveToView}
        onAutoscale={onAutoscale}
        win={win}
        timePerDiv={tPerDiv}
        sampleRate={1 / minDt}
        recordLength={session.channels[0].wave.data.length}
        trigger={session.trigger}
      />
    </div>
  )
}

/** V/div and offset that fit the whole waveform into ~8 divisions */
function autoscalePatch(pyramid: MinMaxPyramid, n: number): DisplayPatch {
  const mm: [number, number] = [0, 0]
  pyramid.range(0, n, mm)
  if (!Number.isFinite(mm[0]) || !Number.isFinite(mm[1])) return {}
  const spanV = Math.max(mm[1] - mm[0], Math.abs(mm[0]) * 1e-3, 1e-12)
  const raw = spanV / 8
  const exp = Math.pow(10, Math.floor(Math.log10(raw)))
  const scale = [1, 2, 5, 10].map((m) => m * exp).find((s) => s >= raw) ?? 10 * exp
  // Round the offset to a tenth of a division so it reads nicely
  const offset = Math.round((mm[0] + mm[1]) / 2 / (scale / 10)) * (scale / 10)
  return { scale: parseFloat(scale.toPrecision(6)), offset: parseFloat(offset.toPrecision(6)), position: 0 }
}
