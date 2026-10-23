import { describe, expect, it } from 'vitest'
import { MAX_RECENT_COMMANDS, rememberCommand, searchCommands, type Command } from './commandSearch'

const cmd = (id: string, label: string, group: string, keywords?: string): Command => ({ id, label, group, keywords, run: () => {} })

const commands = [
  cmd('view:full', 'Full record', 'View'),
  cmd('view:in', 'Zoom in', 'View'),
  cmd('tool:zoom', 'Zoom tool', 'Tool'),
  cmd('ch:autoscale:CH1', 'Autoscale Ch 1 · pulse', 'Channel', 'CH1'),
  cmd('ch:only:CH1', 'Show only Ch 1 · pulse', 'Channel', 'CH1'),
  cmd('meas:add:riseTime', 'Add measurement: Rise time', 'Measurements', 'Duration of the first rising edge'),
  cmd('theme:light', 'Appearance: Light', 'Appearance', 'theme colours mode'),
]
const ids = (list: Command[]) => list.map((c) => c.id)

describe('command search', () => {
  it('lists everything without a query, recently used first', () => {
    expect(ids(searchCommands(commands, '  '))).toEqual(ids(commands))
    expect(ids(searchCommands(commands, '', ['theme:light', 'view:in'])).slice(0, 3)).toEqual(['theme:light', 'view:in', 'view:full'])
  })

  it('needs every word, in the label, group or keywords', () => {
    expect(ids(searchCommands(commands, 'zoom'))).toEqual(['view:in', 'tool:zoom'])
    expect(ids(searchCommands(commands, 'zoom tool'))).toEqual(['tool:zoom'])
    expect(ids(searchCommands(commands, 'ch1'))).toEqual(['ch:autoscale:CH1', 'ch:only:CH1'])
    expect(ids(searchCommands(commands, 'dark mode'))).toEqual([])
    expect(ids(searchCommands(commands, 'theme'))).toEqual(['theme:light'])
  })

  it('ranks labels that start with the query, then words that start with it', () => {
    // "pulse" is a later word of the channel labels, "rising" only in the keywords
    expect(ids(searchCommands(commands, 'rise'))).toEqual(['meas:add:riseTime'])
    expect(ids(searchCommands(commands, 'show'))[0]).toBe('ch:only:CH1')
    expect(ids(searchCommands(commands, 'rec'))).toEqual(['view:full'])
    expect(ids(searchCommands([cmd('a', 'Fullrecord', 'X', 'zoom'), cmd('b', 'Zoom out', 'View')], 'zoom'))).toEqual(['b', 'a'])
    expect(ids(searchCommands([cmd('a', 'Unzoom', 'X'), cmd('b', 'Big zoom', 'X')], 'zoom'))).toEqual(['b', 'a'])
  })

  it('remembers the latest commands, each once', () => {
    expect(rememberCommand(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    const many = Array.from({ length: 20 }, (_, i) => `c${i}`)
    expect(rememberCommand(many, 'x')).toHaveLength(MAX_RECENT_COMMANDS)
  })
})
