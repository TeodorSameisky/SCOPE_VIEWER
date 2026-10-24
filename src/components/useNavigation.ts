import { useMemo, useRef, useState } from 'react'
import type { ChannelDisplay, Session } from '../model/types'
import { zoomAround, type DisplayPatch, type NavKind, type TimeWindow } from '../model/view'
import { recordWindow, scopeWindow } from '../model/workspace'

/** Window and vertical settings, restored by Back */
interface ViewState {
  win: TimeWindow
  vertical: Record<string, { scale: number; position: number; offset: number }>
}

/** Continuous changes of the same kind within this time count as one Back step */
const GESTURE_MS = 800

/**
 * The time window: zooming and panning, and the history Back steps through. Navigation is not
 * part of undo; a zoom that also scales channels (zoom rectangle, zoom to box) restores their
 * vertical settings on Back.
 */
export function useNavigation(session: Session, initial: TimeWindow, displays: ChannelDisplay[], setDisplays: React.Dispatch<React.SetStateAction<ChannelDisplay[]>>) {
  const record = useMemo(() => recordWindow(session), [session])
  /** The view the scope showed when the session was saved */
  const savedWin = useMemo(() => scopeWindow(session), [session])
  const minDt = useMemo(() => Math.min(...session.channels.map((c) => c.wave.dt)), [session])
  const minSpan = minDt * 10
  const maxSpan = (record.end - record.start) * 4
  const [win, setWin] = useState(initial)
  const [history, setHistory] = useState<ViewState[]>([])
  const lastNav = useRef<{ kind: NavKind | null; time: number }>({ kind: null, time: 0 })

  const pushHistory = () => {
    const vertical = Object.fromEntries(displays.map((d) => [d.id, { scale: d.scale, position: d.position, offset: d.offset }]))
    setHistory((h) => [...h.slice(-49), { win, vertical }])
  }
  /** Continuous changes of the same kind (wheel, pan) count as one history step */
  const navigate = (w: TimeWindow, kind: NavKind) => {
    const now = performance.now()
    const last = lastNav.current
    if (kind === 'zoom' || last.kind !== kind || now - last.time > GESTURE_MS) pushHistory()
    lastNav.current = { kind, time: now }
    setWin(w)
  }
  /** Go to a window, optionally with new vertical settings for some channels */
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
    canGoBack: history.length > 0,
    /** The view shows less than the whole record */
    zoomed: win.start > record.start + minDt || win.end < record.end - minDt,
  }
}
