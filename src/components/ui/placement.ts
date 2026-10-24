/** Where floating boxes (popovers, menus) go: next to what opened them, inside the window. */

/** Least distance between a floating box and the edges of the window (px) */
export const EDGE = 8

/**
 * A popover of `width` below or above `anchor` (fixed position), on the preferred side if it has
 * room for most popovers (360 px) or at least as much as the other side. Its left edge is at the
 * anchor's, kept inside the window; it scrolls when it is taller than the room it gets.
 */
export function placeNear(anchor: DOMRect, width: number, prefer: 'below' | 'above', gap = 6): React.CSSProperties {
  const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - width - EDGE))
  const below = window.innerHeight - anchor.bottom - gap - EDGE
  const above = anchor.top - gap - EDGE
  const preferred = prefer === 'below' ? below : above
  const other = prefer === 'below' ? above : below
  const onPreferred = preferred >= 360 || preferred >= other
  const useBelow = prefer === 'below' ? onPreferred : !onPreferred
  return useBelow
    ? { position: 'fixed', left, top: anchor.bottom + gap, maxHeight: below, overflowY: 'auto' }
    : { position: 'fixed', left, bottom: window.innerHeight - anchor.top + gap, maxHeight: above, overflowY: 'auto' }
}

/** A popover left of `anchor`, its bottom at the anchor's, growing upwards (as much room as there is) */
export function placeLeftOf(anchor: DOMRect, gap = EDGE): React.CSSProperties {
  const bottom = Math.max(EDGE, window.innerHeight - anchor.bottom)
  return {
    position: 'fixed',
    right: window.innerWidth - anchor.left + gap,
    bottom,
    maxHeight: window.innerHeight - bottom - EDGE,
    maxWidth: Math.max(200, anchor.left - gap - EDGE),
    overflowY: 'auto',
  }
}

/** Top-left corner for a box of w × h opened at (x, y): to the left of / above the point when there is no room */
export function fitInWindow(x: number, y: number, w: number, h: number, margin = 4): { left: number; top: number } {
  return {
    left: x + w > window.innerWidth - margin ? Math.max(margin, x - w) : x,
    top: y + h > window.innerHeight - margin ? Math.max(margin, window.innerHeight - margin - h) : y,
  }
}
