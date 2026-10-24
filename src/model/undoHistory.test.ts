import { describe, expect, it } from 'vitest'
import { UndoHistory } from './undoHistory'

describe('UndoHistory', () => {
  it('undoes and redoes committed steps', () => {
    const h = new UndoHistory({ v: 0 })
    expect(h.change({ v: 1 })).toBe(true)
    h.commit()
    h.change({ v: 2 })
    h.commit()
    expect(h.undo()?.doc).toEqual({ v: 1 })
    expect(h.undo()?.doc).toEqual({ v: 0 })
    expect(h.undo()).toBeUndefined()
    expect(h.redo()?.doc).toEqual({ v: 1 })
    expect(h.redo()?.doc).toEqual({ v: 2 })
    expect(h.canRedo).toBe(false)
  })

  it('groups the changes between commits into one step', () => {
    const h = new UndoHistory({ x: 0 })
    h.change({ x: 1 })
    h.change({ x: 2 })
    h.change({ x: 3 })
    expect(h.undo()?.doc).toEqual({ x: 0 })
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
    const prev = h.undo()!.doc
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
    expect(h.undo()?.doc).toEqual({ x: 0 })
  })

  it('keeps at most `limit` steps', () => {
    const h = new UndoHistory({ x: 0 }, 3)
    for (let i = 1; i <= 5; i++) {
      h.change({ x: i })
      h.commit()
    }
    expect([h.undo()?.doc, h.undo()?.doc, h.undo()?.doc, h.undo()]).toEqual([{ x: 4 }, { x: 3 }, { x: 2 }, undefined])
  })

  describe('views', () => {
    it('restores the view a step moved: where it was on undo, where it went on redo', () => {
      const h = new UndoHistory<{ scale: number }, string>({ scale: 1 })
      h.moveView('wide', 'zoomed')
      h.change({ scale: 0.1 })
      h.commit()
      expect(h.undo()).toEqual({ doc: { scale: 1 }, view: 'wide' })
      expect(h.redo()).toEqual({ doc: { scale: 0.1 }, view: 'zoomed' })
    })

    it('leaves the view alone for steps that did not move it', () => {
      const h = new UndoHistory<{ x: number }, string>({ x: 0 })
      h.moveView('a', 'b')
      h.change({ x: 1 })
      h.commit()
      h.change({ x: 2 })
      h.commit()
      expect(h.undo()).toEqual({ doc: { x: 1 }, view: undefined })
      expect(h.undo()?.view).toBe('a')
    })

    it('drops a moved view that no change followed', () => {
      const h = new UndoHistory<{ x: number }, string>({ x: 0 })
      h.moveView('a', 'b')
      h.commit()
      h.change({ x: 1 })
      h.commit()
      expect(h.undo()?.view).toBeUndefined()
    })

    it('a view moved during an open step keeps where the step started', () => {
      const h = new UndoHistory<{ x: number }, string>({ x: 0 })
      h.moveView('a', 'b')
      h.change({ x: 1 })
      h.moveView('b', 'c')
      h.change({ x: 2 })
      h.commit()
      expect(h.undo()?.view).toBe('a')
      expect(h.redo()?.view).toBe('c')
    })

    it('a step back to the start is dropped with its view', () => {
      const h = new UndoHistory<{ x: number }, string>({ x: 0 })
      h.moveView('a', 'b')
      h.change({ x: 1 })
      h.change({ x: 0 })
      h.commit()
      expect(h.canUndo).toBe(false)
    })
  })
})
