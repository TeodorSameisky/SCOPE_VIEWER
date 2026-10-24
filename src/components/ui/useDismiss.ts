import { useEffect } from 'react'

/**
 * Close a popover on a pointer press outside `ref` (and outside `ignore`, e.g. the button that
 * toggles it) or on Escape. Escape is handled once it has bubbled up to the document, so a field
 * inside the popover can use it first (and stop it), e.g. to undo its edit; a handled Escape does
 * not reach the workspace shortcuts either.
 */
export function useDismiss(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void, ignore?: Element | null): void {
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !ignore?.contains(t)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key)
    }
  }, [ref, open, onClose, ignore])
}
