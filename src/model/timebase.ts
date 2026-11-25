/**
 * The timebase of the open session: the time window, the limits it zooms between, keeping it on the
 * record, and the history Back steps through. React does not own it; whatever shows the window
 * subscribes (`get` / `subscribe` follow useSyncExternalStore).
 *
 * Callers say what the user did (`pan`, `panBy`, `resize`, `zoomAt`, `zoomTo`, `back`), never which
 * window results: the clamping and the grouping of Back steps are decided here, from the window as it
 * is now (several wheel events can arrive between two renders).
 *
 * Navigation is not part of undo, except for a zoom that scales channels (zoom rectangle, zoom to a
 * box): the timebase changes their vertical settings in the analysis store, remembers them for Back,
 * and attaches the window move to the undo step, so that undo returns the window with the channels
 * (`show`). Back restores the channels it scaled, which is again an undo step that moves the window.
 */
import type { AnalysisStore } from './analysisStore'
import { patchChannels } from './edits'
import type { Session } from './types'
import type { UndoHistory } from './undoHistory'
import { keepInRecord, patchDisplays, verticalsOf, zoomAround, type DisplayPatch, type TimeWindow, type Verticals } from './view'
import { recordWindow, scopeWindow, spanLimits, type Analysis } from './workspace'

/** Continuous changes of the same kind within this time count as one Back step */
export const GESTURE_MS = 800
/** Back steps kept */
export const BACK_STEPS = 50

/** What the timebase shows; a new object whenever any of it changed */
export interface TimebaseState {
  window: TimeWindow
  canGoBack: boolean
  /** The window shows the whole record and nothing else (zoomed in or out, it does not) */
  showsRecord: boolean
}

/** A channel's new vertical settings, by a zoom that scales channels */
export interface ChannelPatch {
  id: string
  patch: DisplayPatch
}

export interface TimebaseDeps {
  /** The analysis: the vertical settings a zoom scales and Back restores */
  store: Pick<AnalysisStore, 'get' | 'update'>
  /** The undo history the window move of a scaling zoom (or of Back from it) is attached to */
  history: Pick<UndoHistory<Analysis, TimeWindow>, 'moveView'>
  /** Milliseconds, for grouping continuous gestures */
  now?: () => number
}

type Gesture = 'pan' | 'wheel' | 'zoom'

interface BackStep {
  win: TimeWindow
  /** The channels the zoom from here scaled, as they were before it */
  vertical: Verticals
}

export class Timebase {
  /** The time span covered by the record */
  readonly record: TimeWindow
  /** The window the scope showed when the session was saved */
  readonly savedWindow: TimeWindow
  /** Sample interval of the fastest channel */
  readonly minDt: number
  /** The narrowest window: 10 samples of the fastest channel */
  readonly minSpan: number
  /** The widest window: 4× the record */
  readonly maxSpan: number

  private win: TimeWindow
  private backSteps: BackStep[] = []
  private last: { gesture: Gesture | null; time: number } = { gesture: null, time: 0 }
  private state: TimebaseState
  private readonly listeners = new Set<() => void>()
  private readonly store: TimebaseDeps['store']
  private readonly history: TimebaseDeps['history']
  private readonly now: () => number

  constructor(session: Session, initial: TimeWindow, deps: TimebaseDeps) {
    this.record = recordWindow(session)
    this.savedWindow = scopeWindow(session)
    const limits = spanLimits(session)
    this.minDt = limits.minDt
    this.minSpan = limits.minSpan
    this.maxSpan = limits.maxSpan
    this.store = deps.store
    this.history = deps.history
    this.now = deps.now ?? (() => performance.now())
    this.win = initial
    this.state = this.makeState()
  }

  get = (): TimebaseState => this.state

  /** Call `listener` after every change; returns the function that stops it */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /** Move the window to `to` (dragging the plot or the overview box); stays on the record */
  pan = (to: TimeWindow): void => {
    this.go(this.keep({ start: to.start, end: to.start + this.span(to) }), 'pan')
  }

  /** Move the window by a share of its width (> 0: later), from the keyboard or the wheel */
  panBy = (share: number): void => {
    const shift = (this.win.end - this.win.start) * share
    if (shift) this.pan({ start: this.win.start + shift, end: this.win.end + shift })
  }

