import type { CSSProperties, DOMAttributes, ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { calloutTitle, type BoxShape, type Callout } from '../model/callouts'
import { calloutValueText, type SpanMeasure } from '../model/calloutValues'
import type { Waveform } from '../model/types'
import { si } from '../util/format'
import type { LiveChannel, TimeWindow } from '../model/view'
import { DIVS_Y, textWidth, valueAt, valueToDiv, viewsHeight, type ViewBoxes } from './draw'
import { MATH_SCALE, splitTex, texSource, texSvg, type TexSvg } from './tex'
import { SANS, font } from './fonts'
import type { Theme } from './theme'

const FONT_SIZE = 12
const FONT = font(FONT_SIZE, SANS)
/** px per em of formulas */
const MATH_EM = FONT_SIZE * MATH_SCALE
/** Ascent and descent of a text line of notes (16 px) and of the labels of markers, regions, boxes and spans (18 px) */
const NOTE_LINE = [12, 4] as const
const FLAG_LINE = [13, 5] as const
const PAD = 6
export const FLAG_Y = 18
/** Arrowhead of a note's leader line: length and half width */
const ARROW_L = 9
const ARROW_W = 3.5

/** What places the callouts on the plot */
export interface CalloutLayout {
  channels: LiveChannel[]
  views: string[][]
  win: TimeWindow
  plotW: number
  /** Where the views are (their sizes can differ) */
  boxes: ViewBoxes
  /** Measures regions and boxes; without it they are measured at once (exports) */
  measure?: SpanMeasure
}

/**
 * Draggable parts: the text box and anchor of a note, a marker, the edges and label of a region,
 * a box's frame (`rect`, its label) and its edges and corners (compass directions), the ends of
 * a span (`start`, `end`) and its dimension line (`dim`)
 */
export type CalloutPart = 'box' | 'anchor' | 'marker' | 'start' | 'end' | 'region' | 'rect' | ResizeEdge | 'dim'
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
/** Pointer handlers of a draggable part of a callout */
export type PartProps = DOMAttributes<SVGElement> & { style?: CSSProperties }

/** One line of callout text: runs of text and rendered formulas, positioned from x = 0 */
interface TextLine {
  runs: { x: number; text?: string; tex?: TexSvg }[]
  width: number
  ascent: number
  descent: number
}

/** Lays out a line with its formulas: never lower than plain text (`base`), taller with tall formulas */
function layoutLine(s: string, font: string, base: readonly [number, number]): TextLine {
  const items: (string | TexSvg)[] = []
  for (const part of splitTex(s)) {
    // A formula that is still rendering or has an error shows its source
    const item = 'tex' in part ? (texSvg(part.tex, part.display) ?? texSource(part)) : part.text
    if (typeof item === 'string' && typeof items.at(-1) === 'string') items[items.length - 1] += item
    else items.push(item)
  }
  let [ascent, descent] = base
  let x = 0
  const runs = items.map((item) => {
    const run = typeof item === 'string' ? { x, text: item } : { x, tex: item }
    if (typeof item === 'string') x += textWidth(item, font)
    else {
      x += item.width * MATH_EM
      ascent = Math.max(ascent, Math.ceil(item.ascent * MATH_EM) + 1)
      descent = Math.max(descent, Math.ceil(item.descent * MATH_EM) + 1)
    }
    return run
  })
  return { runs, width: x, ascent, descent }
}

/** SVG elements of a laid-out line with its baseline at (x, y) */
function lineElements(line: TextLine, x: number, y: number, fill: string): ReactNode[] {
  return line.runs.map((r, i) =>
    r.tex ? (
      <svg
        key={i}
        x={x + r.x}
        y={y - r.tex.ascent * MATH_EM}
        width={r.tex.width * MATH_EM}
        height={(r.tex.ascent + r.tex.descent) * MATH_EM}
        viewBox={r.tex.viewBox}
        overflow="visible"
        color={fill}
        style={{ pointerEvents: 'none' }}
        dangerouslySetInnerHTML={{ __html: r.tex.body }}
      />
    ) : (
      <text key={i} x={x + r.x} y={y} fill={fill} fontSize={FONT_SIZE} fontFamily={SANS} xmlSpace="preserve" style={{ pointerEvents: 'none' }}>
        {r.text}
      </text>
    ),
  )
}

interface NoteGeo {
  type: 'note'
  /** Anchor on the trace (or the free point) */
  ax: number
  ay: number
  /** Text box */
  bx: number
  by: number
  bw: number
  bh: number
  lines: TextLine[]
  /** Value of the trace at the anchor (showValue), below the text */
  value?: TextLine
}

interface MarkerGeo {
  type: 'marker'
  x: number
  /** Flag with the label */
  fx: number
  fy: number
  w: number
  h: number
  label: TextLine
}

interface RegionGeo {
  type: 'region'
  xa: number
  xb: number
  /** Label box */
  lx: number
  ly: number
  w: number
  h: number
  label: TextLine
  /** Measurements over the span (measure), below the label */
  value?: TextLine
}

interface BoxGeo {
  type: 'box'
  /** The frame (px): left, top, width, height */
  x: number
  y: number
  w: number
  h: number
  shape: BoxShape
  /** Label box: above the frame, else below it, else inside it */
  lx: number
  ly: number
  lw: number
  lh: number
  label: TextLine
  /** Measurements over the time span (measure), below the label */
  value?: TextLine
}

interface SpanGeo {
  type: 'span'
  /** The ends, on their traces */
  xa: number
  ya: number
  xb: number
  yb: number
  /** Height of the dimension line */
  y: number
  /** Label box, centred above the dimension line */
  lx: number
  ly: number
  lw: number
  lh: number
  label: TextLine
  /** Δv and 1/Δt (showValue), below the label */
  value?: TextLine
}

export type CalloutGeo = NoteGeo | MarkerGeo | RegionGeo | BoxGeo | SpanGeo

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const FLAG_GAP = 3
/** Default distance of a span's dimension line below its lower end (px) */
export const SPAN_DY = 24

/** A visible channel with the top and height of its view (px from the top of the plot), or undefined */
function channelPlace(p: CalloutLayout, id: string | undefined): { ch: LiveChannel; top: number; h: number } | undefined {
  const ch = id === undefined ? undefined : p.channels.find((x) => x.wave.id === id)
  if (!ch || !ch.display.visible) return undefined
  const vi = p.views.findIndex((v) => v.includes(ch.wave.id))
  return vi < 0 ? undefined : { ch, top: p.boxes.tops[vi], h: p.boxes.heights[vi] }
}

/** Top and height of view `view` (px), clamped to the views there are */
function viewPlace(p: CalloutLayout, view: number): { top: number; h: number } {
  const v = clamp(view, 0, p.views.length - 1)
  return { top: p.boxes.tops[v], h: p.boxes.heights[v] }
}

/** Label and value line of a region, box or span, and the size of their box */
function labelBlock(title: string, valueText: string | undefined) {
  const label = layoutLine(title, FONT, FLAG_LINE)
  const value = valueText !== undefined ? layoutLine(valueText, FONT, FLAG_LINE) : undefined
  return { label, value, w: Math.max(label.width, value?.width ?? 0) + 14, h: label.ascent + label.descent + (value ? value.ascent + value.descent : 0) }
}

/** Note: the text box stays inside the plot, whatever its stored offset from the anchor */
function noteGeometry(c: Callout, p: CalloutLayout, waves: Waveform[]): NoteGeo | null {
  const span = p.win.end - p.win.start
  const ax = ((c.t - p.win.start) / span) * p.plotW
  if (ax < -1 || ax > p.plotW + 1) return null
  const totalH = viewsHeight(p.boxes)
  let ay: number | undefined
  const at = channelPlace(p, c.channel)
  if (at) {
    const v = valueAt(at.ch.wave, c.t)
    if (Number.isFinite(v)) ay = at.top + at.h / 2 - (valueToDiv(v, at.ch.display) * at.h) / DIVS_Y
  }
  if (ay === undefined) {
    if (c.view === undefined || c.div === undefined) return null
    const { top, h } = viewPlace(p, c.view)
    // Its view is left out (all its channels hidden)
    if (!h) return null
    ay = top + h / 2 - (c.div * h) / DIVS_Y
  }
  const lines = (c.text || calloutTitle(c)).split('\n').map((l) => layoutLine(l, FONT, NOTE_LINE))
  const valueText = calloutValueText(c, waves)
  const value = valueText !== undefined ? layoutLine(valueText, FONT, NOTE_LINE) : undefined
  const all = value ? [...lines, value] : lines
  const bw = Math.ceil(Math.max(...all.map((l) => l.width))) + PAD * 2
  const bh = all.reduce((h, l) => h + l.ascent + l.descent, 0) + PAD
  const bx = clamp(ax + (c.dx ?? 24), 2, p.plotW - bw - 2)
  const by = clamp(ay + (c.dy ?? -46), 2, totalH - bh - 2)
  return { type: 'note', ax, ay, bx, by, bw, bh, lines, value }
}

/** Marker: dashed line with its label at the top, on the left of the line near the right edge */
function markerGeometry(c: Callout, p: CalloutLayout): MarkerGeo | null {
  const x = ((c.t - p.win.start) / (p.win.end - p.win.start)) * p.plotW
  if (x < -1 || x > p.plotW + 1) return null
  const label = layoutLine(calloutTitle(c), FONT, FLAG_LINE)
  const w = label.width + 14
  return { type: 'marker', x, fx: x + w > p.plotW ? x - w : x, fy: FLAG_Y, w, h: label.ascent + label.descent, label }
}

/** Region: shaded time span with its label at the bottom of the plot */
function regionGeometry(c: Callout, p: CalloutLayout, waves: Waveform[]): RegionGeo | null {
  const tToX = (t: number) => ((t - p.win.start) / (p.win.end - p.win.start)) * p.plotW
  const t2 = c.t2 ?? c.t
  const xa = tToX(Math.min(c.t, t2))
  const xb = tToX(Math.max(c.t, t2))
  if (xb < -1 || xa > p.plotW + 1) return null
  const { label, value, w, h } = labelBlock(`${calloutTitle(c)}  Δt ${si(Math.abs(t2 - c.t), 's')}`, calloutValueText(c, waves, p.measure))
  const totalH = viewsHeight(p.boxes)
  return { type: 'region', xa, xb, lx: Math.min(Math.max(xa, 0) + 4, p.plotW - w - 2), ly: totalH - h - 6, w, h, label, value }
}

/**
 * Box: a frame around a time span and two values of its channel (or two levels of its view),
 * kept inside that view; hidden with its channel, like notes on a trace
 */
function boxGeometry(c: Callout, p: CalloutLayout, waves: Waveform[]): BoxGeo | null {
  const tToX = (t: number) => ((t - p.win.start) / (p.win.end - p.win.start)) * p.plotW
  const t2 = c.t2 ?? c.t
  const xa = tToX(Math.min(c.t, t2))
  const xb = tToX(Math.max(c.t, t2))
  if (xb < -1 || xa > p.plotW + 1) return null
  // Upper and lower level in divisions from the centre of the view, and the top and height of the view
  let levels: [number, number]
  let top: number
  let vh: number
  if (c.channel !== undefined && c.v !== undefined && c.v2 !== undefined) {
    const at = channelPlace(p, c.channel)
    if (!at) return null
    top = at.top
    vh = at.h
    levels = [valueToDiv(c.v, at.ch.display), valueToDiv(c.v2, at.ch.display)]
  } else if (c.view !== undefined && c.div !== undefined && c.div2 !== undefined) {
    ;({ top, h: vh } = viewPlace(p, c.view))
    levels = [c.div, c.div2]
  } else return null
  // A view left out (all its channels hidden) has no height
  if (!vh) return null
  const divH = vh / DIVS_Y
  const yTop = top + vh / 2 - Math.max(...levels) * divH
  const yBottom = top + vh / 2 - Math.min(...levels) * divH
  if (yBottom < top || yTop > top + vh) return null
  const y = clamp(yTop, top, top + vh - 2)
  const h = Math.max(2, clamp(yBottom, top, top + vh) - y)
  const { label, value, w: lw, h: lh } = labelBlock(calloutTitle(c), calloutValueText(c, waves, p.measure))
  const totalH = viewsHeight(p.boxes)
  const ly = y - lh - 3 >= 2 ? y - lh - 3 : y + h + 3 + lh <= totalH - 2 ? y + h + 3 : y + 3
  return { type: 'box', x: xa, y, w: Math.max(2, xb - xa), h, shape: c.shape ?? 'rect', lx: clamp(xa, 2, p.plotW - lw - 2), ly, lw, lh, label, value }
}

/** Span: a dimension line from a point on one trace to a point on another, with Δt above it */
function spanGeometry(c: Callout, p: CalloutLayout, waves: Waveform[]): SpanGeo | null {
  const tToX = (t: number) => ((t - p.win.start) / (p.win.end - p.win.start)) * p.plotW
  const t2 = c.t2 ?? c.t
  const xa = tToX(c.t)
  const xb = tToX(t2)
  if (Math.max(xa, xb) < -1 || Math.min(xa, xb) > p.plotW + 1) return null
  const endY = (id: string | undefined, t: number) => {
    const at = channelPlace(p, id)
    const v = at ? valueAt(at.ch.wave, t) : NaN
    return at && Number.isFinite(v) ? at.top + at.h / 2 - (valueToDiv(v, at.ch.display) * at.h) / DIVS_Y : undefined
  }
  const ya = endY(c.channel, c.t)
  const yb = endY(c.channel2, t2)
  if (ya === undefined || yb === undefined) return null
  const { label, value, w: lw, h: lh } = labelBlock(`${calloutTitle(c)}  Δt ${si(t2 - c.t, 's')}`, calloutValueText(c, waves))
  const totalH = viewsHeight(p.boxes)
  const y = clamp(Math.max(ya, yb) + (c.dy ?? SPAN_DY), lh + 6, totalH - 4)
  return { type: 'span', xa, ya, xb, yb, y, lx: clamp((xa + xb) / 2 - lw / 2, 2, p.plotW - lw - 2), ly: y - lh - 3, lw, lh, label, value }
}

/**
 * Rows for labels [x, x + w) so that no two in a row overlap: each goes into the first row
 * where it fits, in the order of x (as few rows as possible).
 */
export function stackRows(items: { x: number; w: number }[], gap = 4): number[] {
  const order = items.map((_, i) => i).sort((a, b) => items[a].x - items[b].x)
  const ends: number[] = []
  const rows = new Array<number>(items.length)
  for (const i of order) {
    let row = ends.findIndex((end) => items[i].x >= end + gap)
    if (row < 0) row = ends.push(0) - 1
    ends[row] = items[i].x + items[i].w
    rows[i] = row
  }
  return rows
}

/**
 * Screen geometry of the visible callouts. Note boxes are kept inside the plot; flags of markers
 * that would overlap are stacked downwards from the top, labels of regions upwards from the bottom.
 */
export function layoutCallouts(callouts: Callout[], p: CalloutLayout): Map<string, CalloutGeo> {
  const geo = new Map<string, CalloutGeo>()
  const markers: MarkerGeo[] = []
  const regions: RegionGeo[] = []
  const waves = p.channels.map((ch) => ch.wave)
  const geometry = {
    note: noteGeometry,
    marker: (c: Callout) => markerGeometry(c, p),
    region: regionGeometry,
    box: boxGeometry,
    span: spanGeometry,
  }
  for (const c of callouts) {
    const g = geometry[c.type](c, p, waves)
    if (!g) continue
    geo.set(c.id, g)
    if (g.type === 'marker') markers.push(g)
    else if (g.type === 'region') regions.push(g)
  }
  stackRows(markers.map((g) => ({ x: g.fx, w: g.w }))).forEach((row, i) => (markers[i].fy = FLAG_Y + row * (markers[i].h + FLAG_GAP)))
  stackRows(regions.map((g) => ({ x: g.lx, w: g.w }))).forEach((row, i) => (regions[i].ly -= row * (regions[i].h + FLAG_GAP)))
  return geo
}

/** Lower edge of the lowest marker flag (px from the top of the plot), 0 without markers */
export function flagsBottom(geo: Map<string, CalloutGeo>): number {
  let bottom = 0
  for (const g of geo.values()) if (g.type === 'marker') bottom = Math.max(bottom, g.fy + g.h)
  return bottom
}

/**
 * The label box of a marker, region, box or span: its title in the callout's colour, the value
 * line below. Notes have a box of the same look (frame, corners, selection), with their text.
 */
function labelShape(g: { lx: number; ly: number; lw: number; lh: number; label: TextLine; value?: TextLine }, ink: string, theme: Theme, selected: boolean, props: PartProps): ReactNode {
  const { lx, ly, lw, lh, label, value } = g
  return (
    <>
      <rect x={lx} y={ly} width={lw} height={lh} rx={3} fill={theme.labelBox} stroke={ink} strokeWidth={1.2} {...props} />
      {selected && <rect x={lx - 3} y={ly - 3} width={lw + 6} height={lh + 6} rx={5} fill="none" stroke={theme.selection} strokeDasharray="3 3" />}
      {lineElements(label, lx + 7, ly + label.ascent, ink)}
      {value && lineElements(value, lx + 7, ly + lh - value.descent, theme.noteText)}
    </>
  )
}

/**
 * SVG elements of the callouts: regions first, then boxes, spans, markers and notes on top. With
 * `interact` the draggable parts get its pointer handlers; without, the shapes are static (image export).
 */
export function calloutShapes(
  callouts: Callout[],
  p: CalloutLayout,
  theme: Theme,
  selectedId?: string,
  interact?: (c: Callout, part: CalloutPart) => PartProps,
  geo = layoutCallouts(callouts, p),
): ReactNode[] {
  const totalH = viewsHeight(p.boxes)
  const order = { region: 0, box: 1, span: 2, marker: 3, note: 4 }
  const sorted = [...callouts].sort((a, b) => order[a.type] - order[b.type])

  return sorted.map((c) => {
    const selected = c.id === selectedId
    const handlers = (part: CalloutPart) => interact?.(c, part) ?? {}
    const ink = theme.ink(c.color)

    const g = geo.get(c.id)
    if (!g) return null

    if (g.type === 'note') {
      // Leader line from the box to the anchor, ending in an arrowhead (a dot when the box is on top of it)
      const lx = Math.min(Math.max(g.ax, g.bx), g.bx + g.bw)
      const ly = Math.min(Math.max(g.ay, g.by), g.by + g.bh)
      const len = Math.hypot(g.ax - lx, g.ay - ly)
      const arrow = len > ARROW_L + 4
      const ux = (g.ax - lx) / len
      const uy = (g.ay - ly) / len
      const baseX = g.ax - ux * ARROW_L
      const baseY = g.ay - uy * ARROW_L
      return (
        <g key={c.id}>
          <line x1={lx} y1={ly} x2={arrow ? baseX : g.ax} y2={arrow ? baseY : g.ay} stroke={ink} strokeWidth={1.2} />
          {arrow ? (
            <polygon points={`${g.ax},${g.ay} ${baseX - uy * ARROW_W},${baseY + ux * ARROW_W} ${baseX + uy * ARROW_W},${baseY - ux * ARROW_W}`} fill={ink} />
          ) : (
            <circle cx={g.ax} cy={g.ay} r={selected ? 5 : 4} fill={ink} stroke={theme.bg} strokeWidth={1} />
          )}
          <rect x={g.bx} y={g.by} width={g.bw} height={g.bh} rx={3} fill={theme.noteBox} stroke={ink} strokeWidth={1.2} {...handlers('box')} />
          {selected && <rect x={g.bx - 3} y={g.by - 3} width={g.bw + 6} height={g.bh + 6} rx={5} fill="none" stroke={theme.selection} strokeDasharray="3 3" />}
          {g.lines.map((l, i) => {
            const top = g.lines.slice(0, i).reduce((y, prev) => y + prev.ascent + prev.descent, g.by + PAD / 2)
            return <g key={i}>{lineElements(l, g.bx + PAD, top + l.ascent, c.text ? theme.noteText : theme.notePlaceholder)}</g>
          })}
          {g.value && lineElements(g.value, g.bx + PAD, g.by + g.bh - PAD / 2 - g.value.descent, ink)}
          {/* The anchor is dragged at a larger invisible handle */}
          {interact && <circle cx={g.ax} cy={g.ay} r={7} fill="transparent" {...handlers('anchor')} />}
        </g>
      )
    }

    if (g.type === 'marker') {
      const { x, fx, fy, w, h, label } = g
      // Dashed like the extension lines of spans, and unlike cursor B (long dashes); the label as on the other callouts
      return (
        <g key={c.id}>
          <line x1={x} y1={0} x2={x} y2={totalH} stroke={ink} strokeWidth={selected ? 2 : 1.2} strokeDasharray="3 3" />
          {interact && <line x1={x} y1={0} x2={x} y2={totalH} stroke="transparent" strokeWidth={10} {...handlers('marker')} />}
          {labelShape({ lx: fx, ly: fy, lw: w, lh: h, label }, ink, theme, selected, handlers('marker'))}
        </g>
      )
    }

    if (g.type === 'box') {
      const { x, y, w, h } = g
      const frame = { fill: ink, fillOpacity: selected ? 0.14 : 0.07, stroke: ink, strokeWidth: selected ? 2 : 1.4 }
      // The edges and corners resize it, the label moves it; the inside stays free for the tools
      const edges: [ResizeEdge, number, number, number, number][] = [
        ['n', x, y, x + w, y],
        ['s', x, y + h, x + w, y + h],
        ['w', x, y, x, y + h],
        ['e', x + w, y, x + w, y + h],
      ]
      const corners: [ResizeEdge, number, number][] = [
        ['nw', x, y],
        ['ne', x + w, y],
        ['sw', x, y + h],
        ['se', x + w, y + h],
      ]
      return (
        <g key={c.id}>
          {g.shape === 'ellipse' ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...frame} /> : <rect x={x} y={y} width={w} height={h} rx={2} {...frame} />}
          {selected && g.shape === 'ellipse' && <rect x={x} y={y} width={w} height={h} fill="none" stroke={theme.selection} strokeWidth={0.8} strokeDasharray="3 3" />}
          {selected && corners.map(([e, cx, cy]) => <rect key={e} x={cx - 3} y={cy - 3} width={6} height={6} fill={theme.selection} stroke={ink} />)}
          {interact && edges.map(([e, x1, y1, x2, y2]) => <line key={e} x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={8} {...handlers(e)} />)}
          {interact && corners.map(([e, cx, cy]) => <rect key={e} x={cx - 6} y={cy - 6} width={12} height={12} fill="transparent" {...handlers(e)} />)}
          {labelShape(g, ink, theme, selected, handlers('rect'))}
        </g>
      )
    }

    if (g.type === 'span') {
      const { xa, ya, xb, yb, y } = g
      const left = Math.min(xa, xb)
      const right = Math.max(xa, xb)
      // Arrowheads inside the extension lines; outside them when the span is too short
      const inside = right - left >= 2 * ARROW_L + 6
      const head = (tip: number, dir: 1 | -1) => <polygon points={`${tip},${y} ${tip - dir * ARROW_L},${y - ARROW_W} ${tip - dir * ARROW_L},${y + ARROW_W}`} fill={ink} />
      const extension = (x: number, from: number) => <line x1={x} y1={from} x2={x} y2={y + (y >= from ? 4 : -4)} stroke={ink} strokeWidth={1} strokeDasharray="3 3" />
      return (
        <g key={c.id}>
          {extension(xa, ya)}
          {extension(xb, yb)}
          <line x1={inside ? left : left - 16} y1={y} x2={inside ? right : right + 16} y2={y} stroke={ink} strokeWidth={selected ? 2 : 1.4} />
          {inside ? head(left, -1) : head(left, 1)}
          {inside ? head(right, 1) : head(right, -1)}
          <circle cx={xa} cy={ya} r={3} fill={ink} />
          <circle cx={xb} cy={yb} r={3} fill={ink} />
          {interact && <line x1={left - 16} y1={y} x2={right + 16} y2={y} stroke="transparent" strokeWidth={10} {...handlers('dim')} />}
          {interact && <circle cx={xa} cy={ya} r={7} fill="transparent" {...handlers('start')} />}
          {interact && <circle cx={xb} cy={yb} r={7} fill="transparent" {...handlers('end')} />}
          {labelShape(g, ink, theme, selected, handlers('dim'))}
        </g>
      )
    }

    // region
    const { xa, xb, lx, ly, w, h, label, value } = g
    const [startPart, endPart]: CalloutPart[] = c.t <= (c.t2 ?? c.t) ? ['start', 'end'] : ['end', 'start']
    return (
      <g key={c.id}>
        <rect x={xa} y={0} width={Math.max(1, xb - xa)} height={totalH} fill={ink} fillOpacity={selected ? 0.18 : 0.11} />
        <line x1={xa} y1={0} x2={xa} y2={totalH} stroke={ink} strokeWidth={1.2} />
        <line x1={xb} y1={0} x2={xb} y2={totalH} stroke={ink} strokeWidth={1.2} />
        {interact && <line x1={xa} y1={0} x2={xa} y2={totalH} stroke="transparent" strokeWidth={10} {...handlers(startPart)} />}
        {interact && <line x1={xb} y1={0} x2={xb} y2={totalH} stroke="transparent" strokeWidth={10} {...handlers(endPart)} />}
        {labelShape({ lx, ly, lw: w, lh: h, label, value }, ink, theme, selected, handlers('region'))}
      </g>
    )
  })
}

/** The callouts as a standalone SVG document in the given theme, for image export */
export function calloutsSvg(callouts: Callout[], p: CalloutLayout, theme: Theme, geo = layoutCallouts(callouts, p)): string {
  const totalH = viewsHeight(p.boxes)
  const host = document.createElement('div')
  const root = createRoot(host)
  flushSync(() =>
    root.render(
      <svg xmlns="http://www.w3.org/2000/svg" width={p.plotW} height={totalH} viewBox={`0 0 ${p.plotW} ${totalH}`}>
        {calloutShapes(callouts, p, theme, undefined, undefined, geo)}
      </svg>,
    ),
  )
  const xml = new XMLSerializer().serializeToString(host.firstElementChild!)
  root.unmount()
  return xml
}
