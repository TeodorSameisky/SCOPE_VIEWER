import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadFiles } from './session'

// The example session is kept out of git; these tests only run where it exists locally.
const samplePath = new URL('../../SessionSample/Tek000.tss', import.meta.url)
const hasSample = existsSync(samplePath)

describe.skipIf(!hasSample)('Tektronix .tss session (SessionSample/Tek000.tss)', () => {
  const sample = hasSample ? readFileSync(samplePath) : Buffer.alloc(0)
  const buf = sample.buffer.slice(sample.byteOffset, sample.byteOffset + sample.byteLength)
  const s = hasSample ? loadFiles([{ name: 'Tek000.tss', data: buf }]) : undefined!

  it('reads all six channels', () => {
    expect(s.channels.map((c) => c.wave.id)).toEqual(['CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6'])
    for (const c of s.channels) {
      expect(c.wave.data.length).toBe(250000)
      expect(c.wave.dt).toBeCloseTo(40e-9, 15)
      expect(c.wave.t0).toBeCloseTo(-7.95e-3, 9)
    }
  })

  it('matches the measurements shown on the scope', () => {
    const max = (id: string) => s.channels.find((c) => c.wave.id === id)!.wave.data.reduce((m, v) => Math.max(m, v), -Infinity)
    expect(max('CH1')).toBeCloseTo(12.77, 2)
    expect(max('CH4')).toBeCloseTo(5.238, 3)
  })

  it('applies the setup', () => {
    expect(s.views).toEqual([['CH1', 'CH6', 'CH2'], ['CH4', 'CH5', 'CH3']])
    const ch5 = s.channels.find((c) => c.wave.id === 'CH5')!.display
    expect(ch5.label).toBe('STO STAT')
    expect(ch5.scale).toBe(1)
    expect(ch5.offset).toBeCloseTo(1.7)
    expect(s.horizontal?.scale).toBe(1e-3)
    expect(s.cursors?.a).toBeCloseTo(-5.588e-3, 6)
    expect(s.screenshot).toBeDefined()
  })
})
