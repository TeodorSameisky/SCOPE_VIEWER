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
 * release, and it belongs to the same step. `apply` restores a snapshot into the state.
 */
export function useUndoHistory<T>(h: UndoHistory<T>, doc: T, apply: (d: T) => void) {
  // Re-render when the stacks change (undo/redo buttons)
  useSyncExternalStore(h.subscribe, h.getVersion)
  const applyRef = useRef(apply)
  const pointerDown = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    applyRef.current = apply
  })

  const commitWhenIdle = useCallback(() => {
    window.clearTimeout(timer.current)
    // While the pointer is held down (a drag) the step stays open
    timer.current = window.setTimeout(() => !pointerDown.current && h.commit(), IDLE_MS)
  }, [h])

  useEffect(() => {
    h.change(doc)
    commitWhenIdle()
  }, [doc, h, commitWhenIdle])

  useEffect(() => {
    const down = () => {
      pointerDown.current = true
      h.commit()
    }
    const up = () => {
      pointerDown.current = false
      commitWhenIdle()
    }
    const key = (e: KeyboardEvent) => {
      if (!(e.target as Element | null)?.closest?.(TEXT)) h.commit()
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
    const d = h.undo()
    if (d !== undefined) applyRef.current(d)
  }, [h])
  const redo = useCallback(() => {
    const d = h.redo()
    if (d !== undefined) applyRef.current(d)
  }, [h])

  return { undo, redo, canUndo: h.canUndo, canRedo: h.canRedo, steps: h.started }
}