  /** Move one edge of the window to time t (dragging an edge of the overview box) */
  resize = (edge: 'start' | 'end', t: number): void => {
    const { start, end } = this.win
    const w =
      edge === 'start'
        ? { start: Math.min(end - this.minSpan, Math.max(end - this.maxSpan, t)), end }
        : { start, end: Math.max(start + this.minSpan, Math.min(start + this.maxSpan, t)) }
    this.go(this.keep(w), 'pan')
  }

  /**
   * Zoom by `factor` (> 1: out) keeping time t in place. `continuous` (the wheel): a burst of zooms
   * is one Back step; otherwise (a button, a key, a click) each zoom is one.
   */
  zoomAt = (t: number, factor: number, { continuous = false }: { continuous?: boolean } = {}): void => {
    const w = zoomAround(this.win, t, factor, this.minSpan, this.maxSpan)
    if (continuous) this.go(this.keep(w), 'wheel')
    else this.zoomTo(w)
  }

  /**
   * Show `range` (at least the narrowest window, centred on it), optionally with new vertical settings
   * for some channels. `free`: exactly there, also off the record (a callout placed there, the view
   * saved on the scope).
   */
  zoomTo = (range: TimeWindow, { patches = [], free = false }: { patches?: ChannelPatch[]; free?: boolean } = {}): void => {
    const span = this.span(range)
    const mid = (range.start + range.end) / 2
    // A range within the limits is shown exactly as given
    const w = span === range.end - range.start ? range : { start: mid - span / 2, end: mid + span / 2 }
    const to = free ? w : this.keep(w)
    const byId = Object.fromEntries(patches.map((x) => [x.id, x.patch]))
    const displays = this.store.get().channels
    const scales = patchDisplays(displays, byId) !== displays
    if (!scales && sameWindow(to, this.win)) return
    const from = this.win
    this.go(to, 'zoom', scales ? verticalsOf(displays, Object.keys(byId)) : {}, false)
    if (scales) {
      this.store.update((a) => patchChannels(a, byId))
      this.history.moveView(from, to)
    }
    this.notify()
  }

  /** Go back to the window before the last pan or zoom, with the channels that zoom scaled */
  back = (): void => {
    const prev = this.backSteps.pop()
    if (!prev) return
    const from = this.win
    this.win = prev.win
    this.last = { gesture: null, time: 0 }
    const displays = this.store.get().channels
    if (patchDisplays(displays, prev.vertical) !== displays) {
      this.store.update((a) => patchChannels(a, prev.vertical))
      this.history.moveView(from, prev.win)
    }
    this.notify()
  }

  /** Show a window without a Back step: undo / redo of a zoom that scaled channels */
  show = (w: TimeWindow): void => {
    this.last = { gesture: null, time: 0 }
    if (sameWindow(w, this.win)) return
    this.win = w
    this.notify()
  }

  /** The width of a window, within the zoom limits */
  private span(w: TimeWindow): number {
    return Math.min(this.maxSpan, Math.max(this.minSpan, w.end - w.start))
  }

  private keep(w: TimeWindow): TimeWindow {
    return keepInRecord(w, this.record)
  }

  /**
   * Go to `to`. A zoom is always a Back step of its own; continuous changes of one kind (pan, wheel)
   * are one step until a pause or a change of kind. `vertical`: the channels this change scales, as
   * they are before it. `notify`: false when the caller notifies after more changes.
   */
  private go(to: TimeWindow, gesture: Gesture, vertical: Verticals = {}, notify = true): void {
    if (gesture !== 'zoom' && sameWindow(to, this.win)) return
    const now = this.now()
    const { gesture: lastGesture, time } = this.last
    if (gesture === 'zoom' || lastGesture !== gesture || now - time > GESTURE_MS) {
      this.backSteps = [...this.backSteps.slice(-(BACK_STEPS - 1)), { win: this.win, vertical }]
    }
    this.last = { gesture, time: now }
    this.win = to
    if (notify) this.notify()
  }

  private makeState(): TimebaseState {
    const { win, record, minDt } = this
    return {
      window: win,
      canGoBack: this.backSteps.length > 0,
      showsRecord: Math.abs(win.start - record.start) <= minDt && Math.abs(win.end - record.end) <= minDt,
    }
  }

  private notify(): void {
    this.state = this.makeState()
    for (const l of this.listeners) l()
  }
}

function sameWindow(a: TimeWindow, b: TimeWindow): boolean {
  return a.start === b.start && a.end === b.end
}
