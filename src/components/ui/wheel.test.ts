import { describe, expect, it } from 'vitest'
import { panShare, wheelPan, wheelPixels, wheelZoomFactor } from './wheel'

const wheel = (o: Partial<WheelEvent>) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, ...o }) as WheelEvent

describe('wheel', () => {
  it('pans with Shift+wheel in both directions, however the browser reports it', () => {
    // Windows / Linux: the vertical delta with Shift held
    expect(wheelPan(wheel({ shiftKey: true, deltaY: 100 }))).toBe(100)
    expect(wheelPan(wheel({ shiftKey: true, deltaY: -100 }))).toBe(-100)
    // macOS turns Shift+wheel into a horizontal delta
    expect(wheelPan(wheel({ shiftKey: true, deltaX: 100 }))).toBe(100)
    expect(wheelPan(wheel({ shiftKey: true, deltaX: -100 }))).toBe(-100)
  })

  it('pans with a sideways swipe and zooms with a vertical one', () => {
    expect(wheelPan(wheel({ deltaX: -40, deltaY: 3 }))).toBe(-40)
    expect(wheelPan(wheel({ deltaY: 100 }))).toBeUndefined()
    expect(wheelZoomFactor(0)).toBe(1)
    expect(wheelZoomFactor(100)).toBeGreaterThan(1)
    expect(wheelZoomFactor(-100)).toBeLessThan(1)
    expect(wheelZoomFactor(1e6)).toBe(4)
  })

  it('converts lines to pixels and pans a tenth of the view per notch', () => {
    expect(wheelPixels(wheel({ deltaMode: 1, deltaY: 3 })).y).toBe(99)
    expect(panShare(100)).toBeCloseTo(0.1)
    expect(panShare(-5000)).toBe(-0.5)
  })
})
