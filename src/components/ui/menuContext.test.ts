import { describe, expect, it } from 'vitest'
import { normalizeMenu, type MenuEntry } from './menuContext'

const item = (label: string): MenuEntry => ({ label, onClick: () => {} })
const labels = (entries: MenuEntry[]) => normalizeMenu(entries).map((e) => (e === '-' ? '-' : e.label))

describe('normalizeMenu', () => {
  it('skips conditional entries', () => {
    expect(labels([item('a'), false, null, undefined, 0, '', item('b')])).toEqual(['a', 'b'])
  })

  it('drops separators at the ends and repeated separators', () => {
    expect(labels(['-', item('a'), '-', false, '-', item('b'), '-', '-'])).toEqual(['a', '-', 'b'])
  })

  it('drops a separator whose following items were all skipped', () => {
    expect(labels([item('a'), '-', null])).toEqual(['a'])
  })
})
