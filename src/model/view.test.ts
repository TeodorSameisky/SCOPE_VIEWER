import { describe, expect, it } from 'vitest'
import { POSITION_STEP, cursorsInView, stepPosition, stepScale } from './view'

describe('view', () => {
  it('steps a position without floating-point noise', () => {
    expect(stepPosition(0.3, POSITION_STEP)).toBe(0.4)
    expect(stepPosition(-0.1, -POSITION_STEP)).toBe(-0.2)
    expect(stepPosition(1.25, 1)).toBe(2.25)
  })

  it('steps V/div along 1-2-5', () => {
    expect(stepScale(1, 1)).toBe(2)
    expect(stepScale(2, 1)).toBe(5)
    expect(stepScale(1, -1)).toBe(0.5)
    expect(stepScale(0.3, 1)).toBe(0.5)
  })

  it('brings the cursors into the view at 30 % and 70 %', () => {
    const c = cursorsInView({ on: false, a: -5, b: 9, source: 'CH2' }, { start: 0, end: 10 })
    expect(c).toEqual({ on: true, a: 3, b: 7, source: 'CH2' })
  })
})
