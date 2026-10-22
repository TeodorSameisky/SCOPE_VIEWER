import { describe, expect, it } from 'vitest'
import { planEviction, type StoredFileInfo } from './fileStore'
import { mergeRecent } from './recent'

const MB = 1024 * 1024
const file = (fingerprint: string, bytes: number, lastOpened: string): StoredFileInfo => ({ fingerprint, fileName: `${fingerprint}.tss`, bytes, lastOpened })

describe('kept session files', () => {
  it('drops the least recently opened sessions until a new one fits', () => {
    const kept = [file('a', 400 * MB, '2026-10-01'), file('b', 300 * MB, '2026-10-20'), file('c', 200 * MB, '2026-10-10')]
    expect(planEviction(kept, { fingerprint: 'new', bytes: 50 * MB }, 1000 * MB)).toEqual([])
    expect(planEviction(kept, { fingerprint: 'new', bytes: 200 * MB }, 1000 * MB)).toEqual(['a'])
    expect(planEviction(kept, { fingerprint: 'new', bytes: 700 * MB }, 1000 * MB)).toEqual(['a', 'c'])
    // a session that is already kept is replaced, not counted twice
    expect(planEviction(kept, { fingerprint: 'b', bytes: 300 * MB }, 1000 * MB)).toEqual([])
    expect(planEviction(kept, { fingerprint: 'huge', bytes: 2000 * MB }, 1000 * MB)).toBeUndefined()
  })
})

describe('recent sessions', () => {
  it('merges saved analyses and kept files, newest first', () => {
    const list = mergeRecent(
      [
        { fingerprint: 'a', fileName: 'a.tss', savedAt: '2026-10-21T10:00:00Z', bytes: 3000 },
        { fingerprint: 'b', fileName: 'b.tss', savedAt: '2026-10-19T10:00:00Z', bytes: 2000 },
      ],
      [file('b', 2 * MB, '2026-10-22T09:00:00Z'), file('c', 5 * MB, '2026-10-20T09:00:00Z')],
    )
    expect(list.map((r) => [r.fingerprint, r.analysisBytes, r.fileBytes])).toEqual([
      ['b', 2000, 2 * MB],
      ['a', 3000, undefined],
      ['c', undefined, 5 * MB],
    ])
    expect(list[0].lastUsed).toBe('2026-10-22T09:00:00Z')
  })
})
