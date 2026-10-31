import { describe, expect, it } from 'vitest'
import type { ChannelDisplay, Waveform } from '../model/types'
import { measuredChannels } from './measureRows'

const channel = (id: string, visible = true) => ({
  wave: { id } as Waveform,
  display: { id, visible } as ChannelDisplay,
})

describe('channels of the measurement table', () => {
  const all = [channel('CH1'), channel('CH2'), channel('CH3', false), channel('MATH1')]

  it('has a row for every visible channel by default', () => {
    expect(measuredChannels(all, []).map((c) => c.wave.id)).toEqual(['CH1', 'CH2', 'MATH1'])
  })

  it('leaves out the channels that are excluded, whether or not they are visible', () => {
    expect(measuredChannels(all, ['CH2', 'CH3']).map((c) => c.wave.id)).toEqual(['CH1', 'MATH1'])
    expect(measuredChannels(all, ['CH1', 'CH2', 'MATH1'])).toEqual([])
  })

  it('measures a channel that is made later', () => {
    expect(measuredChannels([...all, channel('MATH2')], ['CH2']).map((c) => c.wave.id)).toEqual(['CH1', 'MATH1', 'MATH2'])
  })
})
