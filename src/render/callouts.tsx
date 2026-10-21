import type { CSSProperties, DOMAttributes, ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { calloutTitle, type Callout } from '../model/callouts'
import { si } from '../util/format'
import type { LiveChannel, TimeWindow } from '../components/state'
import { DIVS_Y, valueAt, valueToDiv } from './draw'
import { MATH_SCALE, splitTex, texSource, texSvg, type TexSvg } from './tex'
import type { Theme } from './theme'

const FONT_SIZE = 12
const FONT_FAMILY = "system-ui, 'Segoe UI', Roboto, sans-serif"
const FONT = `${FONT_SIZE}px ${FONT_FAMILY}`
const FLAG_FONT = `600 ${FONT}`
/** px per em of formulas */
const MATH_EM = FONT_SIZE * MATH_SCALE
/** Ascent and descent of a text line of notes (16 px) and of the flags of markers and regions (18 px) */
const NOTE_LINE = [12, 4] as const
const FLAG_LINE = [13, 5] as const
const PAD = 6
export const FLAG_Y = 18

/** What places the callouts on the plot */
export interface CalloutLayout {
  channels: LiveChannel[]
  views: string[][]
  win: TimeWindow
  plotW: number
  viewH: number
}

export type CalloutPart = 'box' | 'anchor' | 'marker' | 'start' | 'end' | 'region'
/** Pointer handlers of a draggable part of a callout */
export type PartProps = DOMAttributes<SVGElement> & { style?: CSSProperties }

let measureCtx: CanvasRenderingContext2D | null = null
function textWidth(s: string, font: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return s.length * 7
  measureCtx.font = font
  return measureCtx.measureText(s).width
}

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
function lineElements(line: TextLine, x: number, y: number, fill: string, fontWeight?: number): ReactNode[] {
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
      <text key={i} x={x + r.x} y={y} fill={fill} fontSize={FONT_SIZE} fontWeight={fontWeight} fontFamily={FONT_FAMILY} xmlSpace="preserve" style={{ pointerEvents: 'none' }}>
        {r.text}
      </text>
    ),
  )
}

interface NoteGeo {
  ax: number
  ay: number
  bx: number
  by: number
  bw: number
  bh: number
  lines: TextLine[]
}

/** Screen geometry of a note, or null when its anchor is not visible. */
export function noteGeometry(c: Callout, p: CalloutLayout): NoteGeo | null {
  const span = p.win.end - p.win.start
  const ax = ((c.t - p.win.start) / span) * p.plotW
  if (ax < -1 || ax > p.plotW + 1) return null
  const divH = p.viewH / DIVS_Y
  let ay: number | undefined
  const ch = c.channel ? p.channels.find((x) => x.wave.id === c.channel) : undefined
  const vi = ch ? p.views.findIndex((v) => v.includes(ch.wave.id)) : -1
  if (ch && ch.display.visible && vi >= 0) {
    const v = valueAt(ch.wave, c.t)
    if (Number.isFinite(v)) ay = vi * p.viewH + p.viewH / 2 - valueToDiv(v, ch.display) * divH
  }
  if (ay === undefined) {
    if (c.view === undefined || c.div === undefined) return null
    const v = Math.min(p.views.length - 1, Math.max(0, c.view))
    ay = v * p.viewH + p.viewH / 2 - c.div * divH
  }
  const lines = (c.text || calloutTitle(c)).split('\n').map((l) => layoutLine(l, FONT, NOTE_LINE))
  const bw = Math.ceil(Math.max(...lines.map((l) => l.width))) + PAD * 2
  const bh = lines.reduce((h, l) => h + l.ascent + l.descent, 0) + PAD
  return { ax, ay, bx: ax + (c.dx ?? 24), by: ay + (c.dy ?? -46), bw, bh, lines }
}

export function markerGeometry(c: Callout, p: CalloutLayout) {
  const x = ((c.t - p.win.start) / (p.win.end - p.win.start)) * p.plotW
  if (x < -1 || x > p.plotW + 1) return null
  const label = layoutLine(calloutTitle(c), FLAG_FONT, FLAG_LINE)
  const w = label.width + 14
  return { x, fx: x + w > p.plotW ? x - w : x, w, h: label.ascent + label.descent, label }
}

export function regionGeometry(c: Callout, p: CalloutLayout) {
  const tToX = (t: number) => ((t - p.win.start) / (p.win.end - p.win.start)) * p.plotW
  const t2 = c.t2 ?? c.t
  const xa = tToX(Math.min(c.t, t2))
  const xb = tToX(Math.max(c.t, t2))
  if (xb < -1 || xa > p.plotW + 1) return null
  const label = layoutLine(`${calloutTitle(c)}  Δt ${si(Math.abs(t2 - c.t), 's')}`, FONT, FLAG_LINE)
  const w = label.width + 14
  const h = label.ascent + label.descent
  // Region labels sit at the bottom of the plot (markers use the top)
  const totalH = p.viewH * Math.max(1, p.views.length)
  return { xa, xb, lx: Math.min(Math.max(xa, 0) + 4, p.plotW - w - 2), ly: totalH - h - 6, w, h, label }
}

