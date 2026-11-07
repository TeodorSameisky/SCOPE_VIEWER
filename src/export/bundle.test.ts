import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { BUNDLE_ANALYSIS, buildBundle, isBundleName, unpackBundle } from './bundle'

const bytes = (values: number[]): ArrayBuffer => new Uint8Array(values).buffer

describe('session bundle', () => {
  it('keeps the session files and the analysis through a round trip', async () => {
    const blob = buildBundle([{ name: 'Tek000.tss', data: bytes([1, 2, 3, 4]) }, { name: 'extra.set', data: bytes([9]) }], '{"kind":"analysis"}')
    const unpacked = unpackBundle(await blob.arrayBuffer())
    expect(unpacked.analysis).toBe('{"kind":"analysis"}')
    expect(unpacked.files.map((f) => f.name)).toEqual(['Tek000.tss', 'extra.set'])
    expect(Array.from(new Uint8Array(unpacked.files[0].data))).toEqual([1, 2, 3, 4])
    expect(Array.from(new Uint8Array(unpacked.files[1].data))).toEqual([9])
  })

  it('stores the files without recompressing them', async () => {
    const data = new Uint8Array(2000).fill(7)
    const blob = buildBundle([{ name: 'big.wfm', data: data.buffer }], '{}')
    // 2000 identical bytes would compress to a few dozen; stored, they are all there
    expect(blob.size).toBeGreaterThan(2000)
  })

  it('recognises bundle names by their extension', () => {
    expect(isBundleName('Tek000.scopeview')).toBe(true)
    expect(isBundleName('TEK000.SCOPEVIEW')).toBe(true)
    expect(isBundleName('Tek000.scopeview.json')).toBe(false)
    expect(isBundleName('Tek000.tss')).toBe(false)
  })

  it('opens a bundle that has no analysis, with the session file alone', () => {
    const zipped = zipSync({ 'files/ch1.wfm': new Uint8Array([5]) })
    const unpacked = unpackBundle(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer)
    expect(unpacked.analysis).toBeUndefined()
    expect(unpacked.files.map((f) => f.name)).toEqual(['ch1.wfm'])
  })

  it('refuses a file that is not a zip archive', () => {
    expect(() => unpackBundle(strToU8('definitely not a zip').buffer as ArrayBuffer)).toThrow(/damaged/)
  })

  it('refuses a bundle without a session file', () => {
    const zipped = zipSync({ [BUNDLE_ANALYSIS]: strToU8('{}') })
    expect(() => unpackBundle(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer)).toThrow('The .scopeview file contains no session file')
  })
})
