import { describe, expect, it } from 'vitest'
import { MinMaxPyramid } from '../dsp/minmax'
import type { ChannelDisplay } from '../model/types'
import { cursorMarks, divToValue, drawTimeAxis, drawView, gridRows, labelEvery, labelStep, layoutTags, offsetText, scaleLabels, tagAt, triggerMark, viewAt, viewBoxes, viewsHeight, type TraceInput } from './draw'
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

  it('give a view left out no height, and its share to the others', () => {
    const b = viewBoxes([0.25, 0.25, 0.5], 3, 300, [true, false, true])
    expect(b).toEqual({ tops: [0, 100, 100], heights: [100, 0, 200] })
    expect(viewsHeight(b)).toBe(300)
    // The last view left out
    const last = viewBoxes(undefined, 2, 300, [true, false])
    expect(last.heights).toEqual([300, 0])
    expect(viewsHeight(last)).toBe(300)
  })

  it('are never lower than 40 px', () => {
    expect(viewBoxes([0.05, 0.95], 2, 400).heights).toEqual([40, 380])
  })

  it('find the view at a height', () => {
    const b = viewBoxes([0.25, 0.75], 2, 400)
    expect([viewAt(b, -5), viewAt(b, 99), viewAt(b, 100), viewAt(b, 450)]).toEqual([0, 0, 1, 1])
    // Never a view left out: below the last shown one is that one, above the first shown one that one
    const gap = viewBoxes(undefined, 4, 300, [false, true, false, true])
    expect([viewAt(gap, -5), viewAt(gap, 149), viewAt(gap, 150), viewAt(gap, 400)]).toEqual([1, 1, 3, 3])
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

  it('writes the number of the view in its corner only when asked to', () => {
    const d = display('CH1', 0)
    const draw = (viewLabel?: { number: number; active: boolean }) =>
      recordTexts((ctx) => drawView(ctx, { width: 864, height: H, dpr: 1, tStart: 0, tEnd: 1, timeTicks: [], traces: [trace(d, [1, 2])], viewLabel, theme: THEMES.dark })).filter((t) => t.text === '2')
    expect(draw()).toHaveLength(0)
    const [chip] = draw({ number: 2, active: false })
    // In the top left corner (the tags are drawn over it)
    expect(chip.x).toBeLessThan(30)
    expect(chip.y).toBeLessThan(20)
    expect(draw({ number: 2, active: true })).toHaveLength(1)
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

describe('scale labels', () => {
  it('are the round values of the channel within the view, at the height of their grid row', () => {
    // 20 px per division, 1 V/div: a label for every volt from -4 to 4 (±5 sit on the edge and are left out)
    const labels = scaleLabels(display('CH1', 0), 'V', H)
    expect(labels).toHaveLength(9)
    // from -4 V at the bottom to 4 V at the top
    expect(labels.map((l) => l.y)).toEqual([180, 160, 140, 120, 100, 80, 60, 40, 20])
    expect(labels[0].text).toBe('-4 V')
    expect(labels.find((l) => l.y === 100)?.text).toBe('0 V')
  })

  it('move with the position and the offset of the channel', () => {
    // 2 divisions up: the zero level is at y = 60
    expect(scaleLabels(display('CH1', 2), 'V', H).find((l) => l.text === '0 V')?.y).toBe(60)
    // offset 3 V at the centre: the value at the centre line is 3 V
    expect(scaleLabels(display('CH1', 0, 3), 'V', H).find((l) => l.y === 100)?.text).toBe('3 V')
  })

  it('keep their distance in a short view, by taking every 2nd, 5th … row', () => {
    const labels = scaleLabels(display('CH1', 0), 'V', 60)
    for (let i = 1; i < labels.length; i++) expect(labels[i].y - labels[i - 1].y).toBeGreaterThanOrEqual(15)
  })

  it('leave out values closer than 5 px to the edges', () => {
    for (const l of scaleLabels(display('CH1', 0.2), 'V', H)) {
      expect(l.y).toBeGreaterThanOrEqual(5)
      expect(l.y).toBeLessThanOrEqual(H - 5)
    }
  })
})

describe('trigger level', () => {
  const traceOf = (d: ChannelDisplay) => [{ display: d }]

  it('has its arrow at the level, with the source and the slope', () => {
    const m = triggerMark({ sourceId: 'CH4', level: 1.5, slope: 'RISE' }, traceOf(display('CH4', 0)), H)!
    // 1.5 V at 20 px per division: 30 px above the centre
    expect(m).toMatchObject({ level: 70, y: 70, off: 0, text: 'C4 ↗' })
    expect(triggerMark({ sourceId: 'CH4', level: 0, slope: 'FALL' }, traceOf(display('CH4', 0)), H)!.text).toBe('C4 ↘')
  })

  it('is taken from the trace the trigger source has (its position, scale and offset)', () => {
    const m = triggerMark({ sourceId: 'CH1', level: 2, slope: 'EITHER' }, traceOf(display('CH1', -1, 1, 0.5)), H)!
    // (2 - 1) / 0.5 + (-1) = 1 division above the centre
    expect(m.y).toBe(80)
    expect(m.text).toBe('C1 ↕')
  })

  it('stays at the edge, pointing towards a level outside the view', () => {
    const above = triggerMark({ sourceId: 'CH1', level: 100 }, traceOf(display('CH1', 0)), H)!
    expect(above).toMatchObject({ off: -1, y: 6 })
    expect(above.level).toBeLessThan(0)
    const below = triggerMark({ sourceId: 'CH1', level: -100 }, traceOf(display('CH1', 0)), H)!
    expect(below).toMatchObject({ off: 1, y: H - 6 })
    expect(below.level).toBeGreaterThan(H)
  })

  it('has no arrow without a level or without its source among the traces', () => {
    expect(triggerMark({ sourceId: 'CH1' }, traceOf(display('CH1', 0)), H)).toBeUndefined()
    expect(triggerMark({ sourceId: 'CH9', level: 1 }, traceOf(display('CH1', 0)), H)).toBeUndefined()
  })

  it('has no slope in its text when the setup has none', () => {
    expect(triggerMark({ sourceId: 'CH1', level: 0 }, traceOf(display('CH1', 0)), H)!.text).toBe('C1')
  })
})

describe('cursor marks', () => {
  const wave = { id: 'CH1', data: Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), t0: 0, dt: 1, yUnit: 'V', xUnit: 's' }
  const traceList = [{ display: display('CH1', 0), wave }]
  const win = { tStart: 0, tEnd: 10, plotW: 100 }

  it('put each line on a pixel centre, with a dot where the source trace is', () => {
    const marks = cursorMarks({ a: 2, b: 5, sourceId: 'CH1' }, traceList, win, H)
    expect(marks.map((m) => [m.name, m.x])).toEqual([['A', 20.5], ['B', 50.5]])
    // value 2 V at 20 px per division, 40 px above the centre
    expect(marks[0].dot).toEqual({ y: 100 - 40, color: '#fff' })
  })

  it('leave out the cursors outside the window', () => {
    expect(cursorMarks({ a: -3, b: 5, sourceId: 'CH1' }, traceList, win, H).map((m) => m.name)).toEqual(['B'])
    expect(cursorMarks({ a: 20, b: 30, sourceId: 'CH1' }, traceList, win, H)).toEqual([])
  })

  it('have no dot without a source, or where the source has no value', () => {
    expect(cursorMarks({ a: 2, b: 5, sourceId: 'CH9' }, traceList, win, H).every((m) => m.dot === undefined)).toBe(true)
    // before the record: no value
    const early = { ...wave, t0: 5 }
    expect(cursorMarks({ a: 2, b: 7, sourceId: 'CH1' }, [{ display: display('CH1', 0), wave: early }], win, H).map((m) => m.dot !== undefined)).toEqual([false, true])
  })
})