/**
 * SVG elements of the callouts, regions first, then markers, then notes on top. With `interact`
 * the draggable parts get its pointer handlers; without, the shapes are static (image export).
 */
export function calloutShapes(callouts: Callout[], p: CalloutLayout, theme: Theme, selectedId?: string, interact?: (c: Callout, part: CalloutPart) => PartProps): ReactNode[] {
  const totalH = p.viewH * Math.max(1, p.views.length)
  const order = { region: 0, marker: 1, note: 2 }
  const sorted = [...callouts].sort((a, b) => order[a.type] - order[b.type])

  return sorted.map((c) => {
    const selected = c.id === selectedId
    const handlers = (part: CalloutPart) => interact?.(c, part) ?? {}
    const ink = theme.ink(c.color)

    if (c.type === 'note') {
      const g = noteGeometry(c, p)
      if (!g) return null
      const lx = Math.min(Math.max(g.ax, g.bx), g.bx + g.bw)
      const ly = Math.min(Math.max(g.ay, g.by), g.by + g.bh)
      return (
        <g key={c.id}>
          <line x1={g.ax} y1={g.ay} x2={lx} y2={ly} stroke={ink} strokeWidth={1.2} />
          <rect x={g.bx} y={g.by} width={g.bw} height={g.bh} rx={4} fill={theme.noteBox} stroke={ink} strokeWidth={1.2} {...handlers('box')} />
          {selected && <rect x={g.bx - 3} y={g.by - 3} width={g.bw + 6} height={g.bh + 6} rx={6} fill="none" stroke={theme.selection} strokeDasharray="3 3" />}
          {g.lines.map((l, i) => {
            const top = g.lines.slice(0, i).reduce((y, prev) => y + prev.ascent + prev.descent, g.by + PAD / 2)
            return <g key={i}>{lineElements(l, g.bx + PAD, top + l.ascent, c.text ? theme.noteText : theme.notePlaceholder)}</g>
          })}
          <circle cx={g.ax} cy={g.ay} r={selected ? 5 : 4} fill={ink} stroke="#000" strokeWidth={1} {...handlers('anchor')} />
        </g>
      )
    }

    if (c.type === 'marker') {
      const g = markerGeometry(c, p)
      if (!g) return null
      const { x, fx, w, h, label } = g
      return (
        <g key={c.id}>
          <line x1={x} y1={0} x2={x} y2={totalH} stroke={ink} strokeWidth={selected ? 2 : 1.2} strokeDasharray="6 4" />
          {interact && <line x1={x} y1={0} x2={x} y2={totalH} stroke="transparent" strokeWidth={10} {...handlers('marker')} />}
          <rect x={fx} y={FLAG_Y} width={w} height={h} rx={3} fill={ink} {...handlers('marker')} />
          {selected && <rect x={fx - 3} y={FLAG_Y - 3} width={w + 6} height={h + 6} rx={5} fill="none" stroke={theme.selection} strokeDasharray="3 3" />}
          {lineElements(label, fx + 7, FLAG_Y + label.ascent, theme.onInk(ink), 600)}
        </g>
      )
    }

    // region
    const g = regionGeometry(c, p)
    if (!g) return null
    const { xa, xb, lx, ly, w, h, label } = g
    const [startPart, endPart]: CalloutPart[] = c.t <= (c.t2 ?? c.t) ? ['start', 'end'] : ['end', 'start']
    return (
      <g key={c.id}>
        <rect x={xa} y={0} width={Math.max(1, xb - xa)} height={totalH} fill={ink} fillOpacity={selected ? 0.18 : 0.11} />
        <line x1={xa} y1={0} x2={xa} y2={totalH} stroke={ink} strokeWidth={1.2} />
        <line x1={xb} y1={0} x2={xb} y2={totalH} stroke={ink} strokeWidth={1.2} />
        {interact && <line x1={xa} y1={0} x2={xa} y2={totalH} stroke="transparent" strokeWidth={10} {...handlers(startPart)} />}
        {interact && <line x1={xb} y1={0} x2={xb} y2={totalH} stroke="transparent" strokeWidth={10} {...handlers(endPart)} />}
        <rect x={lx} y={ly} width={w} height={h} rx={3} fill={theme.labelBox} stroke={ink} {...handlers('region')} />
        {selected && <rect x={lx - 3} y={ly - 3} width={w + 6} height={h + 6} rx={5} fill="none" stroke={theme.selection} strokeDasharray="3 3" />}
        {lineElements(label, lx + 7, ly + label.ascent, ink)}
      </g>
    )
  })
}

/** The callouts as a standalone SVG document in the given theme, for image export */
export function calloutsSvg(callouts: Callout[], p: CalloutLayout, theme: Theme): string {
  const totalH = p.viewH * Math.max(1, p.views.length)
  const host = document.createElement('div')
  const root = createRoot(host)
  flushSync(() =>
    root.render(
      <svg xmlns="http://www.w3.org/2000/svg" width={p.plotW} height={totalH} viewBox={`0 0 ${p.plotW} ${totalH}`}>
        {calloutShapes(callouts, p, theme)}
      </svg>,
    ),
  )
  const xml = new XMLSerializer().serializeToString(host.firstElementChild!)
  root.unmount()
  return xml
}
