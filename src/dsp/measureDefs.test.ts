import { describe, expect, it } from 'vitest'
import { measurementDef, missingReason } from './measureDefs'

describe('missing measurements', () => {
  const timing = measurementDef('frequency')
  const amplitude = measurementDef('max')

  it('says what is missing', () => {
    expect(missingReason(timing, { count: 0, levelsOk: false }, 'screen')).toMatch(/No samples/)
    expect(missingReason(timing, { count: 100, levelsOk: false }, 'screen')).toMatch(/No clear signal levels/)
    expect(missingReason(timing, { count: 100, levelsOk: true }, 'screen')).toMatch(/Not enough edges/)
    expect(missingReason(amplitude, { count: 100, levelsOk: true }, 'screen')).toBe('Not available')
  })

  it('does not suggest the whole record when the whole record is measured', () => {
    expect(missingReason(timing, { count: 100, levelsOk: true }, 'cursors')).toMatch(/whole record/)
    expect(missingReason(timing, { count: 100, levelsOk: true }, 'record')).not.toMatch(/whole record|zoom/)
  })
})
