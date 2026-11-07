import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { StepGrouper } from '../model/stepGrouping'
import type { UndoHistory } from '../model/undoHistory'

/** Typing in these does not end a step */
const TEXT = 'input, textarea, select, [contenteditable="true"]'

/** A document that can be followed: the analysis store is one */
export interface Followable<T> {
  get: () => T
  subscribe: (listener: () => void) => () => void
}

/**
 * Records every change of the document in `h`. The history subscribes to the document itself, so a
 * change is recorded at once, not after the next render. What ends a step – a press of the pointer,
 * a key, a pause, the `hold` of a new callout – is decided by a `StepGrouper` (see stepGrouping.ts); this
 * hook only passes it the events of the page: pointer presses and releases, key presses, changes.
 *
 * `apply` restores a snapshot into the document, and the view when the step moved one.
 */
export function useUndoHistory<T, V>(h: UndoHistory<T, V>, doc: Followable<T>, apply: (d: T, view: V | undefined) => void, hold = false) {
  // Re-render when the stacks change (undo/redo buttons)
  useSyncExternalStore(h.subscribe, h.getVersion)
  const applyRef = useRef(apply)
  const grouper = useMemo(() => new StepGrouper(() => h.commit()), [h])

  useEffect(() => {
    applyRef.current = apply
  })

  useEffect(() => {
    const record = () => {
      h.change(doc.get())
      grouper.changed()
    }
    record()
    return doc.subscribe(record)
  }, [doc, h, grouper])

  // After the effect above, so a change made in the render that ends the hold joins the step first
  useEffect(() => {
    grouper.setHold(hold)
  }, [hold, grouper])

  useEffect(() => {
    const down = () => grouper.pointerDown()
    const up = () => grouper.pointerUp()
    const key = (e: KeyboardEvent) => grouper.keyDown({ repeat: e.repeat, inTextField: !!(e.target as Element | null)?.closest?.(TEXT) })
    // Capture: the step ends before the handlers of the press make the next change
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('keydown', key, true)
    return () => {
      grouper.dispose()
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [grouper])

  const undo = useCallback(() => {
    const r = h.undo()
    if (r !== undefined) applyRef.current(r.doc, r.view)
  }, [h])
  const redo = useCallback(() => {
    const r = h.redo()
    if (r !== undefined) applyRef.current(r.doc, r.view)
  }, [h])

  return { undo, redo, canUndo: h.canUndo, canRedo: h.canRedo, steps: h.started }
}
