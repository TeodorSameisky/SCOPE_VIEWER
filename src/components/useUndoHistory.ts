import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { UndoHistory } from '../model/undoHistory'

/** A pause this long ends a step (typing, wheel gestures) */
const IDLE_MS = 700
/** Typing in these does not end a step */
const TEXT = 'input, textarea, select, [contenteditable="true"]'

/**
 * Records every change of `doc` (a document built from React state) in `h`. A step ends when the
 * next gesture starts (pointer press, key press outside text fields) or after a pause without the
 * pointer held down, so a drag, a wheel gesture or a burst of typing is one step. Releasing the
 * pointer does not end the step itself: React may apply the last move of a drag only after the
 * release, and it belongs to the same step. Neither does a key pressed during a drag (Esc puts it
 * back, which leaves no step) or a key held down (its repeats are one step).
 *
 * While `hold` is true the step stays open across gestures and pauses (a new callout and what is
 * written into it); it ends once `hold` turns false, together with the change made then (an empty
 * new note that is discarded leaves no step).
 *
 * `apply` restores a snapshot into the state, and the view when the step moved one.
 */
export function useUndoHistory<T, V>(h: UndoHistory<T, V>, doc: T, apply: (d: T, view: V | undefined) => void, hold = false) {
  // Re-render when the stacks change (undo/redo buttons)
  useSyncExternalStore(h.subscribe, h.getVersion)
  const applyRef = useRef(apply)
  const pointerDown = useRef(false)
  const held = useRef(hold)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    applyRef.current = apply
  })

  const commitWhenIdle = useCallback(() => {
    window.clearTimeout(timer.current)
    // While the pointer is held down (a drag) the step stays open
    timer.current = window.setTimeout(() => !pointerDown.current && !held.current && h.commit(), IDLE_MS)
  }, [h])

  useEffect(() => {
    h.change(doc)
    commitWhenIdle()
  }, [doc, h, commitWhenIdle])

  // After the change above: the render that ends the hold may also make the last change of the step
  useEffect(() => {
    held.current = hold
    if (!hold) h.commit()
  }, [hold, h])

  useEffect(() => {
    const down = () => {
      pointerDown.current = true
      if (!held.current) h.commit()
    }
    const up = () => {
      pointerDown.current = false
      commitWhenIdle()
    }
    const key = (e: KeyboardEvent) => {
      if (e.repeat || pointerDown.current || held.current || (e.target as Element | null)?.closest?.(TEXT)) return
      h.commit()
    }
    // Capture: the step ends before the handlers of the press make the next change
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.clearTimeout(timer.current)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [h, commitWhenIdle])

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
