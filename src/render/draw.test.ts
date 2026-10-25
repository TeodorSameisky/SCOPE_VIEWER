import { describe, expect, it } from 'vitest'
import { MinMaxPyramid } from '../dsp/minmax'
import type { ChannelDisplay } from '../model/types'
import { drawView, layoutTags, positionForZeroAt, tagAt, valueToDiv } from './draw'
import { THEMES } from './theme'

const display = (id: string, position: number, offset = 0, scale = 1, label = ''): ChannelDisplay => ({ id, label, color: '#fff', visible: true, scale, position, offset })

// A view 200 px high: 20 px per division, the centre line at y = 100
const H = 200

describe('channel tags', () => {
  it('sit at the 0 level of their channel', () => {
    const [t] = layoutTags([display('CH1', 2)], H)
    expect(t.y).toBe(60)
    expect(t.off).toBe(0)
    // With an offset the 0 level moves: 0 V is 1.5 div below the offset level
    expect(layoutTags([display('CH1', 0, 3, 2)], H)[0].y).toBe(130)
  })

  it('stay at the edge with an arrow when the 0 level is outside the view', () => {
    const [above] = layoutTags([display('CH1', 7)], H)
    expect(above.off).toBe(-1)
    expect(above.y).toBe(8)
    const [below] = layoutTags([display('CH2', -9)], H)
    expect(below.off).toBe(1)
    expect(below.y).toBe(192)
  })

  it('are spread apart where they would overlap', () => {
    const tags = layoutTags([display('CH1', 0), display('CH2', 0.1), display('CH3', -0.1)], H)
    const ys = tags.map((t) => t.y)
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(16)
  })

  it('are hit on the tag and its label, the one drawn last first', () => {
    const tags = layoutTags([display('CH1', 0, 0, 1, 'pulse'), display('CH2', -2)], H)
    const ch1 = tags.find((t) => t.display.id === 'CH1')!
    expect(tagAt(tags, 5, ch1.y)?.display.id).toBe('CH1')
    expect(tagAt(tags, ch1.right - 1, ch1.y + 7)?.display.id).toBe('CH1')
    expect(tagAt(tags, ch1.right + 2, ch1.y)).toBeUndefined()
    expect(tagAt(tags, 5, ch1.y + 12)).toBeUndefined()
    expect(tagAt(tags, 5, 140)?.display.id).toBe('CH2')
  })

  it('give the position that puts the 0 level at a division', () => {
    const d = display('CH1', 0, 3, 2)
    const position = positionForZeroAt(1, d)
    expect(valueToDiv(0, { ...d, position })).toBeCloseTo(1)
    expect(positionForZeroAt(-2, display('CH2', 5))).toBe(-2)
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
