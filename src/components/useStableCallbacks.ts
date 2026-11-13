import { useLayoutEffect, useRef, useState } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Callbacks = Record<string, (...args: any[]) => unknown>

/**
 * The given callbacks as functions that stay the same on every render and call the latest ones.
 * For handlers handed to a memoized component: the workspace makes its handlers anew on every
 * render (they read its current state), which would render that component again each time.
 * They are for events (clicks, keys), not to be called while rendering.
 */
export function useStableCallbacks<T extends Callbacks>(callbacks: T): T {
  const latest = useRef(callbacks)
  useLayoutEffect(() => {
    latest.current = callbacks
  })
  const [stable] = useState(() => Object.fromEntries(Object.keys(callbacks).map((name) => [name, (...args: unknown[]) => latest.current[name](...args)])) as T)
  return stable
}
