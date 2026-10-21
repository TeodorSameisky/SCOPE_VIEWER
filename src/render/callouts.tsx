import type { CSSProperties, DOMAttributes, ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { calloutTitle, type Callout } from '../model/callouts'
import { si } from '../util/format'
import type { LiveChannel, TimeWindow } from '../components/state'
import { DIVS_Y, valueAt, valueToDiv } from './draw'
import type { Theme } from './theme'

const FONT_SIZE = 12
const FONT_FAMILY = "system-ui, 'Segoe UI', Roboto, sans-serif"
const FONT = `${FONT_SIZE}px ${FONT_FAMILY}`
const LINE_H = 16
const PAD = 6
export const FLAG_Y = 18
export const FLAG_H = 18

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
function textWidth(s: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return s.length * 7
  measureCtx.font = FONT
  return measureCtx.measureText(s).width
}

interface NoteGeo {
  ax: number
  ay: number
  bx: number
  by: number
  bw: number
  bh: number
  lines: string[]
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
  const lines = (c.text || calloutTitle(c)).split('\n')
  const bw = Math.ceil(Math.max(...lines.map(textWidth))) + PAD * 2
  const bh = lines.length * LINE_H + PAD
  return { ax, ay, bx: ax + (c.dx ?? 24), by: ay + (c.dy ?? -46), bw, bh, lines }
}

export function markerGeometry(c: Callout, p: CalloutLayout) {
  const x = ((c.t - p.win.start) / (p.win.end - p.win.start)) * p.plotW
  if (x < -1 || x > p.plotW + 1) return null
  const label = calloutTitle(c)
  const w = textWidth(label) + 14
  return { x, fx: x + w > p.plotW ? x - w : x, w, label }
}

export function regionGeometry(c: Callout, p: CalloutLayout) {
  const tToX = (t: number) => ((t - p.win.start) / (p.win.end - p.win.start)) * p.plotW
  const t2 = c.t2 ?? c.t
  const xa = tToX(Math.min(c.t, t2))
  const xb = tToX(Math.max(c.t, t2))
  if (xb < -1 || xa > p.plotW + 1) return null
  const label = `${calloutTitle(c)}  Δt ${si(Math.abs(t2 - c.t), 's')}`
  const w = textWidth(label) + 14
  // Region labels sit at the bottom of the plot (markers use the top)
  const totalH = p.viewH * Math.max(1, p.views.length)
  return { xa, xb, lx: Math.min(Math.max(xa, 0) + 4, p.plotW - w - 2), ly: totalH - FLAG_H - 6, w, label }
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
          <text x={g.bx + PAD} y={g.by + PAD / 2 + LINE_H - 4} fill={c.text ? theme.noteText : theme.notePlaceholder} fontSize={FONT_SIZE} fontFamily={FONT_FAMILY} style={{ pointerEvents: 'none' }}>
            {g.lines.map((l, i) => (
              <tspan key={i} x={g.bx + PAD} dy={i === 0 ? 0 : LINE_H}>
                {l || ' '}
              </tspan>
            ))}
          </text>
          <circle cx={g.ax} cy={g.ay} r={selected ? 5 : 4} fill={ink} stroke="#000" strokeWidth={1} {...handlers('anchor')} />
        </g>
      )
    }

    if (c.type === 'marker') {
      const g = markerGeometry(c, p)
      if (!g) return null
      const { x, fx, w, label } = g
      return (
        <g key={c.id}>
          <line x1={x} y1={0} x2={x} y2={totalH} stroke={ink} strokeWidth={selected ? 2 : 1.2} strokeDasharray="6 4" />
          {interact && <line x1={x} y1={0} x2={x} y2={totalH} stroke="transparent" strokeWidth={10} {...handlers('marker')} />}
          <rect x={fx} y={FLAG_Y} width={w} height={FLAG_H} rx={3} fill={ink} {...handlers('marker')} />
          {selected && <rect x={fx - 3} y={FLAG_Y - 3} width={w + 6} height={FLAG_H + 6} rx={5} fill="none" stroke={theme.selection} strokeDasharray="3 3" />}
          <text x={fx + 7} y={FLAG_Y + 13} fill={theme.onInk(ink)} fontSize={FONT_SIZE} fontWeight={600} fontFamily={FONT_FAMILY} style={{ pointerEvents: 'none' }}>
            {label}
          </text>
        </g>
      )
    }

    // region
    const g = regionGeometry(c, p)
    if (!g) return null
    const { xa, xb, lx, ly, w, label } = g
    const [startPart, endPart]: CalloutPart[] = c.t <= (c.t2 ?? c.t) ? ['start', 'end'] : ['end', 'start']
    return (
      <g key={c.id}>
        <rect x={xa} y={0} width={Math.max(1, xb - xa)} height={totalH} fill={ink} fillOpacity={selected ? 0.18 : 0.11} />
        <line x1={xa} y1={0} x2={xa} y2={totalH} stroke={ink} strokeWidth={1.2} />
        <line x1={xb} y1={0} x2={xb} y2={totalH} stroke={ink} strokeWidth={1.2} />
        {interact && <line x1={xa} y1={0} x2={xa} y2={totalH} stroke="transparent" strokeWidth={10} {...handlers(startPart)} />}
        {interact && <line x1={xb} y1={0} x2={xb} y2={totalH} stroke="transparent" strokeWidth={10} {...handlers(endPart)} />}
        <rect x={lx} y={ly} width={w} height={FLAG_H} rx={3} fill={theme.labelBox} stroke={ink} {...handlers('region')} />
        {selected && <rect x={lx - 3} y={ly - 3} width={w + 6} height={FLAG_H + 6} rx={5} fill="none" stroke={theme.selection} strokeDasharray="3 3" />}
        <text x={lx + 7} y={ly + 13} fill={ink} fontSize={FONT_SIZE} fontFamily={FONT_FAMILY} style={{ pointerEvents: 'none' }}>
          {label}
        </text>
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
