import { describe, expect, it } from 'vitest'
import { MinMaxPyramid } from '../dsp/minmax'
import type { Callout } from '../model/callouts'
import type { LiveChannel } from '../model/view'
import { calloutsSvg, layoutCallouts, stackRows, type CalloutLayout } from './callouts'
import { DARK_THEME, LIGHT_THEME } from './theme'

/** A flat trace at `level` over 0…10 s */
const channel = (id: string, level: number, visible = true): LiveChannel => {
  const data = new Float32Array(11).fill(level)
  return {
    wave: { id, data, t0: 0, dt: 1, yUnit: 'V', xUnit: 's' },
    display: { id, label: '', color: '#fff', visible, scale: 1, position: 0, offset: 0 },
    pyramid: new MinMaxPyramid(data),
  }
}
// Two views 200 px high (20 px per division), 10 s across 100 px
const layout = (channels: LiveChannel[], boxes = { tops: [0, 200], heights: [200, 200] }): CalloutLayout => ({
  channels,
  views: [['CH1'], ['CH2']],
  win: { start: 0, end: 10 },
  plotW: 100,
  boxes,
})
const base: Callout = { id: 'x', n: 1, type: 'box', t: 2, t2: 4, text: '', color: '#fff' }

describe('box geometry', () => {
  it('frames the time span and the values of its channel', () => {
    const g = layoutCallouts([{ ...base, channel: 'CH1', v: -2, v2: 2 }], layout([channel('CH1', 0), channel('CH2', 0)])).get('x')
    expect(g).toMatchObject({ type: 'box', x: 20, w: 20, y: 60, h: 80, shape: 'rect' })
  })

  it('stays inside its view, and is hidden with its channel', () => {
    const p = layout([channel('CH1', 0), channel('CH2', 0)])
    // From 2 V up to 20 V: cut at the top of the view of CH2 (y = 200)
    expect(layoutCallouts([{ ...base, channel: 'CH2', v: 2, v2: 20 }], p).get('x')).toMatchObject({ y: 200, h: 60 })
    expect(layoutCallouts([{ ...base, channel: 'CH2', v: 20, v2: 30 }], p).get('x')).toBeUndefined()
    expect(layoutCallouts([{ ...base, channel: 'CH1', v: -1, v2: 1 }], layout([channel('CH1', 0, false)])).get('x')).toBeUndefined()
  })

  it('takes the height of its own view when the views differ in height', () => {
    // View 2 from y = 100, 300 px high (30 px per division): -2 … 2 V is y 190 … 310
    const g = layoutCallouts([{ ...base, channel: 'CH2', v: -2, v2: 2 }], layout([channel('CH1', 0), channel('CH2', 0)], { tops: [0, 100], heights: [100, 300] })).get('x')
    expect(g).toMatchObject({ y: 190, h: 120 })
  })

  it('is left out with a view whose channels are all hidden', () => {
    const shown = { tops: [0, 400], heights: [400, 0] }
    expect(layoutCallouts([{ ...base, view: 1, div: 1, div2: -1 }], layout([channel('CH1', 0), channel('CH2', 0, false)], shown)).get('x')).toBeUndefined()
    const note: Callout = { id: 'n', n: 2, type: 'note', t: 3, text: 'here', color: '#fff', view: 1, div: 0 }
    expect(layoutCallouts([note], layout([channel('CH1', 0), channel('CH2', 0, false)], shown)).get('n')).toBeUndefined()
  })

  it('can be free in a view', () => {
    const g = layoutCallouts([{ ...base, view: 1, div: 1, div2: -1, shape: 'ellipse' }], layout([channel('CH1', 0), channel('CH2', 0)])).get('x')
    expect(g).toMatchObject({ y: 280, h: 40, shape: 'ellipse' })
  })
})

describe('span geometry', () => {
  it('joins its ends on their traces, with the dimension line below the lower one', () => {
    const span: Callout = { ...base, type: 'span', t: 2, t2: 6, channel: 'CH1', channel2: 'CH2' }
    const g = layoutCallouts([span], layout([channel('CH1', 1), channel('CH2', -1)])).get('x')
    // CH1 at 1 V: 1 div above the centre of view 1; CH2 at -1 V: 1 div below the centre of view 2
    expect(g).toMatchObject({ type: 'span', xa: 20, ya: 80, xb: 60, yb: 320, y: 344 })
    expect(g?.type === 'span' && g.label.runs.map((r) => r.text).join('')).toBe('Span 1  Δt 4.000 s')
  })

  it('is hidden when an end has no trace', () => {
    const span: Callout = { ...base, type: 'span', t: 2, t2: 6, channel: 'CH1', channel2: 'CH3' }
    expect(layoutCallouts([span], layout([channel('CH1', 1), channel('CH2', -1)])).get('x')).toBeUndefined()
  })
})

