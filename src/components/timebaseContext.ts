import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Timebase, TimebaseState } from '../model/timebase'

/**
 * The timebase of the open session (see model/timebase.ts). The object stays the same for the life of
 * the workspace, so passing it down renders nothing again; the places that show the window subscribe
 * to it themselves (`useTimebaseState`), and only they render again on every step of a pan or zoom.
 */
export const TimebaseContext = createContext<Timebase | null>(null)

/** The timebase, to pan and zoom it */
export function useTimebase(): Timebase {
  const timebase = useContext(TimebaseContext)
  if (!timebase) throw new Error('useTimebase needs a TimebaseContext.Provider above it')
  return timebase
}

/** The window and Back state of a timebase, rendering again when they change */
export function useTimebaseState(timebase: Timebase): TimebaseState {
  return useSyncExternalStore(timebase.subscribe, timebase.get)
}
