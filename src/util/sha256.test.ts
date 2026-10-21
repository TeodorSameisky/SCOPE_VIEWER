import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256, sha256Hex } from './sha256'

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const nodeHash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

describe('sha256 (pure JS fallback)', () => {
  it('matches known test vectors', () => {
    expect(hex(sha256(new Uint8Array(0)))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('matches node crypto around block boundaries and for large inputs', () => {
    for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 2_000_003]) {
      const b = new Uint8Array(n)
      for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff
      expect(hex(sha256(b))).toBe(nodeHash(b))
    }
  })

  it('gives the same result with and without WebCrypto', async () => {
    const b = new TextEncoder().encode('scope viewer')
    expect(await sha256Hex(b)).toBe(nodeHash(b))
  })
})
