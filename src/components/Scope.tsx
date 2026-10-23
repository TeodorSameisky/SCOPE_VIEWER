import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Archive,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BookOpen,
  Copy,
  CopyPlus,
  Crosshair,
  Eye,
  EyeOff,
  FileJson,
  FileSpreadsheet,
  FileText,
  Flag,
  Focus,
  FolderOpen,
  GalleryHorizontal,
  Hand,
  Hash,
  Home,
  Image,
  Info,
  LocateFixed,
  Maximize2,
  MonitorDown,
  MoveHorizontal,
  Palette,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Ruler,
  ScanEye,
  SlidersHorizontal,
  StickyNote,
  Table2,
  Trash2,
  Undo2,
  UnfoldVertical,
  Upload,
  Waves,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'
import type { ChannelDisplay, Session } from '../model/types'
import type { MeasurementKey } from '../dsp/measure'
import { CALLOUT_COLORS, DEFAULT_CALLOUT_COLOR, calloutName, calloutSpan, calloutTitle, newCalloutId, nextCalloutNumber, type Callout } from '../model/callouts'
import { MEASUREMENT_DEFS } from '../dsp/measureDefs'
import { MinMaxPyramid } from '../dsp/minmax'
import { evaluateMath } from '../math/expr'
import { MATH_COLORS, MAX_MATH, nextMathId, type MathDef } from '../model/math'
import { MAX_SPECTRA, newSpectrum, type SpectrumDef, type SpectrumOptions } from '../model/spectrum'
import {
  ANALYSIS_EXT,
  BUNDLE_EXT,
  WORKSPACE_VERSION,
  analysisToJson,
  defaultWorkspace,
  deleteStoredSession,
  loadWorkspace,
  parseAnalysisJson,
  recordWindow,
  sanitizeWorkspace,
  scopeWindow,
  type LoadSource,
  type Workspace,
} from '../model/workspace'
import { buildBundle } from '../export/bundle'
import { runExport, waveformRows, type ExportContext, type ExportKind } from '../export/sessionExport'
import { AXIS_GUTTER, valueAt } from '../render/draw'
import { copyText } from '../util/clipboard'
import { downloadBlob, stem } from '../util/download'
import { niceStep, si } from '../util/format'
import { channelName } from '../util/names'
import { usePersistentState } from '../util/usePersistentState'
import type { RecentSession } from '../model/recent'
import { installApp, useCanInstall } from '../pwa/install'
import { CalloutPanel } from './CalloutPanel'
import { CommandPalette } from './CommandPalette'
import { ChannelBar, type ChannelBarHandle, type MathItem } from './ChannelBar'
import { CursorPanel } from './CursorPanel'
import { ExportDialog } from './ExportDialog'
import { InfoPanel } from './InfoPanel'
import { MeasurementTable } from './MeasurementTable'
import { Overview } from './Overview'
import { PlotArea, type NewCallout, type PlotAreaHandle, type PlotPoint } from './PlotArea'
import { ReferencePanel, type ReferenceSection } from './ReferencePanel'
import { Rail, type PanelId } from './Rail'
import { SpectrumView, type SpectrumViewHandle } from './SpectrumView'
import { StorageSection } from './StorageSection'
import { TopBar } from './TopBar'
import {
  MEASURE_RANGES,
  RANGE_LABEL,
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
} from '../model/view'
import type { Command } from './ui/commandSearch'
import { useContextMenu, type MenuEntry } from './ui/menuContext'
import { THEME_LABEL, THEME_PREFERENCES, useTheme } from './ui/themeContext'
import { UndoHistory } from '../model/undoHistory'
import { useAutosave } from './useAutosave'
import { useUndoHistory } from './useUndoHistory'

/** Window + vertical settings, restored by "zoom back" */
interface ViewState {
  win: TimeWindow
  vertical: Record<string, { scale: number; position: number; offset: number }>
}

/** Shown in the plot while a tool other than Pan is active */
const TOOL_HINT: Partial<Record<Tool, string>> = {
  zoom: 'Drag a rectangle to zoom time + vertical · Shift+drag: time only · Click: zoom in · Alt+click: out · Esc: done',
  note: 'Click on a trace to attach a note · Esc: cancel',
  marker: 'Click to place a marker · snaps to edges of the selected channel (Alt: free) · Esc: cancel',
  region: 'Drag to mark a time region · snaps to edges of the selected channel (Alt: free) · Esc: cancel',
}

const PANEL_TITLE: Record<PanelId, string> = { cursors: 'Cursors', callouts: 'Callouts', info: 'Session', reference: 'Reference' }

