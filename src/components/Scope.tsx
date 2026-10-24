import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Crosshair,
  FileJson,
  FileSpreadsheet,
  FileText,
  Focus,
  FolderOpen,
  GalleryHorizontal,
  HardDrive,
  Home,
  Image,
  Maximize2,
  MonitorDown,
  Redo2,
  RotateCcw,
  Ruler,
  Search,
  Table2,
  Undo2,
  Upload,
  Waves,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { ChannelDisplay, Session } from '../model/types'
import type { MeasurementKey } from '../dsp/measure'
import { DEFAULT_CALLOUT_COLOR, calloutSpan, calloutTitle, hasTimeSpan, newCalloutId, nextCalloutNumber, type Callout } from '../model/callouts'
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
  sanitizeWorkspace,
  type LoadSource,
  type Workspace,
} from '../model/workspace'
import { buildBundle } from '../export/bundle'
import { runExport, waveformRows, type ExportContext, type ExportKind } from '../export/sessionExport'
import { AXIS_GUTTER, DIVS_Y } from '../render/draw'
import { copyText } from '../util/clipboard'
import { downloadBlob, stem } from '../util/download'
import { niceStep } from '../util/format'
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
import { KEYS, TOOLS, TOOL_ORDER } from './keymap'
import { MeasurementTable } from './MeasurementTable'
import { Overview } from './Overview'
import { PlotArea, type NewCallout, type PlotAreaHandle } from './PlotArea'
import { ReferencePanel, type ReferenceSection } from './ReferencePanel'
import { Rail, type PanelId } from './Rail'
import { calloutMenu, channelItems, channelMenu, overviewMenu, paletteCommands, plotMenu, timebaseMenu, type ScopeActions, type ScopeApi } from './scopeCommands'
import { SpectrumView, type SpectrumViewHandle } from './SpectrumView'
import { StorageSection } from './StorageSection'
import { TopBar } from './TopBar'
import { cursorsInView, sampleRange, timeTicks, type CursorState, type DisplayPatch, type LiveChannel, type MeasureRange, type TimeWindow, type Tool } from '../model/view'
import type { Action } from './ui/action'
import { useFeedback } from './ui/feedbackContext'
import { useContextMenu } from './ui/menuContext'
import { useTheme } from './ui/themeContext'
import { UndoHistory } from '../model/undoHistory'
import { useAutosave } from './useAutosave'
import { useNavigation } from './useNavigation'
import { useShortcuts } from './useShortcuts'
import { useUndoHistory } from './useUndoHistory'

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
  const { confirm, notify, dismiss } = useFeedback()
  // Everything the user can change starts from the workspace (saved state, analysis file or file defaults)
  const [boot] = useState(() => initWorkspace(session, initial))
  const ws0 = boot.workspace
  // Undo history of the analysis (recorded in "undo / redo" below)
  const [editHistory] = useState(() => new UndoHistory(undoDocOf(ws0)))

  const pyramids = useMemo(() => new Map(session.channels.map((c) => [c.wave.id, new MinMaxPyramid(c.wave.data)])), [session])
  const [mathDefs, setMathDefs] = useState<MathDef[]>(ws0.math)
  const [displays, setDisplays] = useState<ChannelDisplay[]>(ws0.channels)
  const [views, setViews] = useState<string[][]>(ws0.views)
  const [tool, setTool] = useState<Tool>('pan')
  const [cursors, setCursors] = useState<CursorState>(ws0.cursors)
  const [selected, setSelected] = useState<string | undefined>(ws0.selected)
  const [notes, setNotes] = useState(ws0.notes)
  const [measRange, setMeasRange] = useState<MeasureRange>(ws0.measurements.range)
  const [measKeys, setMeasKeys] = useState<MeasurementKey[]>(ws0.measurements.keys)
  const [callouts, setCallouts] = useState<Callout[]>(ws0.callouts)
  const [selectedCallout, setSelectedCallout] = useState<string | undefined>()
  const [editing, setEditing] = useState<{ id: string; isNew: boolean } | null>(null)
  const [spectra, setSpectra] = useState<SpectrumDef[]>(ws0.spectra)
  const [specOptions, setSpecOptions] = useState<SpectrumOptions>(ws0.spectrumOptions)
  const plotRef = useRef<PlotAreaHandle>(null)
  const spectrumRef = useRef<SpectrumViewHandle>(null)
  const channelBarRef = useRef<ChannelBarHandle>(null)
  const analysisInput = useRef<HTMLInputElement>(null)

  // ---------- layout ----------
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

  // ---------- channels and math channels ----------
  const mathResults = useMemo(() => evaluateMath(mathDefs, session.channels.map((c) => c.wave)), [mathDefs, session])
  const mathPyramids = useMemo(() => {
    const m = new Map<string, MinMaxPyramid>()
    for (const [id, r] of mathResults) if (r.wave) m.set(id, new MinMaxPyramid(r.wave.data))
    return m
  }, [mathResults])

  const displayById = useMemo(() => new Map(displays.map((d) => [d.id, d])), [displays])
  const inputChannels: LiveChannel[] = useMemo(
    () => session.channels.map((c) => ({ wave: c.wave, display: displayById.get(c.wave.id)!, input: c.input, pyramid: pyramids.get(c.wave.id)! })),
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
  const visibleChannels = channels.filter((c) => c.display.visible)
  const firstId = session.channels[0].wave.id

  const onAdjust = useCallback((id: string, patch: DisplayPatch) => {
    setDisplays((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }, [])
  const showOnly = (id: string) => setDisplays((ds) => ds.map((x) => ({ ...x, visible: x.id === id })))
  const showAll = () => setDisplays((ds) => ds.map((x) => ({ ...x, visible: true })))
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
  const openSettings = (id: string) => channelBarRef.current?.openSettings(id)

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
    const a = vis[0] ?? firstId
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
  /** Delete a math channel with everything that refers to it: its spectra and the callouts on its trace */
  const removeMath = (id: string) => {
    const onIt = (c: Callout) => c.channel === id || c.channel2 === id
    const attached = callouts.filter(onIt).length
    offerUndo(`${channelName(id)} deleted${attached ? ` with ${attached} callout${attached > 1 ? 's' : ''}` : ''}`)
    setMathDefs((ms) => ms.filter((m) => m.id !== id))
    setDisplays((ds) => ds.filter((d) => d.id !== id))
    setViews((vs) => vs.map((v) => v.filter((x) => x !== id)).filter((v) => v.length > 0))
    setSpectra((ss) => ss.filter((s) => s.source !== id))
    // Notes, boxes and spans on its trace go with it; regions and boxes stop measuring it
    setCallouts((cs) => cs.filter((c) => !onIt(c)).map((c) => (c.measure?.channel === id ? { ...c, measure: undefined } : c)))
    if (selectedCallout && callouts.some((c) => c.id === selectedCallout && onIt(c))) setSelectedCallout(undefined)
    if (editing && callouts.some((c) => c.id === editing.id && onIt(c))) setEditing(null)
    if (selected === id) setSelected(firstId)
    if (cursors.source === id) setCursors({ ...cursors, source: firstId })
  }

  // ---------- navigation ----------
  const nav = useNavigation(session, ws0.window, displays, setDisplays)
  const { win, record, minSpan } = nav
  const ticks = timeTicks(win)
  const tPerDiv = ticks.length > 1 ? ticks[1] - ticks[0] : (win.end - win.start) / 10

  // ---------- callouts ----------
  const addCallout = (nc: NewCallout) => {
    // A note takes the colour of its trace; boxes and spans stand out in colours of their own
    const ch = nc.type === 'note' && nc.channel ? displayById.get(nc.channel) : undefined
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
  /** The time window around a callout: its time span with some room, or the current width centred on it */
  const calloutWindow = (c: Callout): TimeWindow => {
    const [a, b] = calloutSpan(c)
    if (!hasTimeSpan(c)) return { start: c.t - (win.end - win.start) / 2, end: c.t + (win.end - win.start) / 2 }
    const pad = Math.max((b - a) * 0.15, minSpan)
    return { start: a - pad, end: b + pad }
  }
  const jumpToCallout = (c: Callout) => {
    nav.zoomTo(calloutWindow(c))
    setSelectedCallout(c.id)
  }
  /** Zoom to a box: its time span, and its channel scaled so the box fills most of the view */
  const zoomToBox = (c: Callout) => {
    const d = c.channel ? displayById.get(c.channel) : undefined
    if (!d || c.v === undefined || c.v2 === undefined || c.v === c.v2) return jumpToCallout(c)
    const span = Math.abs(c.v - c.v2)
    const scale = parseFloat((span / (DIVS_Y * 0.7)).toPrecision(4))
    nav.zoomTo(calloutWindow(c), [{ id: d.id, patch: { scale, offset: parseFloat(((c.v + c.v2) / 2).toPrecision(6)), position: 0 } }])
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

  // ---------- cursors ----------
  /** "Between cursors" needs visible cursors: turn them on, in the current view if they are off-screen */
  const showCursors = () => {
    if (cursors.on) return
    const inView = (t: number) => t >= win.start && t <= win.end
    setCursors(inView(cursors.a) && inView(cursors.b) ? { ...cursors, on: true } : cursorsInView(cursors, win))
  }
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
  const changeMeasRange = (r: MeasureRange) => {
    setMeasRange(r)
    if (r === 'cursors') showCursors()
  }

  // ---------- spectra ----------
  const spectrumSources = useMemo(() => new Set(spectra.map((s) => s.source)), [spectra])
  const addSpectrum = (source?: string) => {
    if (spectra.length >= MAX_SPECTRA) return
    const src = source ?? (selected && channels.some((c) => c.wave.id === selected) ? selected : firstId)
    setSpectra([...spectra, newSpectrum(spectra, src)])
  }
  /** Show the spectrum of a channel, or remove it again */
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

  // ---------- notices ----------
  const copy = async (text: string, what: string) => {
    const ok = await copyText(text)
    notify(ok ? { message: `${what} copied` } : { message: 'This browser does not allow copying here', kind: 'error' })
  }
  // A deletion offers Undo in a notice, which goes once something else changes
  const undoNotice = useRef<{ id: number; steps: number } | null>(null)
  const offerUndo = (message: string) => {
    undoNotice.current = { id: notify({ message, action: { label: 'Undo', hint: KEYS.undo, run: () => edits.undo() }, timeout: 8000 }), steps: editHistory.started }
  }
  const dropUndoNotice = useCallback(() => {
    if (undoNotice.current) dismiss(undoNotice.current.id)
    undoNotice.current = null
  }, [dismiss])
  useEffect(() => dropUndoNotice, [dropUndoNotice])

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
    if (selected && !d.channels.some((c) => c.id === selected)) setSelected(firstId)
    if (editing && !d.callouts.some((c) => c.id === editing.id)) setEditing(null)
    if (selectedCallout && !d.callouts.some((c) => c.id === selectedCallout)) setSelectedCallout(undefined)
    dropUndoNotice()
  })
  // The Undo of a deletion applies only while the deletion is the latest step
  useEffect(() => {
    const u = undoNotice.current
    if (u && edits.steps > u.steps + 1) dropUndoNotice()
  }, [edits.steps, dropUndoNotice])

  const { status: saveStatus, cancel: cancelSave } = useAutosave(session, workspace, boot)

  const saveAnalysis = () => {
    downloadBlob(new Blob([analysisToJson(session, workspace)], { type: 'application/json' }), `${stem(session.fileName)}${ANALYSIS_EXT}`)
  }
  const saveBundle = async () => {
    try {
      const files = await Promise.all(sources.map(async (s) => ({ name: s.name, data: await s.blob.arrayBuffer() })))
      downloadBlob(buildBundle(files, analysisToJson(session, workspace)), `${stem(session.fileName)}${BUNDLE_EXT}`)
    } catch (e) {
      notify({ kind: 'error', message: `Could not save the bundle: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const resetToDefaults = async () => {
    const ok = await confirm({
      title: 'Reset to the file defaults?',
      message: 'Your changes to this session (channel settings, math channels, spectra, callouts, notes) are discarded and it is shown as saved on the scope.',
      confirmLabel: 'Reset',
      danger: true,
    })
    if (!ok) return
    cancelSave()
    if (session.fingerprint) deleteStoredSession(session.fingerprint)
    onReplaceWorkspace({ kind: 'defaults' })
  }
  const importAnalysisFile = async (file: File) => {
    try {
      const parsed = parseAnalysisJson(await file.text())
      const foreign = parsed.fingerprint && session.fingerprint && parsed.fingerprint !== session.fingerprint
      if (parsed.kind === 'callouts') {
        if (foreign && !(await confirm({ title: 'Add the callouts?', message: 'They were saved for a different session file.', confirmLabel: 'Add them' }))) return
        const ids = new Set(parsed.callouts.map((c) => c.id))
        setCallouts((cs) => [...cs.filter((c) => !ids.has(c.id)), ...parsed.callouts])
        setPanel('callouts')
        return
      }
      const ok = await confirm({
        title: 'Replace your changes with the analysis?',
        message: foreign ? `The analysis was saved for ${parsed.sessionFile ?? 'a different file'}, not for ${session.fileName}.` : undefined,
        confirmLabel: 'Replace',
        danger: true,
      })
      if (!ok) return
      cancelSave()
      onReplaceWorkspace({ kind: 'analysis', workspace: parsed.workspace })
    } catch (e) {
      notify({ kind: 'error', message: `Could not open the analysis file: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  useImperativeHandle(ref, () => ({ importAnalysisFile }))

  // ---------- exports ----------
  const [exportKind, setExportKind] = useState<ExportKind | null>(null)
  const [exportPlotSize, setExportPlotSize] = useState({ w: 0, h: 0 })
  const openExport = (kind: ExportKind) => {
    setExportPlotSize(plotRef.current?.size() ?? { w: 0, h: 0 })
    setExportKind(kind)
  }
  const exportContext = (): ExportContext => ({
    session,
    channels,
    math: mathItems,
    callouts,
    cursors,
    win,
    record,
    minDt: nav.minDt,
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
  const hasSpectra = spectra.some((s) => s.visible)

  // ---------- actions: toolbar, menus, command palette and keyboard ----------
  const [paletteOpen, setPaletteOpen] = useState(false)
  const canInstall = useCanInstall()
  const mid = (win.start + win.end) / 2
  const tools = Object.fromEntries(
    TOOL_ORDER.map((t): [Tool, Action] => {
      const def = TOOLS[t]
      // Choosing the active tool again goes back to Pan
      return [t, { label: def.label, icon: def.icon, hint: def.key, checked: tool === t, run: () => setTool(tool === t ? 'pan' : t) }]
    }),
  ) as Record<Tool, Action>
  const exportAction = (kind: ExportKind, label: string, icon: Action['icon'], disabled = false): Action => ({ label, icon, disabled, run: () => openExport(kind) })
  const actions: ScopeActions = {
    tools,
    undo: { label: 'Undo', icon: Undo2, hint: KEYS.undo, disabled: !edits.canUndo, run: edits.undo },
    redo: { label: 'Redo', icon: Redo2, hint: KEYS.redo, disabled: !edits.canRedo, run: edits.redo },
    back: { label: 'Back to the previous view', icon: ArrowLeft, hint: KEYS.back, disabled: !nav.canGoBack, run: nav.zoomBack },
    savedView: { label: 'Saved view', icon: Home, title: 'The view the scope showed when the session was saved', run: () => nav.zoomTo(nav.savedWin) },
    fullRecord: { label: 'Full record', icon: Maximize2, hint: KEYS.fullRecord, disabled: !nav.zoomed, run: () => nav.zoomTo(record) },
    zoomIn: { label: 'Zoom in', icon: ZoomIn, hint: KEYS.zoomIn, run: () => nav.zoomAt(mid, 0.5) },
    zoomOut: { label: 'Zoom out', icon: ZoomOut, hint: KEYS.zoomOut, run: () => nav.zoomAt(mid, 2) },
    cursors: { label: 'Cursors', icon: Ruler, hint: KEYS.cursors, checked: cursors.on, run: () => setCursors({ ...cursors, on: !cursors.on }) },
    cursorsHere: { label: 'Bring the cursors into the view', icon: Ruler, run: () => setCursors(cursorsInView(cursors, win)) },
    readout: { label: 'Values at the pointer', icon: Crosshair, hint: KEYS.readout, checked: layout.readout, run: toggleReadout },
    overview: { label: 'Overview strip', icon: GalleryHorizontal, hint: KEYS.overview, checked: layout.overview, run: toggleOverview },
    measurements: { label: 'Measurement table', icon: Table2, hint: KEYS.measurements, checked: layout.measurements, run: toggleMeasurements },
    focus: { label: 'Focus: hide all panels', icon: Focus, hint: KEYS.focus, checked: focusMode, run: toggleFocus },
    prevCallout: { label: 'Previous callout', icon: ArrowLeft, hint: KEYS.prevCallout, disabled: !callouts.length, run: () => stepCallout(-1) },
    nextCallout: { label: 'Next callout', icon: ArrowRight, hint: KEYS.nextCallout, disabled: !callouts.length, run: () => stepCallout(1) },
    palette: { label: 'Commands', icon: Search, hint: KEYS.palette, run: () => setPaletteOpen(true) },
    open: { label: 'Open session file…', icon: FolderOpen, run: onOpen },
    openAnalysis: { label: 'Open analysis file…', icon: Upload, run: () => analysisInput.current?.click() },
    saveAnalysis: { label: 'Save analysis file', icon: FileJson, run: saveAnalysis },
    saveBundle: { label: 'Save session with analysis', icon: Archive, run: saveBundle },
    reset: { label: 'Reset to file defaults…', icon: RotateCcw, run: resetToDefaults },
    storage: { label: 'Saved in this browser…', icon: HardDrive, run: () => setPanel('info') },
    install: { label: 'Install Scope Viewer…', icon: MonitorDown, disabled: !canInstall, run: () => void installApp() },
    close: { label: 'Close session', icon: X, run: onClose },
    exports: {
      image: exportAction('image', 'Image (PNG)…', Image),
      report: exportAction('report', 'Report (HTML, PDF)…', FileText),
      waveforms: exportAction('waveforms', 'Waveform data (CSV)…', Waves),
      measurements: exportAction('measurements', 'Measurements (CSV)…', Table2),
      spectra: exportAction('spectra', 'Spectra (CSV)…', FileSpreadsheet, !hasSpectra),
    },
  }

  const { preference: themePreference, setPreference: setThemePreference } = useTheme()
  const api: ScopeApi = {
    session,
    actions,
    channels,
    displays,
    views,
    mathDefs,
    spectra,
    callouts,
    cursors,
    win,
    record,
    selected,
    measKeys,
    measRange,
    panel: layout.panel,
    measurementsShown: layout.measurements,
    themePreference,
    setThemePreference,
    select: setSelected,
    adjust: onAdjust,
    showOnly,
    showAll,
    autoscale: onAutoscale,
    moveToView: onMoveToView,
    toggleSpectrum,
    addSpectrum: () => addSpectrum(),
    addMath: () => {
      const id = addMath()
      // Open its editor once its badge is there
      if (id) requestAnimationFrame(() => openSettings(id))
    },
    removeMath,
    openSettings,
    setCursors,
    placeCursor,
    zoomAt: nav.zoomAt,
    zoomTo: (w) => nav.zoomTo(w),
    addCallout,
    editCallout,
    updateCallout,
    deleteCallout,
    jumpToCallout,
    zoomToBox,
    duplicateCallout,
    setMeasKeys,
    setMeasRange: changeMeasRange,
    setPanel,
    openReference,
    copy,
  }

  const openMenu = useContextMenu()
  const selectedDisplay = selected ? displayById.get(selected) : undefined
  useShortcuts({
    enabled: !exportKind,
    paletteOpen,
    togglePalette: () => setPaletteOpen((o) => !o),
    actions,
    selectedCallout,
    selectedDisplay,
    adjust: onAdjust,
    editCallout,
    deleteCallout,
    nudgeCallout,
    pan: (share) => {
      const d = (win.end - win.start) * share
      nav.navigate({ start: win.start + d, end: win.end + d }, 'pan')
    },
    cancel: () => {
      setTool('pan')
      setSelectedCallout(undefined)
    },
  })

  return (
    <div className="scope">
      <TopBar fileName={session.fileName} saveStatus={saveStatus} actions={actions} />
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

      <div className="workspace">
        <main className="main">
          {layout.overview && (
            <Overview
              channels={channels}
              views={views}
              record={record}
              win={win}
              minSpan={minSpan}
              onNavigate={nav.navigate}
              onContextMenu={(e, t) => openMenu(e, overviewMenu(api, t))}
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
            hint={TOOLS[tool].hint}
            readout={layout.readout}
            onNavigate={nav.navigate}
            onZoomTo={nav.zoomTo}
            cursors={cursors}
            setCursors={setCursors}
            selected={selected}
            setSelected={setSelected}
            trigger={session.trigger}
            onAdjust={onAdjust}
            onMoveToView={onMoveToView}
            onChannelSettings={openSettings}
            onChannelMenu={(e, id) => openMenu(e, channelMenu(api, id))}
            callouts={callouts}
            selectedCallout={selectedCallout}
            editingCallout={editing?.id}
            onSelectCallout={setSelectedCallout}
            onAddCallout={addCallout}
            onUpdateCallout={updateCallout}
            onEditCallout={editCallout}
            onDeleteCallout={deleteCallout}
            onContextMenu={(e, at) => {
              if (at.channel) setSelected(at.channel)
              openMenu(e, plotMenu(api, at))
            }}
            onCalloutMenu={(e, c) => openMenu(e, calloutMenu(api, c))}
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
              setRange={changeMeasRange}
              keys={measKeys}
              setKeys={setMeasKeys}
              height={layout.measHeight}
              setHeight={(measHeight) => setLayout((l) => ({ ...l, measHeight }))}
              onClose={toggleMeasurements}
              onOpenReference={(key) => openReference('measurements', key)}
              channelMenu={(id) => channelItems(api, id)}
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
                tools={tools}
                tool={tool}
                onSelect={setSelectedCallout}
                onUpdate={updateCallout}
                onDelete={deleteCallout}
                onJump={jumpToCallout}
                onContextMenu={(e, c) => openMenu(e, calloutMenu(api, c))}
                onClear={() => {
                  const n = callouts.length
                  setCallouts([])
                  setEditing(null)
                  setSelectedCallout(undefined)
                  offerUndo(`${n} callout${n > 1 ? 's' : ''} deleted`)
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

        <Rail panel={layout.panel} setPanel={setPanel} actions={actions} calloutCount={callouts.length} />
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
        sampleRate={1 / nav.minDt}
        recordLength={session.channels[0].wave.data.length}
        trigger={session.trigger}
        onChannelMenu={(e, id) => openMenu(e, channelMenu(api, id))}
        onTimebaseMenu={(e) => openMenu(e, timebaseMenu(api, tPerDiv))}
      />

      {paletteOpen && <CommandPalette getCommands={() => paletteCommands(api)} onClose={() => setPaletteOpen(false)} />}

      {exportKind && (
        <ExportDialog
          initial={exportKind}
          onClose={() => setExportKind(null)}
          hasSpectra={hasSpectra}
          cursorsOn={cursors.on}
          waveformRows={(o) => waveformRows(exportContext(), o)}
          plotSize={exportPlotSize}
          measurementInfo={{ range: measRange, count: measKeys.length, channels: measuredCount }}
          notes={notes}
          setNotes={setNotes}
          defaultTitle={stem(session.fileName)}
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
