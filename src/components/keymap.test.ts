import { describe, expect, it } from 'vitest'
import { KEYS, TOOLS, TOOL_ORDER } from './keymap'

describe('keymap', () => {
  it('gives every single-key shortcut one meaning', () => {
    const single = [...TOOL_ORDER.map((t) => TOOLS[t].key), KEYS.fullRecord, KEYS.autoscale, KEYS.cursors, KEYS.readout, KEYS.overview, KEYS.measurements, KEYS.focus, KEYS.prevCallout, KEYS.nextCallout, KEYS.zoomIn, KEYS.zoomOut]
    const lower = single.map((k) => k.toLowerCase())
    expect(new Set(lower).size).toBe(lower.length)
    // As KeyboardEvent.key gives them: one character each
    for (const k of single) expect(k).toHaveLength(1)
  })

  it('explains every tool but Pan', () => {
    for (const t of TOOL_ORDER) if (t !== 'pan') expect(TOOLS[t].hint).toBeTruthy()
  })
})
