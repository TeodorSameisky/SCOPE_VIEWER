import { describe, expect, it } from 'vitest'
import { UndoHistory } from './undoHistory'

describe('UndoHistory', () => {
  it('undoes and redoes committed steps', () => {
    const h = new UndoHistory({ v: 0 })
    expect(h.change({ v: 1 })).toBe(true)
    h.commit()
    h.change({ v: 2 })
    h.commit()
    expect(h.undo()).toEqual({ v: 1 })
    expect(h.undo()).toEqual({ v: 0 })
    expect(h.undo()).toBeUndefined()
    expect(h.redo()).toEqual({ v: 1 })
    expect(h.redo()).toEqual({ v: 2 })
    expect(h.canRedo).toBe(false)
  })

  it('groups the changes between commits into one step', () => {
    const h = new UndoHistory({ x: 0 })
    h.change({ x: 1 })
    h.change({ x: 2 })
    h.change({ x: 3 })
    expect(h.undo()).toEqual({ x: 0 })
    expect(h.canUndo).toBe(false)
  })

  it('ignores changes that do not change the content', () => {
    const h = new UndoHistory({ a: [1, 2] })
    expect(h.change({ a: [1, 2] })).toBe(false)
    expect(h.canUndo).toBe(false)
  })

  it('drops a step that ends where it started', () => {
    const h = new UndoHistory({ x: 0 })
    h.change({ x: 5 })
    h.change({ x: 0 })
    h.commit()
    expect(h.canUndo).toBe(false)
  })

  it('does not record the state it was set to by undo', () => {
    const h = new UndoHistory({ x: 0 })
    h.change({ x: 1 })
    h.commit()
    const prev = h.undo()!
    // the caller applies the state, which reports it back as a change
    expect(h.change({ ...prev })).toBe(false)
    expect(h.canRedo).toBe(true)
  })

  it('a new change clears the redo stack', () => {
    const h = new UndoHistory({ x: 0 })
    h.change({ x: 1 })
    h.commit()
    h.undo()
    h.change({ x: 7 })
    h.commit()
    expect(h.canRedo).toBe(false)
    expect(h.undo()).toEqual({ x: 0 })
  })

  it('keeps at most `limit` steps', () => {
    const h = new UndoHistory({ x: 0 }, 3)
    for (let i = 1; i <= 5; i++) {
      h.change({ x: i })
      h.commit()
    }
    expect([h.undo(), h.undo(), h.undo(), h.undo()]).toEqual([{ x: 4 }, { x: 3 }, { x: 2 }, undefined])
  })
})
