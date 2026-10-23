import { describe, expect, it } from 'vitest'
import type { Channel } from '../model/types'
import { channelName, channelTag, slopeSymbol, triggerText } from './names'

const channel = (id: string, yUnit: string): Channel => ({
  wave: { id, data: new Float32Array(2), t0: 0, dt: 1, yUnit, xUnit: 's' },
  display: { id, label: '', color: '#fff', visible: true, scale: 1, position: 0, offset: 0 },
})

describe('names', () => {
  it('names channels like the scope', () => {
    expect(channelName('CH1')).toBe('Ch 1')
    expect(channelName('MATH2')).toBe('Math 2')
    expect(channelName('REF3')).toBe('Ref 3')
    expect(channelName('AUX')).toBe('AUX')
    expect(channelTag('MATH2')).toBe('M2')
  })

  it('shows trigger slopes as arrows', () => {
    expect(slopeSymbol('RISE')).toBe('↗')
    expect(slopeSymbol('FALL')).toBe('↘')
    expect(slopeSymbol('EITHER')).toBe('↕')
    expect(slopeSymbol('EITH')).toBe('↕')
    expect(slopeSymbol(undefined)).toBe('')
  })

  it('shows the trigger level in the unit of its source', () => {
    const channels = [channel('CH1', 'V'), channel('CH2', 'A')]
    expect(triggerText({ channels, trigger: { source: 'CH2', level: 0.5, slope: 'FALL' } })).toBe('Ch 2 ↘ 500 mA')
    expect(triggerText({ channels, trigger: { source: 'CH1', level: 1.2, slope: 'RISE' } }, 4)).toBe('Ch 1 ↗ 1.200 V')
    // Sources without a waveform: volts
    expect(triggerText({ channels, trigger: { source: 'AUX', level: 2 } })).toBe('AUX 2.00 V')
    expect(triggerText({ channels, trigger: { source: 'LINE' } })).toBe('LINE')
    expect(triggerText({ channels })).toBe('')
  })
})
