import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ChannelDisplay, Session } from '../model/types'
import type { MeasurementKey } from '../dsp/measure'
import { DEFAULT_CALLOUT_COLOR, calloutTitle, newCalloutId, nextCalloutNumber, type Callout } from '../model/callouts'
import { MinMaxPyramid } from '../dsp/minmax'
import { evaluateMath } from '../math/expr'
import { MATH_COLORS, MAX_MATH, nextMathId, type MathDef } from '../model/math'
import { MAX_SPECTRA, newSpectrum, type SpectrumDef, type SpectrumOptions } from '../model/spectrum'
import {
  ANALYSIS_EXT,
  BUNDLE_EXT,
  analysisToJson,
  defaultWorkspace,
  deleteStoredSession,
  loadWorkspace,
  parseAnalysisJson,
  recordWindow,
  sanitizeWorkspace,
  saveWorkspace,
  scopeWindow,
  type LoadSource,
  type Workspace,
} from '../model/workspace'
import { buildBundle } from '../export/bundle'
import { runExport, waveformRows, type ExportContext } from '../export/sessionExport'
import { downloadBlob, stem } from '../util/download'
import { channelName } from '../util/names'
import { usePersistentState } from '../util/usePersistentState'
import { CalloutPanel } from './CalloutPanel'
import { ChannelBar, type MathItem } from './ChannelBar'
import { CursorPanel } from './CursorPanel'
import { ExportDialog, type ExportKind } from './ExportDialog'
import { InfoPanel } from './InfoPanel'
import { MeasurementTable } from './MeasurementTable'
import { Overview } from './Overview'
import { PlotArea, type NewCallout, type PlotAreaHandle } from './PlotArea'
import { ReferencePanel, type ReferenceSection } from './ReferencePanel'
import { Rail, type PanelId } from './Rail'
import { SpectrumView, type SpectrumViewHandle } from './SpectrumView'
import { StorageSection } from './StorageSection'
import { TopBar, type SaveStatus } from './TopBar'
import {
  sampleRange,
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

/** The session file(s) as opened, kept for saving a bundle */
export interface SourceFile {
  name: string
  blob: Blob
}

/** Which workspace a session starts with */
export type InitialState =
  /** saved state from this browser (or the file defaults), optionally with callouts to add */
  | { kind: 'stored'; addCallouts?: Callout[] }
  /** the file defaults, discarding saved state */
  | { kind: 'defaults' }
  /** an analysis from a file */
  | { kind: 'analysis'; workspace: unknown }

export interface ScopeHandle {
  /** Apply an analysis file (or merge a callout file) into the open session */
  importAnalysisFile: (file: File) => Promise<void>
}

interface Props {
  session: Session
  sources: SourceFile[]
  initial: InitialState
  onOpen: () => void
  onClose: () => void
  /** Restart the session with another workspace */
  onReplaceWorkspace: (initial: InitialState) => void
}

function initWorkspace(session: Session, initial: InitialState): { workspace: Workspace; source: LoadSource | 'file' } {
  if (initial.kind === 'defaults') return { workspace: defaultWorkspace(session), source: 'default' }
  if (initial.kind === 'analysis') return { workspace: sanitizeWorkspace(initial.workspace, session), source: 'file' }
  const loaded = loadWorkspace(session)
  if (!initial.addCallouts?.length) return loaded
  const ids = new Set(initial.addCallouts.map((c) => c.id))
  return {
    workspace: { ...loaded.workspace, callouts: [...loaded.workspace.callouts.filter((c) => !ids.has(c.id)), ...initial.addCallouts] },
    source: 'file',
  }
}

export const Scope = forwardRef<ScopeHandle, Props>(function Scope({ session, sources, initial, onOpen, onClose, onReplaceWorkspace }, ref) {
  // Everything the user can change starts from the workspace (saved state, analysis file or file defaults)
  const [boot] = useState(() => initWorkspace(session, initial))
  const ws0 = boot.workspace

  const pyramids = useMemo(() => new Map(session.channels.map((c) => [c.wave.id, new MinMaxPyramid(c.wave.data)])), [session])
  const [mathDefs, setMathDefs] = useState<MathDef[]>(ws0.math)
  const [displays, setDisplays] = useState<ChannelDisplay[]>(ws0.channels)
  const [views, setViews] = useState<string[][]>(ws0.views)

  const record = useMemo<TimeWindow>(() => recordWindow(session), [session])
  const minDt = Math.min(...session.channels.map((c) => c.wave.dt))
  /** The view the scope showed when the session was saved */
  const initialWin = useMemo<TimeWindow>(() => scopeWindow(session), [session])
  const [win, setWin] = useState<TimeWindow>(ws0.window)
  const [tool, setTool] = useState<Tool>('pan')
  const [history, setHistory] = useState<ViewState[]>([])
  const lastNav = useRef<{ kind: NavKind | null; time: number }>({ kind: null, time: 0 })

  const [cursors, setCursors] = useState<CursorState>(ws0.cursors)
  const [selected, setSelected] = useState<string | undefined>(ws0.selected)
  const [notes, setNotes] = useState(ws0.notes)
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
  const [measRange, setMeasRange] = useState<MeasureRange>(ws0.measurements.range)
  const [measKeys, setMeasKeys] = useState<MeasurementKey[]>(ws0.measurements.keys)
  const plotRef = useRef<PlotAreaHandle>(null)
  const spectrumRef = useRef<SpectrumViewHandle>(null)

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
  const [callouts, setCallouts] = useState<Callout[]>(ws0.callouts)
  const [selectedCallout, setSelectedCallout] = useState<string | undefined>()
  const [editing, setEditing] = useState<{ id: string; isNew: boolean } | null>(null)

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
  }, [setCallouts])
  /** Delete a callout; offers undo unless `silent` (an empty new note that is discarded) */
  const deleteCallout = (id: string, silent = false) => {
    const c = callouts.find((x) => x.id === id)
    setCallouts((cs) => cs.filter((x) => x.id !== id))
    if (editing?.id === id) setEditing(null)
    if (selectedCallout === id) setSelectedCallout(undefined)
    if (c && !silent) offerUndo(`${calloutTitle(c)} deleted`, () => setCallouts((cs) => [...cs, c]))
  }
  const editCallout = (id: string | null) => {
    if (id) {
      setEditing({ id, isNew: false })
      setSelectedCallout(id)
      return
    }
    // Finishing the editor: a new note without text is discarded
    const c = editing && callouts.find((x) => x.id === editing.id)
    if (editing?.isNew && c?.type === 'note' && !c.text.trim()) deleteCallout(c.id, true)
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
  // ---------- export dialog (declared early: shortcuts are off while it is open) ----------
  const [exportKind, setExportKind] = useState<ExportKind | null>(null)
  const [exportPlotSize, setExportPlotSize] = useState({ w: 0, h: 0 })
  const openExport = (kind: ExportKind) => {
    setExportPlotSize(plotRef.current?.size() ?? { w: 0, h: 0 })
    setExportKind(kind)
  }

  /** "Between cursors" needs visible cursors: turn them on, in the current view if they are off-screen */
  const showCursors = () => {
    if (cursors.on) return
    const span = win.end - win.start
    const inView = (t: number) => t >= win.start && t <= win.end
    setCursors(inView(cursors.a) && inView(cursors.b) ? { ...cursors, on: true } : { ...cursors, on: true, a: win.start + span * 0.3, b: win.start + span * 0.7 })
  }

  // ---------- undo of deletions ----------
  const [undo, setUndo] = useState<{ message: string; restore: () => void; id: number } | null>(null)
  const offerUndo = (message: string, restore: () => void) => setUndo({ message, restore, id: Date.now() })
  const runUndo = () => {
    undo?.restore()
    setUndo(null)
  }
  useEffect(() => {
    if (!undo) return
    const t = window.setTimeout(() => setUndo((u) => (u?.id === undo.id ? null : u)), 8000)
    return () => window.clearTimeout(t)
  }, [undo])

  // ---------- keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exportKind) return
      const target = e.target as HTMLElement
      if (target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && undo) {
        e.preventDefault()
        runUndo()
        return
      }
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
    const id = nextMathId(mathDefs, session.channels.map((c) => c.wave.id))
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
    // Everything needed to put the channel back exactly as it was
    const def = mathDefs.find((m) => m.id === id)
    const display = displays.find((d) => d.id === id)
    const viewIndex = views.findIndex((v) => v.includes(id))
    const ownView = viewIndex >= 0 && views[viewIndex].length === 1
    const specs = spectra.filter((s) => s.source === id)
    if (def && display) {
      offerUndo(`${channelName(id)} deleted`, () => {
        setMathDefs((ms) => [...ms, def])
        setDisplays((ds) => [...ds, display])
        setViews((vs) => {
          const next = vs.map((v) => [...v])
          if (ownView || viewIndex < 0 || viewIndex >= next.length) next.splice(Math.max(0, Math.min(viewIndex, next.length)), 0, [id])
          else next[viewIndex].push(id)
          return next
        })
        setSpectra((ss) => [...ss, ...specs])
      })
    }
    setMathDefs((ms) => ms.filter((m) => m.id !== id))
    setDisplays((ds) => ds.filter((d) => d.id !== id))
    setViews((vs) => vs.map((v) => v.filter((x) => x !== id)).filter((v) => v.length > 0))
    setSpectra((ss) => ss.filter((s) => s.source !== id))
    if (selected === id) setSelected(session.channels[0].wave.id)
    if (cursors.source === id) setCursors({ ...cursors, source: session.channels[0].wave.id })
  }

  // ---------- spectra ----------
  const [spectra, setSpectra] = useState<SpectrumDef[]>(ws0.spectra)
  const [specOptions, setSpecOptions] = useState<SpectrumOptions>(ws0.spectrumOptions)
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

  // ---------- workspace: autosave, analysis files, reset ----------
  const workspace: Workspace = useMemo(
    () => ({
      version: 1,
      channels: displays,
      views,
      math: mathDefs,
      spectra,
      spectrumOptions: specOptions,
      callouts,
      cursors,
      window: win,
      measurements: { keys: measKeys, range: measRange },
      selected,
      notes,
    }),
    [displays, views, mathDefs, spectra, specOptions, callouts, cursors, win, measKeys, measRange, selected, notes],
  )

  const [saveStatus, setSaveStatus] = useState<SaveStatus>(() => (boot.source === 'saved' ? { state: 'saved', at: new Date().toISOString() } : { state: 'clean' }))
  // A file that is only opened is not stored: saving starts with the first change. An imported or
  // migrated workspace is not in storage yet, so it is saved right away. Comparing with the initial
  // state (instead of skipping the first effect run) also holds when effects run twice in development.
  const [initialJson] = useState(() => (boot.source === 'saved' || boot.source === 'default' ? JSON.stringify(boot.workspace) : null))
  const changed = useRef(initialJson === null)
  const latest = useRef(workspace)
  const timer = useRef<number | undefined>(undefined)
  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    const res = saveWorkspace(session, latest.current)
    setSaveStatus(res.ok ? { state: 'saved', at: res.savedAt } : { state: 'error', error: res.error })
  }, [session])
  useEffect(() => {
    latest.current = workspace
    // Once something changed, every state is saved (also a change back to the initial one)
    if (!changed.current && JSON.stringify(workspace) === initialJson) return
    changed.current = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 400)
  }, [workspace, flush, initialJson])
  // Save pending changes when the page is closed or the session is left
  useEffect(() => {
    const onHide = () => timer.current !== undefined && flush()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      onHide()
    }
  }, [flush])

  const saveAnalysis = () => {
    downloadBlob(new Blob([analysisToJson(session, workspace)], { type: 'application/json' }), `${stem(session.fileName)}${ANALYSIS_EXT}`)
  }
  const saveBundle = async () => {
    try {
      const files = await Promise.all(sources.map(async (s) => ({ name: s.name, data: await s.blob.arrayBuffer() })))
      downloadBlob(buildBundle(files, analysisToJson(session, workspace)), `${stem(session.fileName)}${BUNDLE_EXT}`)
    } catch (e) {
      alert(`Could not save the bundle: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const resetToDefaults = () => {
    if (!confirm('Discard all your changes to this session (channel settings, math channels, spectra, callouts, notes) and show it as saved on the scope?')) return
    window.clearTimeout(timer.current)
    timer.current = undefined
    if (session.fingerprint) deleteStoredSession(session.fingerprint)
    onReplaceWorkspace({ kind: 'defaults' })
  }
  const importAnalysisFile = async (file: File) => {
    try {
      const parsed = parseAnalysisJson(await file.text())
      const foreign = parsed.fingerprint && session.fingerprint && parsed.fingerprint !== session.fingerprint
      if (parsed.kind === 'callouts') {
        if (foreign && !confirm('These callouts were saved for a different session file. Add them anyway?')) return
        const ids = new Set(parsed.callouts.map((c) => c.id))
        setCallouts((cs) => [...cs.filter((c) => !ids.has(c.id)), ...parsed.callouts])
        setPanel('callouts')
        return
      }
      const msg = foreign
        ? `This analysis was saved for ${parsed.sessionFile ?? 'a different file'}. Apply it to ${session.fileName} anyway? It replaces your current changes.`
        : 'Replace your current changes with the analysis from the file?'
      if (!confirm(msg)) return
      window.clearTimeout(timer.current)
      timer.current = undefined
      onReplaceWorkspace({ kind: 'analysis', workspace: parsed.workspace })
    } catch (e) {
      alert(`Could not open the analysis file: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  useImperativeHandle(ref, () => ({ importAnalysisFile }))
  const analysisInput = useRef<HTMLInputElement>(null)

  // ---------- exports ----------
  const ticks = timeTicks(win)
  const tPerDiv = ticks.length > 1 ? ticks[1] - ticks[0] : (win.end - win.start) / 10
  const zoomed = win.start > record.start + minDt || win.end < record.end - minDt
  const visibleChannels = channels.filter((c) => c.display.visible)
  const fileStem = stem(session.fileName)

  const exportContext = (): ExportContext => ({
    session,
    channels,
    math: mathItems,
    callouts,
    cursors,
    win,
    record,
    minDt,
    timePerDiv: tPerDiv,
    measKeys,
    measRange,
    spectra,
    specOptions,
    notes,
    plot: plotRef.current,
    spectrum: spectrumRef.current,
  })
  const measuredCount = visibleChannels.filter((c) => {
    const [i0, i1] = sampleRange(c.wave, measRange, win, cursors)
    return Math.min(c.wave.data.length, i1) > Math.max(0, i0)
  }).length

  return (
    <div className="scope">
      <TopBar
        fileName={session.fileName}
        saveStatus={saveStatus}
        onOpen={onOpen}
        onOpenAnalysis={() => analysisInput.current?.click()}
        onSaveAnalysis={saveAnalysis}
        onSaveBundle={saveBundle}
        onReset={resetToDefaults}
        onShowStorage={() => setPanel('info')}
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
        onExport={openExport}
        hasSpectra={spectra.some((s) => s.visible)}
      />
      <input
        ref={analysisInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importAnalysisFile(f)
          e.target.value = ''
        }}
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
              ref={spectrumRef}
              defs={spectra}
              options={specOptions}
              setOptions={(patch) => {
                setSpecOptions((o) => ({ ...o, ...patch }))
                if (patch.range === 'cursors') showCursors()
              }}
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
              setRange={(r) => {
                setMeasRange(r)
                if (r === 'cursors') showCursors()
              }}
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
                onClear={() => {
                  const all = callouts
                  setCallouts([])
                  setEditing(null)
                  setSelectedCallout(undefined)
                  offerUndo(`${all.length} callouts deleted`, () => setCallouts(all))
                }}
              />
            )}
            {layout.panel === 'info' && (
              <InfoPanel
                session={session}
                storage={
                  <StorageSection
                    fingerprint={session.fingerprint}
                    status={saveStatus}
                    notes={notes}
                    setNotes={setNotes}
                    onSaveAnalysis={saveAnalysis}
                    onSaveBundle={saveBundle}
                    onReset={resetToDefaults}
                  />
                }
              />
            )}
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

      {undo && (
        <div className="undo-toast" role="status">
          <span>{undo.message}</span>
          <button type="button" className="text-btn" onClick={runUndo}>
            Undo <kbd>Ctrl+Z</kbd>
          </button>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setUndo(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {exportKind && (
        <ExportDialog
          initial={exportKind}
          onClose={() => setExportKind(null)}
          hasSpectra={spectra.some((s) => s.visible)}
          cursorsOn={cursors.on}
          waveformRows={(o) => waveformRows(exportContext(), o)}
          plotSize={exportPlotSize}
          measurementInfo={{ range: measRange, count: measKeys.length, channels: measuredCount }}
          notes={notes}
          setNotes={setNotes}
          defaultTitle={fileStem}
          canCopyImage={typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write && window.isSecureContext}
          onExport={(kind, prefs, extra) => runExport(exportContext(), kind, prefs, extra)}
        />
      )}
    </div>
  )
})

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
