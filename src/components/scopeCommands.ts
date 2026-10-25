/**
 * The commands of the workspace: its actions (shared by the toolbar, the menus, the command
 * palette and the keyboard), the right-click menus and the commands of the palette. Scope builds
 * a ScopeApi every render and passes it here.
 */
import {
  Activity,
  AudioLines,
  BookOpen,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  Flag,
  Hash,
  Info,
  LocateFixed,
  MoveHorizontal,
  Palette,
  Pencil,
  Plus,
  Ruler,
  ScanEye,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  UnfoldVertical,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { MeasurementKey } from '../dsp/measure'
import { MEASUREMENT_DEFS } from '../dsp/measureDefs'
import type { ExportKind } from '../export/sessionExport'
import { CALLOUT_COLORS, CALLOUT_TYPE_LABEL, calloutName, calloutSpan, calloutTitle, hasTimeSpan, type Callout } from '../model/callouts'
import { MAX_MATH, type MathDef } from '../model/math'
import { MAX_SPECTRA, type SpectrumDef } from '../model/spectrum'
import type { ChannelDisplay, Session } from '../model/types'
import { MEASURE_RANGES, RANGE_LABEL, RANGE_SHORT, type CursorState, type DisplayPatch, type LiveChannel, type MeasureRange, type TimeWindow, type Tool } from '../model/view'
import { valueAt } from '../render/draw'
import { si } from '../util/format'
import { channelName, perDiv } from '../util/names'
import { KEYS, TOOL_ORDER } from './keymap'
import type { NewCallout, PlotPoint } from './PlotArea'
import type { ReferenceSection } from './ReferencePanel'
import type { PanelId } from './Rail'
import { command, menuItem, type Action } from './ui/action'
import type { Command } from './ui/commandSearch'
import type { MenuEntry } from './ui/menuContext'
import { THEME_LABEL, THEME_PREFERENCES, type ThemePreference } from './ui/themeContext'

export interface ScopeActions {
  tools: Record<Tool, Action>
  undo: Action
  redo: Action
  back: Action
  savedView: Action
  fullRecord: Action
  /** Every visible channel fitted into its view */
  autoscale: Action
  zoomIn: Action
  zoomOut: Action
  cursors: Action
  /** Cursors on, at 30 % and 70 % of the view */
  cursorsHere: Action
  readout: Action
  overview: Action
  measurements: Action
  focus: Action
  prevCallout: Action
  nextCallout: Action
  palette: Action
  open: Action
  openAnalysis: Action
  saveAnalysis: Action
  saveBundle: Action
  reset: Action
  storage: Action
  install: Action
  close: Action
  exports: Record<ExportKind, Action>
}

/** What the menus and the palette need from the workspace */
export interface ScopeApi {
  session: Session
  actions: ScopeActions
  /** Channels with a waveform (inputs and computed math channels) */
  channels: LiveChannel[]
  displays: ChannelDisplay[]
  views: string[][]
  mathDefs: MathDef[]
  spectra: SpectrumDef[]
  callouts: Callout[]
  cursors: CursorState
  win: TimeWindow
  record: TimeWindow
  selected?: string
  measKeys: MeasurementKey[]
  measRange: MeasureRange
  panel: PanelId | null
  measurementsShown: boolean
  themePreference: ThemePreference
  setThemePreference: (p: ThemePreference) => void

  select: (id: string) => void
  adjust: (id: string, patch: DisplayPatch) => void
  showOnly: (id: string) => void
  showAll: () => void
  /** Fit what is on screen of these channels into their views (a band each where visible ones share a view) */
  autoscale: (ids: string[]) => void
  moveToView: (id: string, view: number) => void
  toggleSpectrum: (id: string) => void
  addSpectrum: () => void
  /** Add a math channel and open its editor */
  addMath: () => void
  removeMath: (id: string) => void
  openSettings: (id: string) => void
  setCursors: (c: CursorState) => void
  placeCursor: (which: 'a' | 'b', t: number) => void
  /** Zoom by `f` (> 1 = out) around time t */
  zoomAt: (t: number, f: number) => void
  zoomTo: (w: TimeWindow) => void

  addCallout: (c: NewCallout) => void
  editCallout: (id: string) => void
  updateCallout: (id: string, patch: Partial<Callout>) => void
  deleteCallout: (id: string) => void
  jumpToCallout: (c: Callout) => void
  zoomToBox: (c: Callout) => void
  duplicateCallout: (c: Callout) => void

  setMeasKeys: (k: MeasurementKey[]) => void
  setMeasRange: (r: MeasureRange) => void
  setPanel: (p: PanelId | null) => void
  openReference: (section: ReferenceSection, focus?: MeasurementKey) => void
  copy: (text: string, what: string) => void
}

// ---------- toolbar menus ----------

export function fileMenu(a: ScopeActions): MenuEntry[] {
  return [
    menuItem(a.open, { note: '.tss .wfm .isf .scopeview' }),
    menuItem(a.openAnalysis, { note: '.scopeview.json' }),
    '-',
    menuItem(a.saveAnalysis, { note: 'settings, math, callouts' }),
    menuItem(a.saveBundle, { note: '.scopeview' }),
    '-',
    menuItem(a.reset),
    menuItem(a.storage),
    !a.install.disabled && '-',
    !a.install.disabled && menuItem(a.install, { note: 'own window, offline' }),
    '-',
    menuItem(a.close),
  ]
}

export function exportMenu(a: ScopeActions): MenuEntry[] {
  const e = a.exports
  return [
    menuItem(e.image, { label: 'Image…', note: 'PNG' }),
    menuItem(e.report, { label: 'Report…', note: 'HTML / PDF' }),
    '-',
    menuItem(e.waveforms, { label: 'Waveform data…', note: 'CSV' }),
    menuItem(e.measurements, { label: 'Measurements…', note: 'CSV' }),
    menuItem(e.spectra, { label: 'Spectra…', note: 'CSV' }),
  ]
}

// ---------- right-click menus ----------

const hasWave = (api: ScopeApi, id: string) => api.channels.some((c) => c.wave.id === id)

export function channelHeading(api: ScopeApi, id: string, detail?: string): MenuEntry {
  const d = api.displays.find((x) => x.id === id)
  return { kind: 'heading', label: `${channelName(id)}${d?.label ? ` · ${d.label}` : ''}`, color: d?.color, detail }
}

/** Commands for one channel: on its badge, on its trace (`compact`) and on its measurement row */
export function channelItems(api: ScopeApi, id: string, compact = false): MenuEntry[] {
  const d = api.displays.find((x) => x.id === id)
  if (!d) return []
  const wave = hasWave(api, id)
  const others = api.displays.filter((x) => x.id !== id)
  const solo = d.visible && others.every((x) => !x.visible)
  const view = api.views.findIndex((v) => v.includes(id))
  const hasSpectrum = api.spectra.some((s) => s.source === id)
  const isMath = api.mathDefs.some((m) => m.id === id)
  return [
    { label: isMath ? 'Settings and expression…' : 'Settings…', icon: SlidersHorizontal, onClick: () => api.openSettings(id) },
    { label: d.visible ? 'Hide' : 'Show', icon: d.visible ? EyeOff : Eye, onClick: () => api.adjust(id, { visible: !d.visible }) },
    solo
      ? { label: 'Show all channels', icon: Eye, disabled: !others.length, onClick: api.showAll }
      : { label: 'Show only this channel', icon: ScanEye, onClick: () => api.showOnly(id) },
    { label: 'Autoscale', icon: UnfoldVertical, title: 'Fit what is on screen of it into its view (its band, where it shares the view)', disabled: !wave, onClick: () => api.autoscale([id]) },
    !compact && {
      kind: 'choices',
      label: 'View',
      options: [
        ...api.views.map((_, i) => ({ label: String(i + 1), title: `Move to view ${i + 1}`, checked: i === view, onClick: () => api.moveToView(id, i) })),
        { label: 'New', title: 'Move to a new view of its own', disabled: view >= 0 && api.views[view].length === 1, onClick: () => api.moveToView(id, api.views.length) },
      ],
    },
    {
      label: hasSpectrum ? 'Remove spectrum' : 'Show spectrum (FFT)',
      icon: AudioLines,
      disabled: !wave || (!hasSpectrum && api.spectra.length >= MAX_SPECTRA),
      onClick: () => api.toggleSpectrum(id),
    },
    api.cursors.on &&
      wave && { label: 'Cursor Δv on this channel', icon: Ruler, checked: api.cursors.source === id, onClick: () => api.setCursors({ ...api.cursors, source: id }) },
    !compact && isMath && '-',
    !compact && isMath && { label: 'Delete math channel', icon: Trash2, danger: true, onClick: () => api.removeMath(id) },
  ]
}

/** The menu of a channel badge or tag: its scale in the heading */
export function channelMenu(api: ScopeApi, id: string): MenuEntry[] {
  const d = api.displays.find((x) => x.id === id)
  const unit = api.channels.find((c) => c.wave.id === id)?.wave.yUnit ?? ''
  return [channelHeading(api, id, d && perDiv(d.scale, unit)), ...channelItems(api, id)]
}

/** Time and value of every visible channel at `t`, one per line */
function valuesAt(api: ScopeApi, t: number): string {
  return [
    `t = ${si(t, 's', 6)}`,
    ...api.channels
      .filter((c) => c.display.visible)
      .map((c) => `${channelName(c.wave.id)}${c.display.label ? ` (${c.display.label})` : ''}: ${si(valueAt(c.wave, t), c.wave.yUnit, 5)}`),
  ].join('\n')
}

/** Back, full record and the saved view: in the overview and the horizontal summary */
function viewItems(a: ScopeActions): MenuEntry[] {
  return [menuItem(a.back, { label: 'Back' }), menuItem(a.fullRecord), menuItem(a.savedView)]
}

export function plotMenu(api: ScopeApi, at: PlotPoint): MenuEntry[] {
  const { t, note, edgeT, view } = at
  const a = api.actions
  const ch = at.channel ? api.channels.find((c) => c.wave.id === at.channel) : undefined
  const { cursors, record } = api
  // The visible traces of the view under the pointer
  const inView = view === undefined ? [] : api.channels.filter((c) => c.display.visible && api.views[view]?.includes(c.wave.id)).map((c) => c.wave.id)
  return [
    { kind: 'heading', label: 'Time', detail: si(t, 's', 5) },
    { label: 'Zoom in here', icon: ZoomIn, onClick: () => api.zoomAt(t, 0.5) },
    { label: 'Zoom out here', icon: ZoomOut, onClick: () => api.zoomAt(t, 2) },
    menuItem(a.back, { label: 'Back' }),
    menuItem(a.fullRecord),
    api.views.length > 1
      ? {
          kind: 'choices',
          label: 'Autoscale',
          options: [
            { label: 'This view', title: 'Fit the visible channels of this view (what is on screen)', disabled: !inView.length, onClick: () => api.autoscale(inView) },
            { label: 'All', title: `${a.autoscale.title} (${a.autoscale.hint})`, disabled: a.autoscale.disabled, onClick: a.autoscale.run },
          ],
        }
      : menuItem(a.autoscale, { label: 'Autoscale' }),
    '-',
    {
      kind: 'choices',
      label: 'Cursor',
      options: [
        { label: 'A here', title: 'Put cursor A here', onClick: () => api.placeCursor('a', t) },
        { label: 'B here', title: 'Put cursor B here', onClick: () => api.placeCursor('b', t) },
      ],
    },
    note && { label: 'Add note here', icon: StickyNote, onClick: () => api.addCallout(note) },
    edgeT !== undefined
      ? {
          label: 'Add marker at the edge',
          icon: Flag,
          title: 'At the 50 % crossing of the selected channel next to the pointer (Alt+right-click: exactly here)',
          onClick: () => api.addCallout({ type: 'marker', t: edgeT }),
        }
      : { label: 'Add marker here', icon: Flag, onClick: () => api.addCallout({ type: 'marker', t }) },
    cursors.on && {
      label: 'Mark region between cursors',
      icon: MoveHorizontal,
      onClick: () => api.addCallout({ type: 'region', t: Math.min(cursors.a, cursors.b), t2: Math.max(cursors.a, cursors.b) }),
    },
    api.callouts.length > 0 && {
      kind: 'choices',
      label: 'Callout',
      options: [
        { label: '‹ Previous', title: `Go to the previous callout (${a.prevCallout.hint})`, onClick: a.prevCallout.run },
        { label: 'Next ›', title: `Go to the next callout (${a.nextCallout.hint})`, onClick: a.nextCallout.run },
      ],
    },
    ch && '-',
    ch && channelHeading(api, ch.wave.id, si(valueAt(ch.wave, t), ch.wave.yUnit)),
    ...(ch ? channelItems(api, ch.wave.id, true) : []),
    '-',
    {
      label: 'Copy values at this time',
      icon: Copy,
      title: 'Time and value of every visible channel',
      disabled: !api.channels.some((c) => c.display.visible) || t < record.start || t > record.end,
      onClick: () => api.copy(valuesAt(api, t), 'Values'),
    },
    menuItem(a.exports.image, { label: 'Export image…' }),
  ]
}

export function calloutMenu(api: ScopeApi, c: Callout): MenuEntry[] {
  const t2 = c.t2 ?? c.t
  const kind = CALLOUT_TYPE_LABEL[c.type].toLowerCase()
  const { cursors } = api
  return [
    {
      kind: 'heading',
      label: calloutTitle(c),
      color: c.color,
      detail: c.type === 'span' ? `Δt ${si(t2 - c.t, 's')}` : hasTimeSpan(c) ? `Δt ${si(Math.abs(t2 - c.t), 's')}` : si(c.t, 's', 5),
    },
    { label: 'Edit text', icon: Pencil, hint: KEYS.editCallout, onClick: () => api.editCallout(c.id) },
    { kind: 'choices', label: 'Colour', options: CALLOUT_COLORS.map((col) => ({ label: col, color: col, checked: c.color === col, onClick: () => api.updateCallout(c.id, { color: col }) })) },
    c.type === 'box' && {
      kind: 'choices',
      label: 'Shape',
      options: [
        { label: 'Rectangle', checked: c.shape !== 'ellipse', onClick: () => api.updateCallout(c.id, { shape: undefined }) },
        { label: 'Ellipse', checked: c.shape === 'ellipse', onClick: () => api.updateCallout(c.id, { shape: 'ellipse' }) },
      ],
    },
    (c.type === 'note' || c.type === 'span') && {
      label: c.type === 'span' ? 'Show Δv and 1/Δt' : c.channel ? 'Show value at the anchor' : 'Show time at the anchor',
      icon: Hash,
      checked: !!c.showValue,
      onClick: () => api.updateCallout(c.id, { showValue: c.showValue ? undefined : true }),
    },
    (c.type === 'region' || c.type === 'box') && { label: c.measure ? 'Change measurements…' : `Measure in this ${kind}…`, icon: Activity, onClick: () => api.editCallout(c.id) },
    c.type === 'box' && { label: 'Zoom to box', icon: ZoomIn, title: 'Its time span, and its channel scaled to fill the view', onClick: () => api.zoomToBox(c) },
    { label: c.type === 'region' ? 'Zoom to region' : 'Go to', icon: LocateFixed, onClick: () => api.jumpToCallout(c) },
    { label: 'Duplicate', icon: CopyPlus, onClick: () => api.duplicateCallout(c) },
    c.type === 'span'
      ? {
          label: 'Set cursors to the ends',
          icon: Ruler,
          title: 'Cursor A at the start, B at the end, Δv on the channel of the start',
          onClick: () => api.setCursors({ ...cursors, on: true, a: c.t, b: t2, source: c.channel && hasWave(api, c.channel) ? c.channel : cursors.source }),
        }
      : hasTimeSpan(c)
        ? { label: `Set cursors to ${kind}`, icon: Ruler, onClick: () => api.setCursors({ ...cursors, on: true, a: Math.min(c.t, t2), b: Math.max(c.t, t2) }) }
        : {
            kind: 'choices',
            label: 'Cursor',
            options: [
              { label: 'A here', title: 'Put cursor A at this callout', onClick: () => api.placeCursor('a', c.t) },
              { label: 'B here', title: 'Put cursor B at this callout', onClick: () => api.placeCursor('b', c.t) },
            ],
          },
    '-',
    { label: 'Delete', icon: Trash2, hint: KEYS.deleteCallout, danger: true, onClick: () => api.deleteCallout(c.id) },
  ]
}

export function overviewMenu(api: ScopeApi, t: number): MenuEntry[] {
  const span = api.win.end - api.win.start
  return [
    { kind: 'heading', label: 'Time', detail: si(t, 's', 5) },
    { label: 'Centre the view here', icon: LocateFixed, onClick: () => api.zoomTo({ start: t - span / 2, end: t + span / 2 }) },
    ...viewItems(api.actions),
    '-',
    menuItem(api.actions.overview, { label: 'Hide overview', icon: EyeOff, checked: undefined }),
  ]
}

/** The horizontal and trigger summaries in the channel bar */
export function timebaseMenu(api: ScopeApi, timePerDiv: number): MenuEntry[] {
  return [
    { kind: 'heading', label: 'Horizontal', detail: si(timePerDiv, 's/div', 3) },
    ...viewItems(api.actions),
    '-',
    { label: 'Session info and setup…', icon: SlidersHorizontal, onClick: () => api.setPanel('info') },
  ]
}

/** The range choices of the measurement table and the spectrum */
export function rangeChoices(range: MeasureRange, setRange: (r: MeasureRange) => void): MenuEntry {
  return {
    kind: 'choices',
    label: 'Range',
    options: MEASURE_RANGES.map((r) => ({ label: RANGE_SHORT[r], title: RANGE_LABEL[r], checked: range === r, onClick: () => setRange(r) })),
  }
}

// ---------- command palette ----------

/** Everything the palette offers; commands that are not available are left out */
export function paletteCommands(api: ScopeApi): Command[] {
  const a = api.actions
  const togglePanel = (id: PanelId) => () => api.setPanel(api.panel === id ? null : id)
  const firstId = api.session.channels[0].wave.id
  const entries: (Command | false)[] = [
    ...TOOL_ORDER.map((t) => command(`tool:${t}`, 'Tool', a.tools[t], { label: `${a.tools[t].label} tool`, keywords: t === 'span' ? 'delta t Δt' : undefined })),

    command('view:full', 'View', a.fullRecord),
    command('view:autoscale', 'View', a.autoscale, { keywords: 'fit vertical scale autoset' }),
    command('view:back', 'View', a.back),
    command('view:saved', 'View', a.savedView, { keywords: 'as on the scope home' }),
    command('view:in', 'View', a.zoomIn),
    command('view:out', 'View', a.zoomOut),
    command('view:cursors', 'View', a.cursors),
    command('view:cursors-here', 'View', a.cursorsHere),
    command('view:readout', 'View', a.readout),
    command('view:overview', 'View', a.overview),
    command('view:measurements', 'View', a.measurements),
    command('view:focus', 'View', a.focus, { label: 'Focus mode: hide all panels' }),

    { id: 'panel:cursors', group: 'Panel', label: 'Cursor readouts', icon: Ruler, checked: api.panel === 'cursors', run: togglePanel('cursors') },
    { id: 'panel:callouts', group: 'Panel', label: 'Callouts', icon: StickyNote, checked: api.panel === 'callouts', run: togglePanel('callouts') },
    { id: 'panel:info', group: 'Panel', label: 'Session info, notes and setup', icon: Info, checked: api.panel === 'info', run: togglePanel('info') },
    { id: 'help:measurements', group: 'Reference', label: 'How measurements work', icon: BookOpen, run: () => api.openReference('measurements') },
    { id: 'help:math', group: 'Reference', label: 'Math functions', icon: BookOpen, run: () => api.openReference('math') },
    { id: 'help:spectrum', group: 'Reference', label: 'Spectrum, windows and dB', keywords: 'fft', icon: BookOpen, run: () => api.openReference('spectrum') },

    command('edit:undo', 'Edit', a.undo),
    command('edit:redo', 'Edit', a.redo),
    api.mathDefs.length < MAX_MATH && { id: 'edit:math', group: 'Edit', label: 'Add math channel', keywords: 'expression difference power', icon: Plus, run: api.addMath },
    api.spectra.length < MAX_SPECTRA && {
      id: 'edit:fft',
      group: 'Edit',
      label: `Add spectrum (FFT) of ${channelName(api.selected && hasWave(api, api.selected) ? api.selected : firstId)}`,
      keywords: 'frequency',
      icon: AudioLines,
      run: api.addSpectrum,
    },
    command('callout:prev', 'Callout', a.prevCallout),
    command('callout:next', 'Callout', a.nextCallout),
    ...[...api.callouts]
      .sort((x, y) => calloutSpan(x)[0] - calloutSpan(y)[0])
      .map((c): Command => ({ id: `callout:${c.id}`, group: 'Callout', label: `Go to ${calloutTitle(c)}`, keywords: `${calloutName(c)} ${c.text}`, color: c.color, run: () => api.jumpToCallout(c) })),

    ...MEASURE_RANGES.map(
      (r): Command => ({ id: `meas:range:${r}`, group: 'Measurements', label: `Measure ${RANGE_LABEL[r].toLowerCase()}`, icon: Activity, checked: api.measRange === r, run: () => api.setMeasRange(r) }),
    ),
    ...MEASUREMENT_DEFS.map(
      (d): Command =>
        api.measKeys.includes(d.key)
          ? { id: `meas:remove:${d.key}`, group: 'Measurements', label: `Remove measurement: ${d.label}`, icon: X, run: () => api.setMeasKeys(api.measKeys.filter((k) => k !== d.key)) }
          : {
              id: `meas:add:${d.key}`,
              group: 'Measurements',
              label: `Add measurement: ${d.label}`,
              keywords: d.short,
              icon: Plus,
              run: () => {
                api.setMeasKeys([...api.measKeys, d.key])
                if (!api.measurementsShown) a.measurements.run()
              },
            },
    ),

    ...api.displays.flatMap((d): (Command | false)[] => {
      const name = `${channelName(d.id)}${d.label ? ` · ${d.label}` : ''}`
      return [
        { id: `ch:select:${d.id}`, group: 'Channel', label: `Select ${name}`, keywords: d.id, color: d.color, checked: api.selected === d.id, run: () => api.select(d.id) },
        { id: `ch:settings:${d.id}`, group: 'Channel', label: `Settings of ${name}…`, keywords: d.id, icon: SlidersHorizontal, run: () => api.openSettings(d.id) },
        { id: `ch:visible:${d.id}`, group: 'Channel', label: `${d.visible ? 'Hide' : 'Show'} ${name}`, keywords: d.id, icon: d.visible ? EyeOff : Eye, run: () => api.adjust(d.id, { visible: !d.visible }) },
        { id: `ch:only:${d.id}`, group: 'Channel', label: `Show only ${name}`, keywords: d.id, icon: ScanEye, run: () => api.showOnly(d.id) },
        hasWave(api, d.id) && { id: `ch:autoscale:${d.id}`, group: 'Channel', label: `Autoscale ${name}`, keywords: d.id, icon: UnfoldVertical, run: () => api.autoscale([d.id]) },
      ]
    }),
    api.displays.some((d) => !d.visible) && { id: 'ch:all', group: 'Channel', label: 'Show all channels', icon: Eye, run: api.showAll },

    command('file:open', 'File', a.open),
    command('file:open-analysis', 'File', a.openAnalysis),
    command('file:save-analysis', 'File', a.saveAnalysis),
    command('file:save-bundle', 'File', a.saveBundle, { keywords: 'bundle scopeview' }),
    command('file:reset', 'File', a.reset),
    command('file:install', 'File', a.install, { keywords: 'app offline' }),
    command('file:close', 'File', a.close),
    ...(Object.keys(a.exports) as ExportKind[]).map((k) => command(`export:${k}`, 'Export', a.exports[k], { label: `Export ${a.exports[k].label}` })),

    ...THEME_PREFERENCES.map(
      (t): Command => ({
        id: `theme:${t}`,
        group: 'Appearance',
        label: `Appearance: ${THEME_LABEL[t]}`,
        keywords: 'theme colours mode',
        icon: Palette,
        checked: api.themePreference === t,
        run: () => api.setThemePreference(t),
      }),
    ),
  ]
  return entries.filter((c): c is Command => !!c)
}
