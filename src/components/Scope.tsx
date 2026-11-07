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
  UnfoldVertical,
  Upload,
  Waves,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { Session } from '../model/types'
import type { MeasurementKey } from '../dsp/measure'
import { adjacentCallout, boxZoomPatch, calloutTitle, calloutWindow, calloutsOn, isOffRecord, type Callout, type NewCallout } from '../model/callouts'
import type { MinMaxPyramid } from '../dsp/minmax'
import { ComputeEngine } from '../compute/engine'
import { AnalysisStore } from '../model/analysisStore'
import * as edits from '../model/edits'
import type { MathDef } from '../model/math'
import { MAX_SPECTRA, spectrumSource, type SpectrumDef } from '../model/spectrum'
import {
  ANALYSIS_EXT,
  BUNDLE_EXT,
  analysisOf,
  analysisToJson,
  defaultWorkspace,
  deleteStoredSession,
  loadWorkspace,
  parseAnalysisJson,
  sanitizeWorkspace,
  workspaceOf,
  type Analysis,
  type LoadSource,
  type Workspace,
} from '../model/workspace'
import { announce, onNews } from '../model/tabSync'
import { buildBundle } from '../export/bundle'
import { measuredChannels } from '../export/measureRows'
import { runExport, waveformRows, type ExportContext, type ExportKind } from '../export/sessionExport'
import { AXIS_GUTTER, DIVS_Y } from '../render/draw'
import { copyText } from '../util/clipboard'
import { downloadBlob, stem } from '../util/download'
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
import { PlotArea, type PlotAreaHandle } from './PlotArea'
import { ReferencePanel, type ReferenceSection } from './ReferencePanel'
import { Rail, type PanelId } from './Rail'
import { calloutMenu, channelItems, channelMenu, overviewMenu, paletteCommands, plotMenu, timebaseMenu, type ScopeActions, type ScopeApi } from './scopeCommands'
import { SpectrumView, type SpectrumViewHandle } from './SpectrumView'
import { StorageSection } from './StorageSection'
import { TopBar } from './TopBar'
import {
  shownViews,
  cursorsInView,
  sampleRange,
  timeTicks,
  type CursorState,
  type DisplayPatch,
  type LiveChannel,
  type MeasureRange,
  type TimeWindow,
  type Tool,
} from '../model/view'
import type { Action } from './ui/action'
import { useFeedback } from './ui/feedbackContext'
import { useContextMenu } from './ui/menuContext'
import { useTheme } from './ui/themeContext'
import { UndoHistory } from '../model/undoHistory'
import { AnalysisContext, useStoreAnalysis } from './analysisContext'
import { useAutosave } from './useAutosave'
import { useMathResults } from './useMathResults'
import { useNavigation } from './useNavigation'
import { useShortcuts } from './useShortcuts'
import { useUndoHistory } from './useUndoHistory'

const PANEL_TITLE: Record<PanelId, string> = { cursors: 'Cursors', callouts: 'Callouts', info: 'Session', reference: 'Reference' }

interface Layout {
  panel: PanelId | null
  overview: boolean
  measurements: boolean
  /** The measurement table is as high as its rows need, but at most this high; null: at most a share of the window */
  measHeight: number | null
  specHeight: number
  /** Values of all channels next to the pointer */
  readout: boolean
}
const DEFAULT_LAYOUT: Layout = { panel: null, overview: true, measurements: true, measHeight: null, specHeight: 220, readout: true }
/** The fixed height the measurement table had before it fitted its rows: stored by everyone who never resized it, and no limit */
const FORMER_MEAS_HEIGHT = 170

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
  /** Min/max pyramids of the session's channels (built while parsing) */
  pyramids: Map<string, MinMaxPyramid>
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

/**
 * The workspace a session starts with, built as the workspace is from then on (workspaceOf), so
 * autosave can tell whether it changed; and when its analysis was changed (see tabSync).
 */
function initWorkspace(session: Session, initial: InitialState): { workspace: Workspace; source: LoadSource | 'file'; changedAt: number } {
  const start = startWorkspace(session, initial)
  const ws = start.workspace
  return { ...start, workspace: workspaceOf(analysisOf(ws), ws.window, ws.selected) }
}

