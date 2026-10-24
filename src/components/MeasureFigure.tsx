import { useId } from 'react'
import type { MeasurementKey } from '../dsp/measure'
import { useTheme } from './ui/themeContext'

// Geometry of the example pulse train (SVG units). Levels: top 30, base 90.
const TOP = 30
const BASE = 90
const MAX = 22
const MIN = 98
const lvl = (pct: number) => BASE - (BASE - TOP) * pct
const WAVE = 'M8 90 H40 L60 30 L63 22 L68 30 H110 L130 90 L133 98 L138 90 H170 L190 30 L193 22 L198 30 H252'
// Crossing positions on the edges (rise 40→60, fall 110→130, second rise 170→190)
const RISE = { p10: 42, p50: 50, p90: 58 }
const FALL = { p90: 112, p50: 120, p10: 128 }
const RISE2 = { p50: 180 }

const ACCENT = '#3fb6ff'
/** The example signal, in the colour of CH1 */
const SIGNAL = '#f2e32c'

/** Small schematic that shows what a measurement measures on an example pulse train. */
export function MeasureFigure({ highlight }: { highlight: MeasurementKey }) {
  // Darkened on a light background, like the traces; the guides in the theme's colour
  const { ink, guide: GUIDE } = useTheme().theme
  const HL = ink(ACCENT)
  const uid = useId().replace(/:/g, '')
  const arrow = `url(#arr-${uid})`

  const hLine = (y: number, label: string, x1 = 8, x2 = 252, labelX = 254) => (
    <g key={label}>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={HL} strokeDasharray="4 3" />
      <text x={labelX} y={y + 3.5} fill={HL} fontSize="10" textAnchor="start">
        {label}
      </text>
    </g>
  )
  const guide = (y: number, label: string) => (
    <g key={`g${label}`}>
      <line x1={8} y1={y} x2={252} y2={y} stroke={GUIDE} strokeDasharray="2 3" />
      <text x={254} y={y + 3.5} fill={GUIDE} fontSize="9">
        {label}
      </text>
    </g>
  )
  const vArrow = (x: number, y1: number, y2: number, label: string, anchor: 'start' | 'end' = 'start') => (
    <g key={`v${label}`}>
      <line x1={x} y1={y1 + 2} x2={x} y2={y2 - 2} stroke={HL} strokeWidth="1.4" markerStart={arrow} markerEnd={arrow} />
      <text x={anchor === 'start' ? x + 5 : x - 5} y={(y1 + y2) / 2 + 3.5} fill={HL} fontSize="10" textAnchor={anchor}>
        {label}
      </text>
    </g>
  )
  const hArrow = (x1: number, x2: number, y: number, label: string) => (
    <g key={`h${label}`}>
      <line x1={x1} y1={y - 8} x2={x1} y2={y + 3} stroke={HL} strokeWidth="0.8" />
      <line x1={x2} y1={y - 8} x2={x2} y2={y + 3} stroke={HL} strokeWidth="0.8" />
      <line x1={x1 + 1} y1={y} x2={x2 - 1} y2={y} stroke={HL} strokeWidth="1.4" markerStart={arrow} markerEnd={arrow} />
      <text x={(x1 + x2) / 2} y={y + 12} fill={HL} fontSize="10" textAnchor="middle">
        {label}
      </text>
    </g>
  )

  const parts: React.ReactNode[] = []
  switch (highlight) {
    case 'max':
      parts.push(hLine(MAX, 'Max'))
      break
    case 'min':
      parts.push(hLine(MIN, 'Min'))
      break
    case 'pkpk':
      parts.push(hLine(MAX, 'Max'), hLine(MIN, 'Min'), vArrow(232, MAX, MIN, 'Pk-Pk', 'end'))
      break
    case 'top':
      parts.push(hLine(TOP, 'Top'), guide(MAX, 'Max'))
      break
    case 'base':
      parts.push(hLine(BASE, 'Base'), guide(MIN, 'Min'))
      break
    case 'amplitude':
      parts.push(guide(TOP, 'Top'), guide(BASE, 'Base'), vArrow(150, TOP, BASE, 'Amplitude'))
      break
    case 'mean':
      parts.push(hLine(lvl(0.5), 'Mean'))
      break
    case 'rms':
      parts.push(guide(BASE, '0'), hLine(lvl(Math.SQRT1_2), 'RMS'))
      break
    case 'period':
    case 'frequency':
      parts.push(guide(lvl(0.5), '50%'), hArrow(RISE.p50, RISE2.p50, 106, highlight === 'period' ? 'Period' : 'Frequency = 1 / Period'))
      break
    case 'riseTime':
      parts.push(guide(lvl(0.1), '10%'), guide(lvl(0.9), '90%'), hArrow(RISE.p10, RISE.p90, 106, 'Rise'))
      break
    case 'fallTime':
      parts.push(guide(lvl(0.1), '10%'), guide(lvl(0.9), '90%'), hArrow(FALL.p90, FALL.p10, 106, 'Fall'))
      break
    case 'posWidth':
      parts.push(guide(lvl(0.5), '50%'), hArrow(RISE.p50, FALL.p50, 106, '+Width'))
      break
    case 'duty':
      parts.push(guide(lvl(0.5), '50%'), hArrow(RISE.p50, FALL.p50, 12, 'Width'), hArrow(RISE.p50, RISE2.p50, 106, 'Period'))
      break
  }

  return (
    <svg className="measure-figure" viewBox="0 0 282 122" role="img" aria-label={`Illustration of ${highlight}`}>
      <defs>
        <marker id={`arr-${uid}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 1 L10 5 L0 9 z" fill={HL} />
        </marker>
      </defs>
      <path d={WAVE} fill="none" stroke={ink(SIGNAL)} strokeWidth="2" strokeLinejoin="round" />
      {parts}
    </svg>
  )
}