interface Layout {
  panel: PanelId | null
  overview: boolean
  measurements: boolean
  measHeight: number
  specHeight: number
  /** Values of all channels next to the pointer */
  readout: boolean
}
const DEFAULT_LAYOUT: Layout = { panel: null, overview: true, measurements: true, measHeight: 170, specHeight: 220, readout: true }

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
  /** Switch to another session stored in this browser */
  onOpenStored: (r: RecentSession) => void
  /** Keep the files of the open session in the browser */
  onKeepFiles: () => Promise<void>
  /** Changes when session files were kept (refreshes the stored-session list) */
  filesVersion: number
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

export const Scope = forwardRef<ScopeHandle, Props>(function Scope({ session, sources, initial, onOpen, onClose, onReplaceWorkspace, onOpenStored, onKeepFiles, filesVersion }, ref) {
  // Everything the user can change starts from the workspace (saved state, analysis file or file defaults)
  const [boot] = useState(() => initWorkspace(session, initial))
  const ws0 = boot.workspace
  // Undo history of the analysis (recorded in "undo / redo" below)
  const [editHistory] = useState(() => new UndoHistory(undoDocOf(ws0)))

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
  const toggleReadout = () => setLayout((l) => ({ ...l, readout: !l.readout }))
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
    if (c && !silent) offerUndo(`${calloutTitle(c)} deleted`)
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
  /** A copy of a callout, a little later in time, selected */
  const duplicateCallout = (c: Callout) => {
    const shift = (win.end - win.start) * 0.03
    const copy: Callout = { ...c, id: newCalloutId(), n: nextCalloutNumber(callouts), t: c.t + shift, ...(c.t2 !== undefined ? { t2: c.t2 + shift } : {}) }
    setCallouts([...callouts, copy])
    setSelectedCallout(copy.id)
  }
  /** Move a callout by one pixel of the current view */
  const nudgeCallout = (id: string, dir: -1 | 1) => {
    const plotW = Math.max(1, (plotRef.current?.size().w ?? 1000) - AXIS_GUTTER)
    const dt = (dir * (win.end - win.start)) / plotW
    setCallouts((cs) => cs.map((c) => (c.id === id ? { ...c, t: c.t + dt, ...(c.t2 !== undefined ? { t2: c.t2 + dt } : {}) } : c)))
  }
  /** Go to the previous / next callout in time: from the selected one, else from the middle of the view */
  const stepCallout = (dir: -1 | 1) => {
    const sorted = [...callouts].sort((a, b) => calloutSpan(a)[0] - calloutSpan(b)[0])
    const i = sorted.findIndex((c) => c.id === selectedCallout)
    const mid = (win.start + win.end) / 2
    const next =
      i >= 0 ? sorted[i + dir] : dir > 0 ? sorted.find((c) => calloutSpan(c)[0] > mid) : sorted.findLast((c) => calloutSpan(c)[0] < mid)
    if (next) jumpToCallout(next)
  }
  // ---------- export dialog (declared early: shortcuts are off while it is open) ----------
  const [exportKind, setExportKind] = useState<ExportKind | null>(null)
  const [exportPlotSize, setExportPlotSize] = useState({ w: 0, h: 0 })
  const openExport = (kind: ExportKind) => {
    setExportPlotSize(plotRef.current?.size() ?? { w: 0, h: 0 })
    setExportKind(kind)
  }
  // The command palette (Ctrl+K) also has the keyboard while it is open
  const [paletteOpen, setPaletteOpen] = useState(false)

  /** "Between cursors" needs visible cursors: turn them on, in the current view if they are off-screen */
  const showCursors = () => {
    if (cursors.on) return
    const span = win.end - win.start
    const inView = (t: number) => t >= win.start && t <= win.end
    setCursors(inView(cursors.a) && inView(cursors.b) ? { ...cursors, on: true } : { ...cursors, on: true, a: win.start + span * 0.3, b: win.start + span * 0.7 })
  }

  // ---------- deletions offer undo in a toast (the undo history is set up below the state) ----------
  const [undoToast, setUndoToast] = useState<{ message: string; id: number; steps: number } | null>(null)
  /** Called with the deletion; the toast stays until something else changes */
  const offerUndo = (message: string) => setUndoToast({ message, id: Date.now(), steps: editHistory.started })
  useEffect(() => {
    if (!undoToast) return
    const t = window.setTimeout(() => setUndoToast((u) => (u?.id === undoToast.id ? null : u)), 8000)
    return () => window.clearTimeout(t)
  }, [undoToast])

  // ---------- short confirmations ("… copied") ----------
  const [notice, setNotice] = useState<{ message: string; id: number } | null>(null)
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice((n) => (n?.id === notice.id ? null : n)), 2500)
    return () => window.clearTimeout(t)
  }, [notice])
  const copy = async (text: string, what: string) => {
    const ok = await copyText(text)
    setNotice({ message: ok ? `${what} copied` : 'This browser does not allow copying here', id: Date.now() })
  }

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
    offerUndo(`${channelName(id)} deleted`)
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
      version: WORKSPACE_VERSION,
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

  // ---------- undo / redo ----------
  // Every change of the analysis is a step; the time window and the selection are navigation
  // (Back / Backspace) and not part of it.
  const undoDoc = useMemo(
    () => undoDocOf({ channels: displays, views, math: mathDefs, spectra, spectrumOptions: specOptions, callouts, cursors, measurements: { keys: measKeys, range: measRange }, notes }),
    [displays, views, mathDefs, spectra, specOptions, callouts, cursors, measKeys, measRange, notes],
  )
  const edits = useUndoHistory(editHistory, undoDoc, (d) => {
    setDisplays(d.channels)
    setViews(d.views)
    setMathDefs(d.math)
    setSpectra(d.spectra)
    setSpecOptions(d.spectrumOptions)
    setCallouts(d.callouts)
    setCursors(d.cursors)
    setMeasKeys(d.measurements.keys)
    setMeasRange(d.measurements.range)
    setNotes(d.notes)
    // Nothing may stay selected or open that the restored state does not have
    if (selected && !d.channels.some((c) => c.id === selected)) setSelected(session.channels[0].wave.id)
    if (editing && !d.callouts.some((c) => c.id === editing.id)) setEditing(null)
    if (selectedCallout && !d.callouts.some((c) => c.id === selectedCallout)) setSelectedCallout(undefined)
    setUndoToast(null)
  })
  // The toast's Undo only applies while the deletion is the latest step
  const toast = undoToast && edits.steps <= undoToast.steps + 1 ? undoToast : null

  // ---------- keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exportKind) return
      const k = e.key.toLowerCase()
      // The command palette opens (and closes) from anywhere, text fields included
      if ((e.ctrlKey || e.metaKey) && (k === 'k' || (e.shiftKey && k === 'p'))) {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      if (paletteOpen) return
      const target = e.target as HTMLElement
      if (target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) {
        e.preventDefault()
        if (k === 'y' || e.shiftKey) edits.redo()
        else edits.undo()
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
      } else if (e.shiftKey && selectedCallout && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        nudgeCallout(selectedCallout, e.key === 'ArrowLeft' ? -1 : 1)
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
          v: toggleReadout,
          '\\': toggleFocus,
          ',': () => stepCallout(-1),
          '.': () => stepCallout(1),
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

  const { status: saveStatus, cancel: cancelSave } = useAutosave(session, workspace, boot)

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
    cancelSave()
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
      cancelSave()
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

  // ---------- context menus (right-click) ----------
  const openMenu = useContextMenu()
  const channelBarRef = useRef<ChannelBarHandle>(null)

  /** Put cursor A or B at `t`; when the cursors come on, the other one is moved into view if needed */
  const placeCursor = (which: 'a' | 'b', t: number) => {
    const next = { ...cursors, on: true, [which]: t }
    const other = which === 'a' ? 'b' : 'a'
    if (!cursors.on && (next[other] < win.start || next[other] > win.end)) {
      const span = win.end - win.start
      next[other] = Math.min(win.end, Math.max(win.start, t + (which === 'a' ? 0.2 : -0.2) * span))
    }
    setCursors(next)
  }

  const channelHeading = (id: string, detail?: string): MenuEntry => {
    const d = displayById.get(id)
    return { kind: 'heading', label: `${channelName(id)}${d?.label ? ` · ${d.label}` : ''}`, color: d?.color, detail }
  }
  /** Commands for one channel: on its badge, on its trace and on its measurement row */
  const channelItems = (id: string, compact = false): MenuEntry[] => {
    const d = displayById.get(id)
    if (!d) return []
    const hasWave = channels.some((c) => c.wave.id === id)
    const others = displays.filter((x) => x.id !== id)
    const solo = d.visible && others.every((x) => !x.visible)
    const view = views.findIndex((v) => v.includes(id))
    const hasSpectrum = spectrumSources.has(id)
    const isMath = mathDefs.some((m) => m.id === id)
    return [
      { label: isMath ? 'Settings and expression…' : 'Settings…', icon: SlidersHorizontal, onClick: () => channelBarRef.current?.openSettings(id) },
      { label: d.visible ? 'Hide' : 'Show', icon: d.visible ? EyeOff : Eye, onClick: () => onAdjust(id, { visible: !d.visible }) },
      solo
        ? { label: 'Show all channels', icon: Eye, disabled: !others.length, onClick: () => setDisplays((ds) => ds.map((x) => ({ ...x, visible: true }))) }
        : { label: 'Show only this channel', icon: ScanEye, onClick: () => setDisplays((ds) => ds.map((x) => ({ ...x, visible: x.id === id }))) },
      { label: 'Autoscale', icon: UnfoldVertical, title: 'Fit the whole waveform into its view', disabled: !hasWave, onClick: () => onAutoscale(id) },
      !compact && {
        kind: 'choices',
        label: 'View',
        options: [
          ...views.map((_, i) => ({ label: String(i + 1), title: `Move to view ${i + 1}`, checked: i === view, onClick: () => onMoveToView(id, i) })),
          { label: 'New', title: 'Move to a new view of its own', disabled: view >= 0 && views[view].length === 1, onClick: () => onMoveToView(id, views.length) },
        ],
      },
      {
        label: hasSpectrum ? 'Remove spectrum' : 'Show spectrum (FFT)',
        icon: AudioLines,
        disabled: !hasWave || (!hasSpectrum && spectra.length >= MAX_SPECTRA),
        onClick: () => toggleSpectrum(id),
      },
      cursors.on && hasWave && { label: 'Cursor Δv on this channel', icon: Ruler, checked: cursors.source === id, onClick: () => setCursors({ ...cursors, source: id }) },
      !compact && isMath && '-',
      !compact && isMath && { label: 'Delete math channel', icon: Trash2, danger: true, onClick: () => removeMath(id) },
    ]
  }
  const channelMenu = (e: React.MouseEvent, id: string) => {
    const d = displayById.get(id)
    const unit = channels.find((c) => c.wave.id === id)?.wave.yUnit
    openMenu(e, [channelHeading(id, d && si(d.scale, `${unit || 'U'}/div`, 3)), ...channelItems(id)])
  }

  /** Time and value of every visible channel at `t`, one per line */
  const valuesAt = (t: number) =>
    [
      `t = ${si(t, 's', 6)}`,
      ...visibleChannels.map((c) => `${channelName(c.wave.id)}${c.display.label ? ` (${c.display.label})` : ''}: ${si(valueAt(c.wave, t), c.wave.yUnit, 5)}`),
    ].join('\n')

  const plotMenu = (e: React.MouseEvent, at: PlotPoint) => {
    const { t, note, edgeT } = at
    const ch = at.channel ? channels.find((c) => c.wave.id === at.channel) : undefined
    if (ch) setSelected(ch.wave.id)
    openMenu(e, [
      { kind: 'heading', label: 'Time', detail: si(t, 's', 5) },
      { label: 'Zoom in here', icon: ZoomIn, onClick: () => zoomTo(zoomAround(win, t, 0.5, minSpan, maxSpan)) },
      { label: 'Zoom out here', icon: ZoomOut, onClick: () => zoomTo(zoomAround(win, t, 2, minSpan, maxSpan)) },
      { label: 'Back', icon: ArrowLeft, hint: 'Backspace', disabled: !history.length, onClick: zoomBack },
      { label: 'Full record', icon: Maximize2, hint: 'F', disabled: !zoomed, onClick: () => zoomTo(record) },
      '-',
      {
        kind: 'choices',
        label: 'Cursor',
        options: [
          { label: 'A here', title: 'Put cursor A here', onClick: () => placeCursor('a', t) },
          { label: 'B here', title: 'Put cursor B here', onClick: () => placeCursor('b', t) },
        ],
      },
      note && { label: 'Add note here', icon: StickyNote, onClick: () => addCallout(note) },
      edgeT !== undefined
        ? { label: 'Add marker at the edge', icon: Flag, title: 'At the 50 % crossing of the selected channel next to the pointer (Alt+right-click: exactly here)', onClick: () => addCallout({ type: 'marker', t: edgeT }) }
        : { label: 'Add marker here', icon: Flag, onClick: () => addCallout({ type: 'marker', t }) },
      cursors.on && {
        label: 'Mark region between cursors',
        icon: MoveHorizontal,
        onClick: () => addCallout({ type: 'region', t: Math.min(cursors.a, cursors.b), t2: Math.max(cursors.a, cursors.b) }),
      },
      callouts.length > 0 && {
        kind: 'choices',
        label: 'Callout',
        options: [
          { label: '‹ Previous', title: 'Go to the previous callout (,)', onClick: () => stepCallout(-1) },
          { label: 'Next ›', title: 'Go to the next callout (.)', onClick: () => stepCallout(1) },
        ],
      },
      ch && '-',
      ch && channelHeading(ch.wave.id, si(valueAt(ch.wave, t), ch.wave.yUnit)),
      ...(ch ? channelItems(ch.wave.id, true) : []),
      '-',
      {
        label: 'Copy values at this time',
        icon: Copy,
        title: 'Time and value of every visible channel',
        disabled: !visibleChannels.length || t < record.start || t > record.end,
        onClick: () => copy(valuesAt(t), 'Values'),
      },
      { label: 'Export image…', icon: Image, onClick: () => openExport('image') },
    ])
  }

  const calloutMenu = (e: React.MouseEvent, c: Callout) => {
    const t2 = c.t2 ?? c.t
    openMenu(e, [
      { kind: 'heading', label: calloutTitle(c), color: c.color, detail: c.type === 'region' ? `Δt ${si(Math.abs(t2 - c.t), 's')}` : si(c.t, 's', 5) },
      { label: 'Edit text', icon: Pencil, hint: 'Enter', onClick: () => editCallout(c.id) },
      { kind: 'choices', label: 'Colour', options: CALLOUT_COLORS.map((col) => ({ label: col, color: col, checked: c.color === col, onClick: () => updateCallout(c.id, { color: col }) })) },
      c.type === 'note' && {
        label: c.channel ? 'Show value at the anchor' : 'Show time at the anchor',
        icon: Hash,
        checked: !!c.showValue,
        onClick: () => updateCallout(c.id, { showValue: c.showValue ? undefined : true }),
      },
      c.type === 'region' && { label: c.measure ? 'Change measurements…' : 'Measure in this region…', icon: Activity, onClick: () => editCallout(c.id) },
      { label: c.type === 'region' ? 'Zoom to region' : 'Go to', icon: LocateFixed, onClick: () => jumpToCallout(c) },
      { label: 'Duplicate', icon: CopyPlus, onClick: () => duplicateCallout(c) },
      c.type === 'region'
        ? { label: 'Set cursors to region', icon: Ruler, onClick: () => setCursors({ ...cursors, on: true, a: Math.min(c.t, t2), b: Math.max(c.t, t2) }) }
        : {
            kind: 'choices',
            label: 'Cursor',
            options: [
              { label: 'A here', title: 'Put cursor A at this callout', onClick: () => placeCursor('a', c.t) },
              { label: 'B here', title: 'Put cursor B at this callout', onClick: () => placeCursor('b', c.t) },
            ],
          },
      '-',
      { label: 'Delete', icon: Trash2, hint: 'Del', danger: true, onClick: () => deleteCallout(c.id) },
    ])
  }

  const viewItems: MenuEntry[] = [
    { label: 'Back', icon: ArrowLeft, hint: 'Backspace', disabled: !history.length, onClick: zoomBack },
    { label: 'Full record', icon: Maximize2, hint: 'F', disabled: !zoomed, onClick: () => zoomTo(record) },
    { label: 'Saved view', icon: Home, title: 'The view the scope showed when the session was saved', onClick: () => zoomTo(initialWin) },
  ]
  const overviewMenu = (e: React.MouseEvent, t: number) => {
    const span = win.end - win.start
    openMenu(e, [
      { kind: 'heading', label: 'Time', detail: si(t, 's', 5) },
      { label: 'Centre the view here', icon: LocateFixed, onClick: () => zoomTo({ start: t - span / 2, end: t + span / 2 }) },
      ...viewItems,
      '-',
      { label: 'Hide overview', icon: EyeOff, hint: 'O', onClick: toggleOverview },
    ])
  }

  // ---------- command palette (Ctrl+K) ----------
  const { preference: themePreference, setPreference: setThemePreference } = useTheme()
  const canInstall = useCanInstall()
  /** Everything the palette offers, built when it opens; unavailable commands are left out */
  const paletteCommands = (): Command[] => {
    const span = win.end - win.start
    const mid = (win.start + win.end) / 2
    const tools: [Tool, string, string, LucideIcon][] = [
      ['pan', 'Pan', 'P', Hand],
      ['zoom', 'Zoom', 'Z', ZoomIn],
      ['note', 'Note', 'N', StickyNote],
      ['marker', 'Marker', 'M', Flag],
      ['region', 'Region', 'R', MoveHorizontal],
    ]
    const exports: [ExportKind, string, LucideIcon][] = [
      ['image', 'Image (PNG)…', Image],
      ['report', 'Report (HTML, PDF)…', FileText],
      ['waveforms', 'Waveform data (CSV)…', Waves],
      ['measurements', 'Measurements (CSV)…', Table2],
      ['spectra', 'Spectra (CSV)…', FileSpreadsheet],
    ]
    const hasSpectra = spectra.some((s) => s.visible)
    const entries: (Command | false)[] = [
      ...tools.map(([t, label, hint, icon]): Command => ({ id: `tool:${t}`, group: 'Tool', label: `${label} tool`, hint, icon, checked: tool === t, run: () => setTool(t) })),

      { id: 'view:full', group: 'View', label: 'Full record', hint: 'F', icon: Maximize2, run: () => zoomTo(record) },
      history.length > 0 && { id: 'view:back', group: 'View', label: 'Back to the previous view', hint: 'Backspace', icon: ArrowLeft, run: zoomBack },
      { id: 'view:saved', group: 'View', label: 'Saved view', keywords: 'as on the scope home', icon: Home, run: () => zoomTo(initialWin) },
      { id: 'view:in', group: 'View', label: 'Zoom in', hint: '+', icon: ZoomIn, run: () => zoomTo(zoomAround(win, mid, 0.5, minSpan, maxSpan)) },
      { id: 'view:out', group: 'View', label: 'Zoom out', hint: '−', icon: ZoomOut, run: () => zoomTo(zoomAround(win, mid, 2, minSpan, maxSpan)) },
      { id: 'view:cursors', group: 'View', label: 'Cursors', hint: 'C', icon: Ruler, checked: cursors.on, run: () => setCursors({ ...cursors, on: !cursors.on }) },
      { id: 'view:cursors-here', group: 'View', label: 'Bring the cursors into the view', icon: Ruler, run: () => setCursors({ ...cursors, on: true, a: win.start + span * 0.3, b: win.start + span * 0.7 }) },
      { id: 'view:readout', group: 'View', label: 'Values at the pointer', hint: 'V', icon: Crosshair, checked: layout.readout, run: toggleReadout },
      { id: 'view:overview', group: 'View', label: 'Overview strip', hint: 'O', icon: GalleryHorizontal, checked: layout.overview, run: toggleOverview },
      { id: 'view:measurements', group: 'View', label: 'Measurement table', hint: 'T', icon: Table2, checked: layout.measurements, run: toggleMeasurements },
      { id: 'view:focus', group: 'View', label: 'Focus mode: hide all panels', hint: '\\', icon: Focus, checked: focusMode, run: toggleFocus },

      { id: 'panel:cursors', group: 'Panel', label: 'Cursor readouts', icon: Ruler, checked: layout.panel === 'cursors', run: () => setPanel(layout.panel === 'cursors' ? null : 'cursors') },
      { id: 'panel:callouts', group: 'Panel', label: 'Callouts', icon: StickyNote, checked: layout.panel === 'callouts', run: () => setPanel(layout.panel === 'callouts' ? null : 'callouts') },
      { id: 'panel:info', group: 'Panel', label: 'Session info, notes and setup', icon: Info, checked: layout.panel === 'info', run: () => setPanel(layout.panel === 'info' ? null : 'info') },
      { id: 'help:measurements', group: 'Reference', label: 'How measurements work', icon: BookOpen, run: () => openReference('measurements') },
      { id: 'help:math', group: 'Reference', label: 'Math functions', icon: BookOpen, run: () => openReference('math') },
      { id: 'help:spectrum', group: 'Reference', label: 'Spectrum, windows and dB', keywords: 'fft', icon: BookOpen, run: () => openReference('spectrum') },

      edits.canUndo && { id: 'edit:undo', group: 'Edit', label: 'Undo', hint: 'Ctrl+Z', icon: Undo2, run: edits.undo },
      edits.canRedo && { id: 'edit:redo', group: 'Edit', label: 'Redo', hint: 'Ctrl+Y', icon: Redo2, run: edits.redo },
      mathDefs.length < MAX_MATH && {
        id: 'edit:math',
        group: 'Edit',
        label: 'Add math channel',
        keywords: 'expression difference power',
        icon: Plus,
        run: () => {
          const id = addMath()
          // Open its editor once its badge is there
          if (id) requestAnimationFrame(() => channelBarRef.current?.openSettings(id))
        },
      },
      spectra.length < MAX_SPECTRA && { id: 'edit:fft', group: 'Edit', label: `Add spectrum (FFT) of ${channelName(selected ?? session.channels[0].wave.id)}`, keywords: 'frequency', icon: AudioLines, run: () => addSpectrum() },
      callouts.length > 0 && { id: 'callout:prev', group: 'Callout', label: 'Previous callout', hint: ',', icon: ArrowLeft, run: () => stepCallout(-1) },
      callouts.length > 0 && { id: 'callout:next', group: 'Callout', label: 'Next callout', hint: '.', icon: ArrowRight, run: () => stepCallout(1) },
      ...[...callouts]
        .sort((a, b) => calloutSpan(a)[0] - calloutSpan(b)[0])
        .map((c): Command => ({ id: `callout:${c.id}`, group: 'Callout', label: `Go to ${calloutTitle(c)}`, keywords: `${calloutName(c)} ${c.text}`, color: c.color, run: () => jumpToCallout(c) })),

      ...MEASURE_RANGES.map((r): Command => ({
        id: `meas:range:${r}`,
        group: 'Measurements',
        label: `Measure ${RANGE_LABEL[r].toLowerCase()}`,
        icon: Activity,
        checked: measRange === r,
        run: () => {
          setMeasRange(r)
          if (r === 'cursors') showCursors()
        },
      })),
      ...MEASUREMENT_DEFS.map(
        (d): Command =>
          measKeys.includes(d.key)
            ? { id: `meas:remove:${d.key}`, group: 'Measurements', label: `Remove measurement: ${d.label}`, icon: X, run: () => setMeasKeys(measKeys.filter((k) => k !== d.key)) }
            : {
                id: `meas:add:${d.key}`,
                group: 'Measurements',
                label: `Add measurement: ${d.label}`,
                keywords: d.short,
                icon: Plus,
                run: () => {
                  setMeasKeys([...measKeys, d.key])
                  if (!layout.measurements) toggleMeasurements()
                },
              },
      ),

      ...displays.flatMap((d): (Command | false)[] => {
        const name = `${channelName(d.id)}${d.label ? ` · ${d.label}` : ''}`
        const hasWave = channels.some((c) => c.wave.id === d.id)
        return [
          { id: `ch:select:${d.id}`, group: 'Channel', label: `Select ${name}`, keywords: d.id, color: d.color, checked: selected === d.id, run: () => setSelected(d.id) },
          { id: `ch:settings:${d.id}`, group: 'Channel', label: `Settings of ${name}…`, keywords: d.id, icon: SlidersHorizontal, run: () => channelBarRef.current?.openSettings(d.id) },
          { id: `ch:visible:${d.id}`, group: 'Channel', label: `${d.visible ? 'Hide' : 'Show'} ${name}`, keywords: d.id, icon: d.visible ? EyeOff : Eye, run: () => onAdjust(d.id, { visible: !d.visible }) },
          { id: `ch:only:${d.id}`, group: 'Channel', label: `Show only ${name}`, keywords: d.id, icon: ScanEye, run: () => setDisplays((ds) => ds.map((x) => ({ ...x, visible: x.id === d.id }))) },
          hasWave && { id: `ch:autoscale:${d.id}`, group: 'Channel', label: `Autoscale ${name}`, keywords: d.id, icon: UnfoldVertical, run: () => onAutoscale(d.id) },
        ]
      }),
      displays.some((d) => !d.visible) && { id: 'ch:all', group: 'Channel', label: 'Show all channels', icon: Eye, run: () => setDisplays((ds) => ds.map((x) => ({ ...x, visible: true }))) },

      { id: 'file:open', group: 'File', label: 'Open session file…', icon: FolderOpen, run: onOpen },
      { id: 'file:open-analysis', group: 'File', label: 'Open analysis file…', icon: Upload, run: () => analysisInput.current?.click() },
      { id: 'file:save-analysis', group: 'File', label: 'Save analysis file', icon: FileJson, run: saveAnalysis },
      { id: 'file:save-bundle', group: 'File', label: 'Save session with analysis', keywords: 'bundle scopeview', icon: Archive, run: saveBundle },
      { id: 'file:reset', group: 'File', label: 'Reset to file defaults…', icon: RotateCcw, run: resetToDefaults },
      canInstall && { id: 'file:install', group: 'File', label: 'Install Scope Viewer…', keywords: 'app offline', icon: MonitorDown, run: () => void installApp() },
      { id: 'file:close', group: 'File', label: 'Close session', icon: X, run: onClose },
      ...exports.map(([kind, label, icon]) => (kind !== 'spectra' || hasSpectra) && { id: `export:${kind}`, group: 'Export', label: `Export ${label}`, icon, run: () => openExport(kind) }),

      ...THEME_PREFERENCES.map((t): Command => ({
        id: `theme:${t}`,
        group: 'Appearance',
        label: `Appearance: ${THEME_LABEL[t]}`,
        keywords: 'theme colours mode',
        icon: Palette,
        checked: themePreference === t,
        run: () => setThemePreference(t),
      })),
    ]
    return entries.filter((c): c is Command => !!c)
  }

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
        readoutOn={layout.readout}
        onToggleReadout={toggleReadout}
        canUndo={edits.canUndo}
        canRedo={edits.canRedo}
        onUndo={edits.undo}
        onRedo={edits.redo}
        onExport={openExport}
        hasSpectra={spectra.some((s) => s.visible)}
        onCommands={() => setPaletteOpen(true)}
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
          {layout.overview && (
            <Overview
              channels={channels}
              views={views}
              record={record}
              win={win}
              minSpan={minSpan}
              onNavigate={navigate}
              onContextMenu={overviewMenu}
              callouts={callouts}
              selectedCallout={selectedCallout}
              onJumpToCallout={jumpToCallout}
            />
          )}
          <PlotArea
            ref={plotRef}
            channels={channels}
            views={views}
            win={win}
            record={record}
            minSpan={minSpan}
            tool={tool}
            hint={TOOL_HINT[tool]}
            readout={layout.readout}
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
            onContextMenu={plotMenu}
            onCalloutMenu={calloutMenu}
            onJumpToCallout={jumpToCallout}
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
              onCopy={copy}
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
              channelMenu={(id) => channelItems(id)}
              onCopy={copy}
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
                onContextMenu={calloutMenu}
                onClear={() => {
                  const n = callouts.length
                  setCallouts([])
                  setEditing(null)
                  setSelectedCallout(undefined)
                  offerUndo(`${n} callouts deleted`)
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
                    onOpenStored={onOpenStored}
                    onKeepCurrent={onKeepFiles}
                    filesVersion={filesVersion}
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
        ref={channelBarRef}
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
        onChannelMenu={channelMenu}
        onTimebaseMenu={(e) =>
          openMenu(e, [
            { kind: 'heading', label: 'Horizontal', detail: si(tPerDiv, 's/div', 3) },
            ...viewItems,
            '-',
            { label: 'Session info and setup…', icon: SlidersHorizontal, onClick: () => setPanel('info') },
          ])
        }
      />

      <div className="toast-stack">
        {notice && (
          <div key={notice.id} className="undo-toast notice" role="status">
            {notice.message}
          </div>
        )}
        {toast && (
          <div className="undo-toast" role="status">
            <span>{toast.message}</span>
            <button type="button" className="text-btn" onClick={edits.undo}>
              Undo <kbd>Ctrl+Z</kbd>
            </button>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setUndoToast(null)}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {paletteOpen && <CommandPalette getCommands={paletteCommands} onClose={() => setPaletteOpen(false)} />}

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

/** The part of the workspace that undo/redo restores: everything but the view (window, selection) */
type UndoDoc = Omit<Workspace, 'version' | 'window' | 'selected'>

/** Always the same keys in the same order, so snapshots can be compared as JSON */
function undoDocOf(w: UndoDoc): UndoDoc {
  return {
    channels: w.channels,
    views: w.views,
    math: w.math,
    spectra: w.spectra,
    spectrumOptions: w.spectrumOptions,
    callouts: w.callouts,
    cursors: w.cursors,
    measurements: { keys: w.measurements.keys, range: w.measurements.range },
    notes: w.notes,
  }
}

/** V/div and offset that fit the whole waveform into ~8 divisions */
function autoscalePatch(pyramid: MinMaxPyramid, n: number): DisplayPatch {
  const mm: [number, number] = [0, 0]
  pyramid.range(0, n, mm)
  if (!Number.isFinite(mm[0]) || !Number.isFinite(mm[1])) return {}
  const scale = niceStep(Math.max(mm[1] - mm[0], Math.abs(mm[0]) * 1e-3, 1e-12) / 8)
  // Round the offset to a tenth of a division so it reads nicely
  const offset = Math.round((mm[0] + mm[1]) / 2 / (scale / 10)) * (scale / 10)
  return { scale: parseFloat(scale.toPrecision(6)), offset: parseFloat(offset.toPrecision(6)), position: 0 }
}
