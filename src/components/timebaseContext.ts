import { createContext, useContext } from 'react'
import type { TimeWindow } from '../model/view'

/** The time window on screen and its time per division */
export interface Timebase {
  win: TimeWindow
  timePerDiv: number
}

/**
 * The time window of the open session, for the few places that only show it (the horizontal
 * summary in the channel bar). It changes with every step of a pan or zoom: read from here, it
 * renders those places again and not the components around them, which can then be memoized.
 */
export const TimebaseContext = createContext<Timebase | null>(null)

export function useTimebase(): Timebase {
  const timebase = useContext(TimebaseContext)
  if (!timebase) throw new Error('useTimebase needs a TimebaseContext.Provider above it')
  return timebase
}
