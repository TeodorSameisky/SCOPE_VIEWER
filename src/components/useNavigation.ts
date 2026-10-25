import { useMemo, useRef, useState } from 'react'
import type { ChannelDisplay, Session } from '../model/types'
import { patchDisplays, verticalsOf, zoomAround, type DisplayPatch, type NavKind, type TimeWindow, type Verticals } from '../model/view'
import { recordWindow, scopeWindow, spanLimits } from '../model/workspace'

/** A window to go Back to */
interface ViewState {
  win: TimeWindow
  /** The channels the zoom from here scaled, as they were before it */
  vertical: Verticals
}

/** Continuous changes of the same kind within this time count as one Back step */
const GESTURE_MS = 800

/**
 * The time window: zooming and panning, and the history Back steps through. Navigation is not
 * part of undo, except for a zoom that also scales channels (zoom rectangle, zoom to box): Back
 * restores the channels it scaled, and that change of channels (by the zoom or by Back) is an
 * undo step that takes the window with it. `onScale` reports the window it moves from and to.
 */
export function useNavigation(
  session: Session,
  initial: TimeWindow,
  displays: ChannelDisplay[],
  setDisplays: React.Dispatch<React.SetStateAction<ChannelDisplay[]>>,
  onScale: (from: TimeWindow, to: TimeWindow) => void,
) {
  const record = useMemo(() => recordWindow(session), [session])
  /** The view the scope showed when the session was saved */
  const savedWin = useMemo(() => scopeWindow(session), [session])
  const { minDt, minSpan, maxSpan } = useMemo(() => spanLimits(session), [session])
  const [win, setWin] = useState(initial)
  const [history, setHistory] = useState<ViewState[]>([])
  const lastNav = useRef<{ kind: NavKind | null; time: number }>({ kind: null, time: 0 })

  /** Continuous changes of the same kind (wheel, pan) count as one history step; `scaled`: the channels a zoom scales */
  const navigate = (w: TimeWindow, kind: NavKind, scaled: string[] = []) => {
    const now = performance.now()
    const last = lastNav.current
    if (kind === 'zoom' || last.kind !== kind || now - last.time > GESTURE_MS) {
      const vertical = verticalsOf(displays, scaled)
      setHistory((h) => [...h.slice(-49), { win, vertical }])
    }
    lastNav.current = { kind, time: now }
    setWin(w)
  }
  /** Go to a window, optionally with new vertical settings for some channels */
  const zoomTo = (w: TimeWindow, patches: { id: string; patch: DisplayPatch }[] = []) => {
    const byId = Object.fromEntries(patches.map((x) => [x.id, x.patch]))
    navigate(w, 'zoom', Object.keys(byId))
    if (patchDisplays(displays, byId) === displays) return
    setDisplays((ds) => patchDisplays(ds, byId))
    onScale(win, w)
  }
  const zoomBack = () => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory(history.slice(0, -1))
    setWin(prev.win)
    lastNav.current = { kind: null, time: 0 }
    if (patchDisplays(displays, prev.vertical) === displays) return
    setDisplays((ds) => patchDisplays(ds, prev.vertical))
    onScale(win, prev.win)
  }
  /** Go to a window without a Back step (undo / redo of a zoom that scaled channels) */
  const show = (w: TimeWindow) => {
    setWin(w)
    lastNav.current = { kind: null, time: 0 }
  }
  /** Zoom by `f` (> 1 = out) keeping time t in place */
  const zoomAt = (t: number, f: number) => zoomTo(zoomAround(win, t, f, minSpan, maxSpan))

  return {
    win,
    record,
    savedWin,
    minDt,
    minSpan,
    maxSpan,
    navigate,
    zoomTo,
    zoomAt,
    zoomBack,
    show,
    canGoBack: history.length > 0,
    /** The view shows less than the whole record */
    zoomed: win.start > record.start + minDt || win.end < record.end - minDt,
  }
}