function startWorkspace(session: Session, initial: InitialState): { workspace: Workspace; source: LoadSource | 'file'; changedAt: number } {
  // Replacing the saved state (reset, an analysis file, callouts added from a file) is a change made now
  const now = Date.now()
  if (initial.kind === 'defaults') return { workspace: defaultWorkspace(session), source: 'default', changedAt: now }
  if (initial.kind === 'analysis') return { workspace: sanitizeWorkspace(initial.workspace, session), source: 'file', changedAt: now }
  const loaded = loadWorkspace(session)
  if (!initial.addCallouts?.length) return loaded
  const ids = new Set(initial.addCallouts.map((c) => c.id))
  return {
    workspace: { ...loaded.workspace, callouts: [...loaded.workspace.callouts.filter((c) => !ids.has(c.id)), ...initial.addCallouts] },
    source: 'file',
    changedAt: now,
  }
}

export const Scope = forwardRef<ScopeHandle, Props>(function Scope({ session, pyramids, sources, initial, onOpen, onClose, onReplaceWorkspace, onOpenStored, onKeepFiles, filesVersion }, ref) {
  const { confirm, notify, dismiss } = useFeedback()
  // Everything the user can change starts from the workspace (saved state, analysis file or file defaults)
  const [boot] = useState(() => initWorkspace(session, initial))
  const ws0 = boot.workspace
  // The analysis is one document in a store: the components follow it, undo restores it, autosave keeps
  // it and other tabs share it (the view on it, the time window and the selected channel, is not part
  // of it). It is changed with the functions of edits.ts: `update((a) => edits.addMath(a, ids))`.
  const [store] = useState(() => new AnalysisStore(analysisOf(ws0), boot.changedAt))
  const doc = useStoreAnalysis(store)
  const update = store.update
  const { math: mathDefs, channels: displays, views, cursors, notes, callouts, spectra, spectrumOptions: specOptions } = doc
  const { keys: measKeys, range: measRange, exclude: measExclude } = doc.measurements
  const setCursors = useCallback((c: CursorState) => update((a) => edits.setCursors(a, c)), [update])
  const setNotes = useCallback((text: string) => update((a) => edits.setNotes(a, text)), [update])
  const setMeasKeys = (keys: MeasurementKey[]) => update((a) => edits.setMeasurementKeys(a, keys))
  const setMeasExclude = (change: string[] | ((ids: string[]) => string[])) => update((a) => edits.setMeasurementExclude(a, change))
  // Undo history of the analysis (recorded in "undo / redo" below)
  const [editHistory] = useState(() => new UndoHistory<Analysis, TimeWindow>(doc))

  const [tool, setTool] = useState<Tool>('pan')
  const [selected, setSelected] = useState<string | undefined>(ws0.selected)
  const [selectedCallout, setSelectedCallout] = useState<string | undefined>()
  const [editing, setEditing] = useState<{ id: string; isNew: boolean } | null>(null)
  const plotRef = useRef<PlotAreaHandle>(null)
  const spectrumRef = useRef<SpectrumViewHandle>(null)
  const channelBarRef = useRef<ChannelBarHandle>(null)
  /** The view outlined in the plot while the pointer is on its channels in the channel bar */
  const [highlightView, setHighlightView] = useState<number | undefined>()
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
  // Math channels, spectra and measurements of long ranges are computed in a worker, so long records
  // do not block the page; the worker starts with the first such job and ends with the workspace
  const [engine] = useState(() => new ComputeEngine(session.channels.map((c) => c.wave), pyramids))
  useEffect(() => () => engine.stop(), [engine])
  const math = useMathResults(engine, mathDefs)
  const { results: mathResults, pyramids: mathPyramids } = math

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
  /** A view whose channels are all hidden is left out of the plot */
  const viewsShown = useMemo(() => shownViews(views, (id) => !!displayById.get(id)?.visible), [views, displayById])
  const firstId = session.channels[0].wave.id

  const onAdjust = useCallback((id: string, patch: DisplayPatch) => update((a) => edits.patchChannel(a, id, patch)), [update])
  /** Change a channel's settings from its badge or a menu (a new colour also goes to the notes on its trace) */
  const adjustChannel = (id: string, patch: DisplayPatch) => update((a) => edits.adjustChannel(a, id, patch))
  const showOnly = (id: string) => update((a) => edits.showOnly(a, id))
  const showAll = () => update(edits.showAll)
  const onMoveToView = (id: string, view: number) => update((a) => edits.moveToView(a, id, view))
  const openSettings = (id: string) => channelBarRef.current?.openSettings(id)

  // ---------- navigation ----------
  // A zoom that scales channels (or Back from it) is an undo step that takes the window with it
  const nav = useNavigation(
    session,
    ws0.window,
    displays,
    (patches) => update((a) => edits.patchChannels(a, patches)),
    (from, to) => editHistory.moveView(from, to),
  )
  const { win, record, minSpan } = nav
  const ticks = timeTicks(win)
  const tPerDiv = ticks.length > 1 ? ticks[1] - ticks[0] : (win.end - win.start) / 10

  /** Fit channels into their views (one undo step): what is in `range`, by default what is on screen */
  const autoscale = (ids: string[], range: TimeWindow = win) => update((a) => edits.autoscale(a, channels, ids, range, DIVS_Y))
  const onAutoscale = (id: string) => autoscale([id])

  // New or changed math channels are fitted over the whole record once the result of their expression is available
  const pendingAutoscale = useRef(new Map<string, string>())
  useEffect(() => {
    const ready = [...pendingAutoscale.current].filter(([id, expr]) => math.defs.some((d) => d.id === id && d.expr === expr)).map(([id]) => id)
    if (!ready.length) return
    for (const id of ready) pendingAutoscale.current.delete(id)
    update((a) => edits.autoscale(a, channels, ready, record, DIVS_Y))
  }, [math.defs, channels, record, update])

  const addMath = (): string | undefined => {
    const added = edits.addMath(store.get(), session.channels.map((c) => c.wave.id))
    if (!added) return undefined
    update(added.doc)
    setSelected(added.id)
    pendingAutoscale.current.set(added.id, added.expr)
    return added.id
  }
  const changeMath = (id: string, patch: Partial<MathDef>) => {
    update((a) => edits.changeMath(a, id, patch))
    if (patch.expr !== undefined) pendingAutoscale.current.set(id, patch.expr)
  }
  /** Delete a math channel with everything that refers to it: its spectra and the callouts on its trace */
  const removeMath = (id: string) => {
    const attached = calloutsOn(callouts, id)
    offerUndo(`${channelName(id)} deleted${attached.length ? ` with ${attached.length} callout${attached.length > 1 ? 's' : ''}` : ''}`)
    update((a) => edits.removeMath(a, id, firstId))
    // Nothing may stay selected or open that went with the channel
    if (selectedCallout && attached.some((c) => c.id === selectedCallout)) setSelectedCallout(undefined)
    if (editing && attached.some((c) => c.id === editing.id)) setEditing(null)
    if (selected === id) setSelected(firstId)
  }

  // ---------- callouts ----------
  const addCallout = (nc: NewCallout) => {
    const { doc: next, callout } = edits.addCallout(store.get(), nc)
    update(next)
    setSelectedCallout(callout.id)
    setEditing({ id: callout.id, isNew: true })
    setTool('pan')
  }
  const updateCallout = useCallback((id: string, patch: Partial<Callout>) => update((a) => edits.updateCallout(a, id, patch)), [update])
  /** Delete a callout; offers undo unless `silent` (an empty new note that is discarded) */
  const deleteCallout = (id: string, silent = false) => {
    const c = callouts.find((x) => x.id === id)
    // Its own step, also for a new callout whose step is still open (Delete in its editor), so the Undo offered brings it back
    if (!silent) editHistory.commit()
    update((a) => edits.deleteCallout(a, id))
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
    // Finishing the editor: a new note without text is discarded (and with it the undo step that added it)
    const c = editing && callouts.find((x) => x.id === editing.id)
    if (editing?.isNew && c?.type === 'note' && !c.text.trim()) deleteCallout(c.id, true)
    setEditing(null)
  }
  /** Go to a callout: its time span with some room. One placed off the record (zoomed out beyond it) is shown where it is */
  const jumpToCallout = (c: Callout) => {
    nav.zoomTo(calloutWindow(c, win, minSpan), [], isOffRecord(c, record))
    setSelectedCallout(c.id)
  }
  /** Zoom to a box: its time span, and its channel scaled so the box fills most of the view */
  const zoomToBox = (c: Callout) => {
    const zoom = boxZoomPatch(c, c.channel ? displayById.get(c.channel) : undefined, DIVS_Y)
    if (!zoom) return jumpToCallout(c)
    nav.zoomTo(calloutWindow(c, win, minSpan), [zoom], isOffRecord(c, record))
    setSelectedCallout(c.id)
  }
  /** A copy of a callout, a little later in time, selected */
  const duplicateCallout = (c: Callout) => {
    const { doc: next, callout } = edits.duplicateCallout(store.get(), c, (win.end - win.start) * 0.03)
    update(next)
    setSelectedCallout(callout.id)
  }
  /** Move a callout by one pixel of the current view */
  const nudgeCallout = (id: string, dir: -1 | 1) => {
    const plotW = Math.max(1, (plotRef.current?.size().w ?? 1000) - AXIS_GUTTER)
    update((a) => edits.shiftCallout(a, id, (dir * (win.end - win.start)) / plotW))
  }
  /** Go to the previous / next callout in time: from the selected one, else from the middle of the view */
  const stepCallout = (dir: -1 | 1) => {
    const next = adjacentCallout(callouts, selectedCallout, (win.start + win.end) / 2, dir)
    if (next) jumpToCallout(next)
  }

  // ---------- cursors ----------
  /** Put cursor A or B at `t`; when the cursors come on, the other one is moved into view if needed */
  const placeCursor = (which: 'a' | 'b', t: number) => update((a) => edits.placeCursor(a, which, t, win))
  const changeMeasRange = (r: MeasureRange) => update((a) => edits.setMeasurementRange(a, r, win))

  // ---------- spectra ----------
  const spectrumSources = useMemo(() => new Set(spectra.map((s) => s.source)), [spectra])
  /** A spectrum was just added: bring the spectrum view into sight (in a narrow window it is below the plot) */
  const revealSpectrum = useRef(false)
  const addSpectrum = (source?: string) => {
    if (spectra.length >= MAX_SPECTRA) return
    const src = source ?? spectrumSource(channels.map((c) => ({ id: c.wave.id, visible: c.display.visible })), spectra, selected) ?? firstId
    revealSpectrum.current = true
    update((a) => edits.addSpectrum(a, src))
  }
  useEffect(() => {
    if (!revealSpectrum.current) return
    revealSpectrum.current = false
    spectrumRef.current?.reveal()
  }, [spectra])
  /** Show the spectrum of a channel, or remove it again */
  const toggleSpectrum = (source: string) => {
    if (spectrumSources.has(source)) update((a) => edits.toggleSpectrum(a, source))
    else addSpectrum(source)
  }
  const changeSpectrum = (id: string, patch: Partial<SpectrumDef>) => update((a) => edits.changeSpectrum(a, id, patch))

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
    undoNotice.current = { id: notify({ message, action: { label: 'Undo', hint: KEYS.undo, run: () => undoRedo.undo() }, timeout: 8000 }), steps: editHistory.started }
  }
  const dropUndoNotice = useCallback(() => {
    if (undoNotice.current) dismiss(undoNotice.current.id)
    undoNotice.current = null
  }, [dismiss])
  useEffect(() => dropUndoNotice, [dropUndoNotice])

  // ---------- workspace: autosave, analysis files, reset ----------
  const workspace: Workspace = useMemo(() => workspaceOf(doc, win, selected), [doc, win, selected])

  /** Nothing may stay selected or open that a restored or taken-over analysis does not have */
  const keepSelectionsIn = (d: Analysis) => {
    if (selected && !d.channels.some((c) => c.id === selected)) setSelected(firstId)
    if (editing && !d.callouts.some((c) => c.id === editing.id)) setEditing(null)
    if (selectedCallout && !d.callouts.some((c) => c.id === selectedCallout)) setSelectedCallout(undefined)
    dropUndoNotice()
  }

  // ---------- undo / redo ----------
  // Every change of the analysis is a step; the time window and the selection are navigation
  // (Back / Backspace) and not part of it, except that a step in which a zoom scaled channels
  // restores the window with it. A new callout and what is written into it while its editor is
  // open are one step.
  const undoRedo = useUndoHistory(
    editHistory,
    store,
    (d, view) => {
      if (view) nav.show(view)
      update(d)
      keepSelectionsIn(d)
    },
    !!editing?.isNew,
  )
  // The Undo of a deletion applies only while the deletion is the latest step
  useEffect(() => {
    const u = undoNotice.current
    if (u && undoRedo.steps > u.steps + 1) dropUndoNotice()
  }, [undoRedo.steps, dropUndoNotice])

  // ---------- other tabs ----------
  // Tabs with the same session open share the analysis (see tabSync): a newer one saved in another
  // tab is taken over here, and saves never overwrite a newer one (the store knows when its analysis
  // was changed, here or in the tab it was taken over from).
  /** Take over the analysis another tab saved (null: it was reset to the file defaults) when it is newer; the view here stays */
  const takeOver = (ws: Workspace | null, changedAt: number) => {
    if (changedAt <= store.changedAt) return
    const next = analysisOf(ws ? sanitizeWorkspace(ws, session) : defaultWorkspace(session))
    // The store takes it only if it differs from what is shown here
    if (!store.adopt(next, changedAt)) return
    // Not a step of this tab: undo here does not take it back
    editHistory.reset(next)
    keepSelectionsIn(next)
    notify({ message: 'Updated with the changes saved in another tab' })
  }
  const takeOverRef = useRef(takeOver)
  useEffect(() => {
    takeOverRef.current = takeOver
  })
  const fingerprint = session.fingerprint
  useEffect(() => (fingerprint ? onNews(fingerprint, (n) => takeOverRef.current(n.workspace, n.changedAt)) : undefined), [fingerprint])

  const savedView = useMemo(() => ({ window: win, selected }), [win, selected])
  const { status: saveStatus, cancel: cancelSave } = useAutosave(session, store, savedView, boot, {
    onRemoved: (names) => {
      const list = names.map((n) => `“${n}”`).join(', ')
      notify({ kind: 'error', message: `Browser storage was full: to save this session, the saved analyses of ${list} were removed from this browser.` })
    },
    // Another tab saved a newer analysis that did not reach this one: it is shown instead of the change made here
    onNewer: () => {
      const stored = loadWorkspace(session)
      takeOver(stored.source === 'saved' ? stored.workspace : null, stored.changedAt)
    },
  })

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
    if (session.fingerprint) {
      deleteStoredSession(session.fingerprint)
      // Other tabs with the session open are reset too
      announce({ fingerprint: session.fingerprint, changedAt: Date.now(), workspace: null })
    }
    onReplaceWorkspace({ kind: 'defaults' })
  }
  const importAnalysisFile = async (file: File) => {
    try {
      const parsed = parseAnalysisJson(await file.text())
      const foreign = parsed.fingerprint && session.fingerprint && parsed.fingerprint !== session.fingerprint
      if (parsed.kind === 'callouts') {
        if (foreign && !(await confirm({ title: 'Add the callouts?', message: 'They were saved for a different session file.', confirmLabel: 'Add them' }))) return
        update((a) => edits.mergeCallouts(a, parsed.callouts))
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
    measExclude,
    spectra,
    specOptions,
    notes,
    plot: plotRef.current,
    spectrum: spectrumRef.current,
  })
  const measuredCount = measuredChannels(visibleChannels, measExclude).filter((c) => {
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
    // Their buttons do not close an open callout editor first: Undo takes back what was done in it (a new callout goes)
    undo: { label: 'Undo', icon: Undo2, hint: KEYS.undo, disabled: !undoRedo.canUndo, keepFocus: true, run: undoRedo.undo },
    redo: { label: 'Redo', icon: Redo2, hint: KEYS.redo, disabled: !undoRedo.canRedo, keepFocus: true, run: undoRedo.redo },
    back: { label: 'Back to the previous view', icon: ArrowLeft, hint: KEYS.back, disabled: !nav.canGoBack, run: nav.zoomBack },
    savedView: { label: 'Saved view', icon: Home, title: 'The view the scope showed when the session was saved', run: () => nav.zoomTo(nav.savedWin, [], true) },
    fullRecord: { label: 'Full record', icon: Maximize2, hint: KEYS.fullRecord, disabled: nav.showsRecord, run: () => nav.zoomTo(record) },
    autoscale: {
      label: 'Autoscale all channels',
      icon: UnfoldVertical,
      hint: KEYS.autoscale,
      title: 'Fit what is on screen of every visible channel into its view; channels that share a view get a band each',
      disabled: !visibleChannels.length,
      run: () => autoscale(visibleChannels.map((c) => c.wave.id)),
    },
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
    measExclude,
    panel: layout.panel,
    measurementsShown: layout.measurements,
    themePreference,
    setThemePreference,
    select: setSelected,
    adjust: adjustChannel,
    showOnly,
    showAll,
    autoscale: (ids) => autoscale(ids),
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
    setMeasExclude,
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
    <AnalysisContext.Provider value={store}>
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
              engine={engine}
              channels={channels}
              viewsShown={viewsShown}
              highlightView={highlightView}
              nav={nav}
              tool={tool}
              hint={TOOLS[tool].hint}
              readout={layout.readout}
              selected={selected}
              setSelected={setSelected}
              trigger={session.trigger}
              onChannelSettings={openSettings}
              onChannelMenu={(e, id) => openMenu(e, channelMenu(api, id))}
              selectedCallout={selectedCallout}
              editingCallout={editing?.id}
              onSelectCallout={setSelectedCallout}
              onAddCallout={addCallout}
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
                engine={engine}
                defs={spectra}
                options={specOptions}
                setOptions={(patch) => update((a) => edits.setSpectrumOptions(a, patch, win))}
                channels={channels}
                win={win}
                cursors={cursors}
                height={layout.specHeight}
                setHeight={(specHeight) => setLayout((l) => ({ ...l, specHeight }))}
                onAdd={() => addSpectrum()}
                onChange={changeSpectrum}
                onRemove={(id) => update((a) => edits.removeSpectrum(a, id))}
                onClose={() => update(edits.clearSpectra)}
                onOpenReference={() => openReference('spectrum')}
                onCopy={copy}
              />
            )}
            {layout.measurements && (
              <MeasurementTable
                engine={engine}
                channels={channels}
                win={win}
                cursors={cursors}
                range={measRange}
                setRange={changeMeasRange}
                keys={measKeys}
                setKeys={setMeasKeys}
                exclude={measExclude}
                setExclude={setMeasExclude}
                height={layout.measHeight === FORMER_MEAS_HEIGHT ? null : layout.measHeight}
                setHeight={(measHeight) => setLayout((l) => ({ ...l, measHeight }))}
                selected={selected}
                onSelect={setSelected}
                onShowChannel={(id) => onAdjust(id, { visible: true })}
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
                    update(edits.clearCallouts)
                    setEditing(null)
                    setSelectedCallout(undefined)
                    offerUndo(`${n} callout${n > 1 ? 's' : ''} deleted`)
                  }}
                />
              )}
              {layout.panel === 'info' && (
                <InfoPanel
                  session={session}
                  channels={inputChannels}
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
          onToggleSpectrum={toggleSpectrum}
          views={views}
          selected={selected}
          setSelected={setSelected}
          onAdjust={adjustChannel}
          onMoveToView={onMoveToView}
          onAutoscale={onAutoscale}
          win={win}
          timePerDiv={tPerDiv}
          sampleRate={1 / nav.minDt}
          recordLength={session.channels[0].wave.data.length}
          trigger={session.trigger}
          onChannelMenu={(e, id) => openMenu(e, channelMenu(api, id))}
          onTimebaseMenu={(e) => openMenu(e, timebaseMenu(api, tPerDiv))}
          onHighlightView={setHighlightView}
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
    </AnalysisContext.Provider>
  )
})
