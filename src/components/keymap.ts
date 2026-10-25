import { Flag, Hand, MoveHorizontal, RulerDimensionLine, SquareDashed, StickyNote, ZoomIn, type LucideIcon } from 'lucide-react'
import type { Tool } from '../model/view'

/**
 * Keyboard shortcuts, as shown on the buttons, in the menus, in the command palette and in the
 * help. Single keys are written as `KeyboardEvent.key` gives them (letters in upper case), so the
 * shortcut handler maps the same strings.
 */
export const KEYS = {
  palette: 'Ctrl+K',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',
  fullRecord: 'F',
  autoscale: 'A',
  back: 'Backspace',
  zoomIn: '+',
  zoomOut: '-',
  cursors: 'C',
  readout: 'V',
  overview: 'O',
  measurements: 'T',
  focus: '\\',
  prevCallout: ',',
  nextCallout: '.',
  editCallout: 'Enter',
  deleteCallout: 'Del',
  cancel: 'Esc',
} as const

export interface ToolDef {
  label: string
  key: string
  icon: LucideIcon
  /** What to do in the plot, shown there while the tool is active */
  hint?: string
  /** The same in a sentence, in the Callouts panel */
  tip?: string
}

/** The mouse tools of the plot, in toolbar order */
export const TOOLS: Record<Tool, ToolDef> = {
  pan: { label: 'Pan', key: 'P', icon: Hand },
  zoom: {
    label: 'Zoom',
    key: 'Z',
    icon: ZoomIn,
    hint: 'Drag a rectangle to zoom time + vertical · Shift+drag: time only · Click: zoom in · Alt+click: out · Esc: done',
  },
  note: { label: 'Note', key: 'N', icon: StickyNote, hint: 'Click on a trace to attach a note · Esc: cancel', tip: 'Click on a trace to attach a note.' },
  marker: {
    label: 'Marker',
    key: 'M',
    icon: Flag,
    hint: 'Click to place a marker · snaps to edges of the selected channel (Alt: free) · Esc: cancel',
    tip: 'Click in the plot to place a marker.',
  },
  region: {
    label: 'Region',
    key: 'R',
    icon: MoveHorizontal,
    hint: 'Drag to mark a time region · snaps to edges of the selected channel (Alt: free) · Esc: cancel',
    tip: 'Drag in the plot to mark a time region.',
  },
  box: {
    label: 'Box',
    key: 'B',
    icon: SquareDashed,
    hint: 'Drag a box around an event · it stays with the trace that runs through it · time edges snap to its edges (Alt: free) · Esc: cancel',
    tip: 'Drag a box around an event: it stays with the trace that runs through it (the selected one if several do).',
  },
  span: {
    label: 'Span',
    key: 'D',
    icon: RulerDimensionLine,
    hint: 'Drag from a point on one trace to a point on another to measure Δt · the ends snap to edges (Alt: free) · Esc: cancel',
    tip: 'Drag from a point on one trace to a point on another to measure the time between them.',
  },
}

export const TOOL_ORDER = Object.keys(TOOLS) as Tool[]

/** The help popover: keys or gestures (alternatives as separate chips) and what they do */
export const HELP_ROWS: [string[], string][] = [
  [[KEYS.palette], 'Command palette: find any command, channel, callout or measurement by name'],
  [['Wheel'], 'Zoom time around the pointer'],
  [['Shift + wheel', 'Swipe sideways'], 'Pan'],
  [['Right-click'], 'Commands for the point, trace, callout, channel or table cell under the pointer'],
  [['Drag'], 'Pan (Pan tool) / zoom rectangle (Zoom tool)'],
  [['Middle drag'], 'Pan with any tool'],
  [['Shift + drag', 'Drag on time axis'], 'Zoom to a time range'],
  [['Double-click'], 'Full record'],
  [['Click a trace'], 'Select channel'],
  [['Drag a channel tag'], 'Move the trace up or down (left edge of the plot; Alt: no snapping); drop it on another view to move it there'],
  [['Wheel on a tag', 'Wheel on the scale'], 'V/div of that channel'],
  [['↑  ↓', 'Page Up / Down'], 'Position / V/div of the selected channel (Shift + ↑ ↓: a whole division)'],
  [['Ctrl / Alt + wheel'], 'V/div / position of the selected channel'],
  [[`${TOOLS.pan.key}  ${TOOLS.zoom.key}`], 'Pan / Zoom tool (press again: back to Pan)'],
  [[[TOOLS.note, TOOLS.marker, TOOLS.region, TOOLS.box, TOOLS.span].map((t) => t.key).join('  ')], 'Note / Marker / Region / Box / Span (Δt between two traces)'],
  [[KEYS.cursors], 'Cursors on/off'],
  [[KEYS.readout], 'Values of all channels at the pointer on/off'],
  [[KEYS.fullRecord], 'Full record'],
  [[KEYS.autoscale], 'Autoscale: fit what is on screen of every visible channel into its view'],
  [[`${KEYS.zoomIn}  ${KEYS.zoomOut}  ←  →`], 'Zoom / pan'],
  [[KEYS.back], 'Back to the previous view'],
  [[KEYS.editCallout, KEYS.deleteCallout], 'Edit / delete the selected callout (Del on a Mac: fn + ⌫)'],
  [[`${KEYS.prevCallout}  ${KEYS.nextCallout}`], 'Previous / next callout'],
  [['Shift + ←  →'], 'Move the selected callout by one pixel'],
  [['Alt'], 'Hold while placing or dragging an edge or an end: no snapping to edges'],
  [[KEYS.undo, KEYS.redo], 'Undo / redo changes (Ctrl + Shift + Z also redoes)'],
  [[`${KEYS.overview}  ${KEYS.measurements}  ${KEYS.focus}`], 'Overview / measurements / focus mode'],
  [['Wheel', 'Drag'], 'In the spectrum: zoom / pan frequency (Ctrl + wheel: level)'],
  [[KEYS.cancel], 'Cancel what is being dragged, back to Pan'],
]
