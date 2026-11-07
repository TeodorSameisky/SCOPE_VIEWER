import { describe, expect, it } from 'vitest'
import { actionsOf, command, menuItem, paletteEntries, shortcutMap, type Action } from './action'

const act = (label: string, over: Partial<Action> = {}): Action => ({ label, run: () => {}, ...over })

describe('actionsOf', () => {
  it('lists the actions of a catalogue, also those in records of actions', () => {
    const undo = act('Undo')
    const pan = act('Pan')
    const zoom = act('Zoom')
    const image = act('Image')
    const list = actionsOf({ undo, tools: { pan, zoom }, exports: { image }, other: 5, nothing: undefined, nested: { text: 'x' } })
    expect(list).toEqual([undo, pan, zoom, image])
  })

  it('keeps the order of the members', () => {
    const [a, b, c] = [act('a'), act('b'), act('c')]
    expect(actionsOf({ b, group: { c }, a })).toEqual([b, c, a])
  })
})

describe('shortcutMap', () => {
  it('binds one-character hints, by the key in lower case', () => {
    const full = act('Full', { hint: 'F' })
    const plus = act('In', { hint: '+' })
    const comma = act('Prev', { hint: ',' })
    expect(shortcutMap([full, plus, comma])).toEqual({ f: full, '+': plus, ',': comma })
  })

  it('does not bind hints that are longer, or actions without one', () => {
    expect(shortcutMap([act('Undo', { hint: 'Ctrl+Z' }), act('Back', { hint: 'Backspace' }), act('Open')])).toEqual({})
  })
})

describe('paletteEntries', () => {
  it('makes a command of each action with palette info, with its id and group', () => {
    const a = act('Full record', { hint: 'F', palette: { id: 'view:full', group: 'View' } })
    const [entry] = paletteEntries([a, act('Not listed')])
    expect(entry).toMatchObject({ id: 'view:full', group: 'View', label: 'Full record', hint: 'F' })
    expect(entry.run).toBe(a.run)
  })

  it('takes the label and keywords the info gives instead', () => {
    const a = act('Focus: hide all panels', { palette: { id: 'view:focus', group: 'View', label: 'Focus mode', keywords: 'zen' } })
    expect(paletteEntries([a])[0]).toMatchObject({ label: 'Focus mode', keywords: 'zen' })
  })

  it('keeps the order, and can be limited to a group', () => {
    const list = [
      act('A', { palette: { id: 'x:a', group: 'X' } }),
      act('B', { palette: { id: 'y:b', group: 'Y' } }),
      act('C', { palette: { id: 'x:c', group: 'X' } }),
    ]
    expect(paletteEntries(list).map((c) => c.id)).toEqual(['x:a', 'y:b', 'x:c'])
    expect(paletteEntries(list, 'X').map((c) => c.id)).toEqual(['x:a', 'x:c'])
    expect(paletteEntries(list, 'Z')).toEqual([])
  })

  it('leaves out an action that is not available', () => {
    const a = act('Undo', { disabled: true, palette: { id: 'edit:undo', group: 'Edit' } })
    expect(paletteEntries([a])).toEqual([])
  })
})

describe('command and menuItem', () => {
  it('give the same label, shortcut and state as the action', () => {
    const a = act('Cursors', { hint: 'C', checked: true })
    expect(command('view:cursors', 'View', a)).toMatchObject({ label: 'Cursors', hint: 'C', checked: true })
    expect(menuItem(a)).toMatchObject({ label: 'Cursors', hint: 'C', checked: true, onClick: a.run })
  })
})
