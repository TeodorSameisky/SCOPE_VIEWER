/**
 * The mouse wheel and trackpad gestures, the same in the plot, the overview and the spectrum:
 * the wheel zooms, Shift+wheel and sideways swipes pan.
 */

/** Wheel deltas in pixels (line and page modes converted) */
export function wheelPixels(e: WheelEvent): { x: number; y: number } {
  const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1
  return { x: e.deltaX * k, y: e.deltaY * k }
}

/** Zoom factor of a vertical wheel delta (px), > 1 zooms out; proportional, so trackpads and fast wheels feel natural */
export function wheelZoomFactor(dy: number): number {
  return Math.min(4, Math.max(0.25, Math.pow(1.0022, dy)))
}

/**
 * How far a wheel event pans (px, positive = towards later times / higher frequencies), or
 * undefined when it zooms. Shift+wheel arrives as deltaY in some browsers and as deltaX in others
 * (macOS); a sideways trackpad swipe pans without Shift.
 */
export function wheelPan(e: WheelEvent): number | undefined {
  const { x, y } = wheelPixels(e)
  if (e.shiftKey) return Math.abs(x) > Math.abs(y) ? x : y
  return Math.abs(x) > Math.abs(y) ? x : undefined
}

/** Share of the view a pan of `px` moves: a tenth per notch of a mouse wheel (100 px), less for small trackpad steps */
export function panShare(px: number): number {
  return Math.max(-0.5, Math.min(0.5, px / 1000))
}
