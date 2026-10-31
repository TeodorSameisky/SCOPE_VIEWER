import { describe, expect, it } from 'vitest'
import { MinMaxPyramid } from '../dsp/minmax'
import type { ChannelDisplay } from '../model/types'
import { divToValue, drawTimeAxis, drawView, gridRows, labelEvery, labelStep, layoutTags, offsetText, tagAt, viewAt, viewBoxes, viewsHeight, type TraceInput } from './draw'
import { THEMES } from './theme'

const display = (id: string, position: number, offset = 0, scale = 1, label = ''): ChannelDisplay => ({ id, label, color: '#fff', visible: true, scale, position, offset })
const traces = (...ds: ChannelDisplay[]) => ds.map((d) => ({ display: d, wave: { yUnit: 'V' } }))

// A view 200 px high: 20 px per division, the centre line at y = 100
const H = 200

describe('channel tags', () => {
  it('sit at the position of their channel, as the handles on a Tektronix scope', () => {
    const [t] = layoutTags(traces(display('CH1', 2)), H)
    expect(t.y).toBe(60)
    expect(t.level).toBe(60)
    expect(t.off).toBe(0)
    expect(t.offset).toBe('')
    // With an offset the tag marks the offset level (not 0 V) and shows the offset
    const [o] = layoutTags(traces(display('CH1', 0, 3, 2)), H)
    expect(o.y).toBe(100)
    expect(o.offset).toBe('3.00 V')
    expect(o.w).toBeGreaterThan(o.nameW)
  })

  it('stay where they are when the V/div changes (it scales around the position)', () => {
    const at = (scale: number) => layoutTags(traces(display('CH1', -1.5, 2.8, scale)), H)[0].y
    expect(at(2)).toBe(at(1))
  })

  it('show the offset with three digits, and none when it is 0', () => {
    expect(offsetText(display('CH6', 0, 0.03, 5), 'V')).toBe('30.0 mV')
    expect(offsetText(display('CH1', 0, -8.47, 5), 'V')).toBe('-8.47 V')
    expect(offsetText(display('CH1', 0, 0), 'V')).toBe('')
    expect(offsetText(display('CH1', 0, 1e-15, 1), 'V')).toBe('')
  })

  it('stay at the edge with an arrow when the position is outside the view', () => {
    const [above] = layoutTags(traces(display('CH1', 7)), H)
    expect(above.off).toBe(-1)
    expect(above.y).toBe(8)
    const [below] = layoutTags(traces(display('CH2', -9)), H)
    expect(below.off).toBe(1)
    expect(below.y).toBe(192)
  })

  it('are spread apart where they would overlap, still pointing at their own levels', () => {
    const tags = layoutTags(traces(display('CH1', 0), display('CH2', 0.1), display('CH3', -0.1)), H)
    const ys = tags.map((t) => t.y)
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(16)
    for (const t of tags) expect(t.level).toBeCloseTo(100 - t.display.position * 20)
  })

  it('never leave the view, however many there are', () => {
    const ids = ['CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'MATH1', 'MATH2']
    const tags = layoutTags(traces(...ids.map((id) => display(id, 0))), 80)
    expect(tags).toHaveLength(8)
    for (const t of tags) {
      expect(t.y).toBeGreaterThanOrEqual(8)
      expect(t.y).toBeLessThanOrEqual(72)
    }
  })

  it('are hit on the tag and its label, the one drawn last first', () => {
    const tags = layoutTags(traces(display('CH1', 0, 0, 1, 'pulse'), display('CH2', -2)), H)
    const ch1 = tags.find((t) => t.display.id === 'CH1')!
    expect(tagAt(tags, 5, ch1.y)?.display.id).toBe('CH1')
    expect(tagAt(tags, ch1.right - 1, ch1.y + 7)?.display.id).toBe('CH1')
    expect(tagAt(tags, ch1.right + 2, ch1.y)).toBeUndefined()
    expect(tagAt(tags, 5, ch1.y + 12)).toBeUndefined()
    expect(tagAt(tags, 5, 140)?.display.id).toBe('CH2')
  })
})

/** The subpaths (moveTo starts one) of the lines stroked in `color` while drawing a trace, recorded from a canvas stand-in */
function tracePaths(data: Float32Array, color: string): [number, number][][] {
  const paths: [number, number][][] = []
  let path: [number, number][][] = []
  let stroke = ''
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_, k) => {
      if (k === 'beginPath') return () => (path = [])
      if (k === 'moveTo') return (x: number, y: number) => path.push([[x, y]])
      if (k === 'lineTo') return (x: number, y: number) => path[path.length - 1].push([x, y])
      if (k === 'stroke') return () => stroke === color && paths.push(...path)
      if (k === 'measureText') return () => ({ width: 10 })
      return () => {}
    },
    set: (_, k, v) => {
      if (k === 'strokeStyle') stroke = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  const wave = { id: 'MATH1', data, t0: 0, dt: 1, yUnit: 'V', xUnit: 's' }
  drawView(ctx, {
    width: 864,
    height: 200,
    dpr: 1,
    tStart: 0,
    tEnd: data.length - 1,
    timeTicks: [],
    traces: [{ display: { ...display('MATH1', 0), color }, wave, pyramid: new MinMaxPyramid(data) }],
    theme: THEMES.dark,
  })
  return paths
}

describe('traces', () => {
  it('break at invalid samples instead of joining the samples around a gap', () => {
    // Few samples per pixel: the samples are connected
    const paths = tracePaths(new Float32Array([0, 0, 0, NaN, NaN, NaN, 1, 1, 1]), '#ff0000')
    expect(paths.map((p) => p.map(([x]) => x))).toEqual([
      [0, 100, 200],
      [600, 700, 800],
    ])
    expect(paths.flat().flat().every(Number.isFinite)).toBe(true)
  })

  it('break at columns without valid samples when drawn as an envelope', () => {
    // 10 000 samples on 800 pixels: min/max per column; samples 4000 … 5999 are a gap
    const data = Float32Array.from({ length: 10_000 }, (_, i) => (i >= 4000 && i < 6000 ? NaN : i < 4000 ? 0 : 1))
    const paths = tracePaths(data, '#ff0000')
    expect(paths).toHaveLength(2)
    expect(paths.flat().flat().every(Number.isFinite)).toBe(true)
    // The first ends where the gap starts, the second starts where it ends (at 12.5 samples per column)
    expect(paths[0][paths[0].length - 1][0]).toBeCloseTo(4000 / 12.5, -1)
    expect(paths[1][0][0]).toBeCloseTo(6000 / 12.5, -1)
  })
})

/** The fills and texts of a view with Ch 1 (green, 1 V/div, centred) triggered on a rising edge at `level` */
function drawTrigger(level: number) {
  const fills: { style: string; points: [number, number][] }[] = []
  const texts: { style: string; text: string; y: number }[] = []
  let path: [number, number][] = []
  let fill = ''
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_, k) => {
      if (k === 'beginPath') return () => (path = [])
      if (k === 'moveTo' || k === 'lineTo') return (x: number, y: number) => path.push([x, y])
      if (k === 'fill') return () => fills.push({ style: fill, points: path })
      if (k === 'fillText') return (text: string, _x: number, y: number) => texts.push({ style: fill, text, y })
      if (k === 'measureText') return () => ({ width: 10 })
      return () => {}
    },
    set: (_, k, v) => {
      if (k === 'fillStyle') fill = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  const data = new Float32Array([0, 1, 0, 1])
  drawView(ctx, {
    width: 864,
    height: 200,
    dpr: 1,
    tStart: 0,
    tEnd: 3,
    timeTicks: [],
    traces: [{ display: { ...display('CH1', 0), color: '#00ff00' }, wave: { id: 'CH1', data, t0: 0, dt: 1, yUnit: 'V', xUnit: 's' }, pyramid: new MinMaxPyramid(data) }],
    trigger: { sourceId: 'CH1', level, slope: 'RISE', showMarker: true },
    theme: THEMES.dark,
  })
  // The level arrow is at the right edge of the plot (800 px wide), the channel tag at the left
  return { arrow: fills.find((f) => f.style === '#00ff00' && f.points.some(([x]) => x >= 790))?.points, label: texts.find((t) => t.text === 'C1 ↗') }
}

describe('trigger level', () => {
  it('is an arrow in the colour of the source, with its name and slope, as on the scope', () => {
    const { arrow, label } = drawTrigger(2)
    expect(arrow).toContainEqual([800, 60])
    expect(label).toEqual({ style: '#00ff00', text: 'C1 ↗', y: 60.5 })
  })

  it('stays at the top or bottom edge, pointing out, when the level is outside the view', () => {
    const above = drawTrigger(7)
    expect(above.arrow).toContainEqual([795, 1])
    expect(above.label?.y).toBe(6.5)
    const below = drawTrigger(-7)
    expect(below.arrow).toContainEqual([795, 199])
    expect(below.label?.y).toBe(194.5)
  })
})

/** The texts written while drawing, with where and in which colour, recorded from a canvas stand-in (text 7 px per character) */
function recordTexts(draw: (ctx: CanvasRenderingContext2D) => void): { text: string; x: number; y: number }[] {
  const texts: { text: string; x: number; y: number }[] = []
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_, k) => {
      if (k === 'fillText') return (text: string, x: number, y: number) => texts.push({ text, x, y })
      if (k === 'measureText') return (text: string) => ({ width: text.length * 7 })
      return () => {}
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D
  draw(ctx)
  return texts
}

/** A trace of `samples` (one per second from t = 0) */
const trace = (d: ChannelDisplay, samples: number[]): TraceInput => {
  const data = Float32Array.from(samples)
  return { display: d, wave: { id: d.id, data, t0: 0, dt: 1, yUnit: 'V', xUnit: 's' }, pyramid: new MinMaxPyramid(data) }
}

describe('view boxes', () => {
  it('share the plot by their sizes, equally without', () => {
    expect(viewBoxes(undefined, 2, 400)).toEqual({ tops: [0, 200], heights: [200, 200] })
    expect(viewBoxes([0.25, 0.75], 2, 400)).toEqual({ tops: [0, 100], heights: [100, 300] })
    // Whole pixels that add up to the plot
    const thirds = viewBoxes([1, 1, 1], 3, 400)
    expect(thirds.heights).toEqual([133, 134, 133])
    expect(viewsHeight(thirds)).toBe(400)
    // Sizes for other views than these are left out
    expect(viewBoxes([0.25, 0.75], 3, 300).heights).toEqual([100, 100, 100])
  })

  it('are never lower than 40 px', () => {
    expect(viewBoxes([0.05, 0.95], 2, 400).heights).toEqual([40, 380])
  })

  it('find the view at a height', () => {
    const b = viewBoxes([0.25, 0.75], 2, 400)
    expect([viewAt(b, -5), viewAt(b, 99), viewAt(b, 100), viewAt(b, 450)]).toEqual([0, 0, 1, 1])
  })
})

describe('grid and scale', () => {
  it('puts the grid rows at round values of the labelled channel, as the scope moves its graticule', () => {
    // Without a channel: the 11 lines of the 10 divisions
    expect(gridRows(H)).toEqual([200, 180, 160, 140, 120, 100, 80, 60, 40, 20, 0])
    // Ch 4 of the sample session: 1 V/div, offset 2.8 V, position -0.88 div - 0 V is 3.68 div below the centre
    const ch4 = display('CH4', -0.88, 2.8, 1)
    const rows = gridRows(H, ch4)
    expect(rows).toHaveLength(10)
    expect(rows[0]).toBeCloseTo(193.6)
    for (const y of rows) {
      const v = divToValue((H / 2 - y) / 20, ch4)
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-9)
    }
  })

  it('labels round values far enough apart, on the rows when the V/div is 1-2-5', () => {
    expect(labelStep(1, 20)).toBe(1)
    // 6.9 px per division (six stacked views): every 4th row at 5 V/div, every 5th at 2 V/div
    expect(labelStep(5, 6.9)).toBe(20)
    expect(labelStep(2, 6.9)).toBe(10)
    // After a zoom rectangle (304.3 mV/div): round values between the rows
    expect(labelStep(0.3043, 20)).toBe(0.5)
    expect(labelStep(0.3043, 6)).toBe(1)
  })

  it('writes each scale label at the height of its value', () => {
    const d = { ...display('CH4', 0, 5.22589, 0.3043), color: '#00ff00' }
    const labels = recordTexts((ctx) =>
      drawView(ctx, { width: 864, height: H, dpr: 1, tStart: 0, tEnd: 1, timeTicks: [], traces: [trace(d, [5, 5.5])], axisChannel: trace(d, [5, 5.5]), theme: THEMES.dark }),
    ).filter((t) => t.x === 806)
    expect(labels.map((l) => l.text)).toEqual(['4 V', '4.5 V', '5 V', '5.5 V', '6 V', '6.5 V'])
    for (const l of labels) expect(divToValue((H / 2 - l.y) / 20, d)).toBeCloseTo(parseFloat(l.text), 6)
  })

  it('labels the whole height of the view, also when the traces do not cross', () => {
    // Two flat traces far apart (a quiet stretch): Ch 1 at 3 V, Ch 2 two divisions lower
    const ch1 = { ...trace(display('CH1', 0), [3, 3]), display: { ...display('CH1', 0), color: '#00ff00' } }
    const ch2 = trace(display('CH2', -2), [-3, -3])
    const labels = recordTexts((ctx) =>
      drawView(ctx, { width: 864, height: H, dpr: 1, tStart: 0, tEnd: 1, timeTicks: [], traces: [ch1, ch2], axisChannel: ch1, theme: THEMES.dark }),
    ).filter((t) => t.x === 806)
    // -5 V and 5 V are on the edges of the view
    expect(labels.map((l) => l.text)).toEqual(['-4 V', '-3 V', '-2 V', '-1 V', '0 V', '1 V', '2 V', '3 V', '4 V'])
  })

  it('leaves out time labels that would run into each other', () => {
    expect(labelEvery(80, 45)).toBe(1)
    expect(labelEvery(27, 45)).toBe(2)
    expect(labelEvery(10, 45)).toBe(5)
    // A phone: 10 ticks of 1 ms on 267 px - every second one is labelled
    const ticks = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2].map((t) => t * 1e-3)
    const labels = recordTexts((ctx) => drawTimeAxis(ctx, 331, 24, 1, -7.95e-3, 2.05e-3, ticks, THEMES.dark))
    expect(labels.map((l) => l.text)).toEqual(['-6 ms', '-4 ms', '-2 ms', '0 s', '2 ms'])
    for (let i = 1; i < labels.length; i++) expect(labels[i].x - labels[i - 1].x).toBeGreaterThan(40)
  })
})
