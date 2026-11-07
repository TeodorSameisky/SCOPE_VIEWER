import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StepGrouper } from './stepGrouping'
import { UndoHistory } from './undoHistory'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup() {
  const commit = vi.fn()
  return { commit, g: new StepGrouper(commit) }
}
const typing = { repeat: false, inTextField: false }

describe('a pause after a change', () => {
  it('ends the step', () => {
    const { g, commit } = setup()
    g.changed()
    vi.advanceTimersByTime(699)
    expect(commit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('starts again with every change, so a burst of changes is one step', () => {
    const { g, commit } = setup()
    for (let i = 0; i < 5; i++) {
      g.changed()
      vi.advanceTimersByTime(500)
    }
    expect(commit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('does not end a drag, however long the pointer stays down', () => {
    const { g, commit } = setup()
    g.pointerDown()
    commit.mockClear()
    g.changed()
    vi.advanceTimersByTime(5000)
    expect(commit).not.toHaveBeenCalled()
    // released: the step ends after the pause
    g.pointerUp()
    vi.advanceTimersByTime(700)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('can be shorter or longer', () => {
    const commit = vi.fn()
    const g = new StepGrouper(commit, 100)
    g.changed()
    vi.advanceTimersByTime(100)
    expect(commit).toHaveBeenCalledTimes(1)
  })
})

describe('a press of the pointer', () => {
  it('ends the step before it', () => {
    const { g, commit } = setup()
    g.pointerDown()
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('does not end the step while it is held', () => {
    const { g, commit } = setup()
    g.setHold(true)
    commit.mockClear()
    g.pointerDown()
    expect(commit).not.toHaveBeenCalled()
  })
})

describe('a key press', () => {
  it('ends the step', () => {
    const { g, commit } = setup()
    g.keyDown(typing)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('does not when it is a repeat, typed in a text field, pressed during a drag or while held', () => {
    const { g, commit } = setup()
    g.keyDown({ repeat: true, inTextField: false })
    g.keyDown({ repeat: false, inTextField: true })
    expect(commit).not.toHaveBeenCalled()
    g.pointerDown()
    commit.mockClear()
    g.keyDown(typing)
    expect(commit).not.toHaveBeenCalled()
    g.pointerUp()
    g.setHold(true)
    commit.mockClear()
    g.keyDown(typing)
    expect(commit).not.toHaveBeenCalled()
  })
})

describe('hold (a new callout and its text)', () => {
  it('keeps the step open across pauses, and ends it when it is turned off', () => {
    const { g, commit } = setup()
    g.setHold(true)
    commit.mockClear()
    g.changed()
    vi.advanceTimersByTime(5000)
    expect(commit).not.toHaveBeenCalled()
    g.setHold(false)
    expect(commit).toHaveBeenCalledTimes(1)
  })
})

describe('dispose', () => {
  it('stops waiting for the pause', () => {
    const { g, commit } = setup()
    g.changed()
    g.dispose()
    vi.advanceTimersByTime(5000)
    expect(commit).not.toHaveBeenCalled()
  })
})

describe('with the undo history', () => {
  /** A history and a grouper that commits it, with a helper that makes a change */
  function rig() {
    const h = new UndoHistory({ n: 0 })
    const g = new StepGrouper(() => h.commit())
    let n = 0
    const change = () => {
      h.change({ n: ++n })
      g.changed()
    }
    return { h, g, change }
  }

  it('makes a drag one step', () => {
    const { h, g, change } = rig()
    g.pointerDown()
    for (let i = 0; i < 20; i++) {
      change()
      vi.advanceTimersByTime(16)
    }
    g.pointerUp()
    vi.advanceTimersByTime(700)
    expect(h.undo()?.doc).toEqual({ n: 0 })
    expect(h.canUndo).toBe(false)
  })

  it('makes two gestures two steps', () => {
    const { h, g, change } = rig()
    g.pointerDown()
    change()
    g.pointerUp()
    vi.advanceTimersByTime(700)
    g.pointerDown()
    change()
    g.pointerUp()
    vi.advanceTimersByTime(700)
    expect(h.undo()?.doc).toEqual({ n: 1 })
    expect(h.undo()?.doc).toEqual({ n: 0 })
    expect(h.canUndo).toBe(false)
  })

  it('starts a new step with a new press, without waiting for the pause', () => {
    const { h, g, change } = rig()
    change()
    g.pointerDown()
    change()
    g.pointerUp()
    vi.advanceTimersByTime(700)
    expect(h.undo()?.doc).toEqual({ n: 1 })
    expect(h.undo()?.doc).toEqual({ n: 0 })
  })

  it('makes a new callout and the text typed into it one step, though the pointer is pressed in between', () => {
    const { h, g, change } = rig()
    g.setHold(true)
    change()
    // clicking in the editor, typing: all joins the step
    g.pointerDown()
    g.pointerUp()
    change()
    g.keyDown(typing)
    change()
    vi.advanceTimersByTime(5000)
    g.setHold(false)
    expect(h.undo()?.doc).toEqual({ n: 0 })
    expect(h.canUndo).toBe(false)
  })

  it('leaves no step for a new note that is discarded', () => {
    const h = new UndoHistory({ notes: 0 })
    const g = new StepGrouper(() => h.commit())
    g.setHold(true)
    h.change({ notes: 1 })
    g.changed()
    // the empty note is taken away again, then the hold ends
    h.change({ notes: 0 })
    g.changed()
    g.setHold(false)
    expect(h.canUndo).toBe(false)
  })
})
