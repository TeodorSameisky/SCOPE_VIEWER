import { describe, expect, it } from 'vitest'
import { upgrade, versionOf, type MigrationStep } from './migrations'

describe('versionOf', () => {
  it('reads the version, and counts data from before versions as the first', () => {
    expect(versionOf({ version: 3 })).toBe(3)
    expect(versionOf({})).toBe(1)
    expect(versionOf({ version: 'x' })).toBe(1)
    expect(versionOf({ version: 0 })).toBe(1)
    expect(versionOf({ version: 1.5 })).toBe(1)
    expect(versionOf(null)).toBe(1)
    expect(versionOf('text')).toBe(1)
  })
})

describe('upgrade', () => {
  // Version 2 renamed `title` to `name`; version 3 made `size` a number of two parts
  const steps: Record<number, MigrationStep> = {
    1: ({ title, ...rest }) => ({ ...rest, name: title }),
    2: ({ size, ...rest }) => ({ ...rest, size: { w: size, h: size } }),
  }

  it('runs the steps between the versions, in order, and sets the version', () => {
    expect(upgrade({ version: 1, title: 'a', size: 4 }, 1, 3, steps)).toEqual({ version: 3, name: 'a', size: { w: 4, h: 4 } })
    expect(upgrade({ version: 2, name: 'a', size: 4 }, 2, 3, steps)).toEqual({ version: 3, name: 'a', size: { w: 4, h: 4 } })
  })

  it('leaves data of the current or a newer version as it is', () => {
    const current = { version: 3, name: 'a' }
    expect(upgrade(current, 3, 3, steps)).toBe(current)
    const newer = { version: 9, whatever: true }
    expect(upgrade(newer, 9, 3, steps)).toBe(newer)
  })

  it('does not change what it is given', () => {
    const old = { version: 1, title: 'a', size: 4 }
    upgrade(old, 1, 3, steps)
    expect(old).toEqual({ version: 1, title: 'a', size: 4 })
  })

  it('gives nothing back for data that is no object, or when a step is missing or fails', () => {
    expect(upgrade('text', 1, 2, steps)).toBeUndefined()
    expect(upgrade(null, 1, 2, steps)).toBeUndefined()
    expect(upgrade([1], 1, 2, steps)).toBeUndefined()
    expect(upgrade({}, 3, 4, steps)).toBeUndefined()
    expect(upgrade({ version: 1 }, 1, 2, { 1: () => { throw new Error('broken') } })).toBeUndefined()
  })
})
