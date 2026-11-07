import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { throttle } from './throttle'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('throttle', () => {
  it('passes the first call on at once', () => {
    const fn = vi.fn()
    throttle(fn, 100)(1)
    expect(fn).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('passes a stream of calls on at most once per period, with the latest arguments', () => {
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t(1)
    for (let i = 2; i <= 9; i++) {
      vi.advanceTimersByTime(10)
      t(i)
    }
    expect(fn.mock.calls).toEqual([[1]])
    vi.advanceTimersByTime(100)
    expect(fn.mock.calls).toEqual([[1], [9]])
    // the call that was waiting starts a pause of its own: nothing else is passed on within it
    vi.advanceTimersByTime(100)
    t(10)
    expect(fn.mock.calls).toEqual([[1], [9], [10]])
    vi.advanceTimersByTime(50)
    t(11)
    expect(fn).toHaveBeenCalledTimes(3)
    vi.advanceTimersByTime(60)
    expect(fn.mock.calls).toEqual([[1], [9], [10], [11]])
  })

  it('does not repeat a call that was already passed on', () => {
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t(1)
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('passes the first call after a quiet period on at once again', () => {
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t(1)
    vi.advanceTimersByTime(500)
    t(2)
    expect(fn.mock.calls).toEqual([[1], [2]])
  })

  it('flush makes the waiting call now, and only once', () => {
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t(1)
    t(2)
    t(3)
    t.flush()
    expect(fn.mock.calls).toEqual([[1], [3]])
    t.flush()
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('flush with nothing waiting calls nothing', () => {
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t.flush()
    t(1)
    t.flush()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel drops the waiting call', () => {
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t(1)
    t(2)
    t.cancel()
    vi.advanceTimersByTime(1000)
    t.flush()
    expect(fn.mock.calls).toEqual([[1]])
    // and the next call is passed on at once
    t(3)
    expect(fn.mock.calls).toEqual([[1], [3]])
  })
})