describe('stackRows', () => {
  it('keeps labels that do not overlap in one row', () => {
    expect(stackRows([{ x: 0, w: 40 }, { x: 50, w: 40 }, { x: 100, w: 10 }])).toEqual([0, 0, 0])
  })

  it('moves an overlapping label to the next row', () => {
    expect(stackRows([{ x: 0, w: 40 }, { x: 17, w: 54 }])).toEqual([0, 1])
  })

  it('reuses the first row that has room, whatever the input order', () => {
    // b overlaps a; c fits after a in row 0 again
    expect(stackRows([{ x: 200, w: 30 }, { x: 0, w: 100 }, { x: 50, w: 100 }])).toEqual([0, 0, 1])
  })

  it('keeps a gap between labels in a row', () => {
    expect(stackRows([{ x: 0, w: 40 }, { x: 42, w: 10 }])).toEqual([0, 1])
    expect(stackRows([{ x: 0, w: 40 }, { x: 44, w: 10 }])).toEqual([0, 0])
  })
})

describe('callouts as an SVG document for export', () => {
  const p = layout([channel('CH1', 0), channel('CH2', 0)])
  const note: Callout = { id: 'n', n: 1, type: 'note', t: 3, channel: 'CH1', dx: 10, dy: -30, text: 'a <b> & "c"', color: '#ffd84d' }
  const marker: Callout = { id: 'm', n: 2, type: 'marker', t: 6, text: 'edge', color: '#ff5a6a' }
  const region: Callout = { id: 'r', n: 3, type: 'region', t: 2, t2: 8, text: 'window', color: '#3fb6ff' }

  /** Every opened tag is closed in order, as XML needs (the document is loaded as an image, which refuses anything else) */
  function wellFormed(xml: string): boolean {
    const stack: string[] = []
    for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:-]*)[^>]*?(\/?)>/g)) {
      const [, closing, name, selfClosing] = m
      if (selfClosing) continue
      if (!closing) stack.push(name)
      else if (stack.pop() !== name) return false
    }
    return stack.length === 0
  }

  it('is a document of the size of the plot, written without a DOM', async () => {
    const svg = await calloutsSvg([note, marker, region], p, DARK_THEME)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="400" viewBox="0 0 100 400">')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(wellFormed(svg)).toBe(true)
  })

  it('has the texts of the callouts, escaped', async () => {
    const svg = await calloutsSvg([note, marker, region], p, DARK_THEME)
    expect(svg).toContain('edge')
    expect(svg).toContain('window')
    expect(svg).toContain('a &lt;b&gt; &amp; &quot;c&quot;')
    expect(svg).not.toContain('<b>')
  })

  it('shows a formula as its source until it is rendered', async () => {
    const svg = await calloutsSvg([{ ...note, text: 'decay $e^{-t}$' }], p, DARK_THEME)
    expect(svg).toContain('e^{-t}')
    expect(wellFormed(svg)).toBe(true)
  })

  it('draws the colours as they look in the theme: pale ones darker in the light theme', async () => {
    const dark = await calloutsSvg([note], p, DARK_THEME)
    const light = await calloutsSvg([note], p, LIGHT_THEME)
    expect(dark).toContain('#ffd84d')
    expect(LIGHT_THEME.ink('#ffd84d')).not.toBe('#ffd84d')
    expect(light).toContain(LIGHT_THEME.ink('#ffd84d'))
    expect(light).not.toContain('#ffd84d')
  })

  it('has no shapes for the handles that are only there on screen', async () => {
    expect(await calloutsSvg([note, marker, region], p, DARK_THEME)).not.toContain('transparent')
  })

  it('leaves out callouts of hidden channels, and is an empty document without callouts', async () => {
    const hidden = layout([channel('CH1', 0, false), channel('CH2', 0)])
    expect(await calloutsSvg([note], hidden, DARK_THEME)).not.toContain('&lt;b&gt;')
    const empty = await calloutsSvg([], p, DARK_THEME)
    expect(empty).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="400" viewBox="0 0 100 400"></svg>')
  })
})
