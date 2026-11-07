/** A function that is called at most once per `ms` however often it is asked to (see `throttle`) */
export interface Throttled<A extends unknown[]> {
  (...args: A): void
  /** Call it now with the latest arguments that are waiting, if there are any */
  flush: () => void
  /** Drop the arguments that are waiting */
  cancel: () => void
}

/**
 * Calls `fn` at once for the first call, then at most once per `ms`, with the latest arguments given in
 * between: a stream of calls (the moves of a drag) reaches `fn` as a steady, slower one, and its last call
 * is never lost – it is made when the pause ends, or at once by `flush`.
 */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): Throttled<A> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let waiting: A | undefined

  const run = (args: A) => {
    fn(...args)
    timer = setTimeout(pauseOver, ms)
  }
  const pauseOver = () => {
    timer = undefined
    const args = waiting
    waiting = undefined
    if (args) run(args)
  }

  const throttled = ((...args: A) => {
    if (timer === undefined) run(args)
    else waiting = args
  }) as Throttled<A>

  throttled.flush = () => {
    clearTimeout(timer)
    timer = undefined
    const args = waiting
    waiting = undefined
    if (args) run(args)
  }
  throttled.cancel = () => {
    clearTimeout(timer)
    timer = undefined
    waiting = undefined
  }
  return throttled
}
