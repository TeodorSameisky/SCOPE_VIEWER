import { useMemo } from 'react'
import { toDb, windowCoefficients, windowGain, type WindowKind } from '../math/fft'

const HL = '#3fb6ff'
const GUIDE = 'rgba(160, 170, 185, 0.55)'
const GRID = 'rgba(160, 170, 185, 0.16)'

// Layout (SVG units): window shape on the left, response to a tone on the right
const TOP = 10
const BOT = 74
const SHAPE = { x0: 8, x1: 88 }
const RESP = { x0: 116, x1: 292 }
const BINS = 10
const DB_MIN = -120

const sx = (i: number, n: number) => SHAPE.x0 + (i / n) * (SHAPE.x1 - SHAPE.x0)
const sy = (w: number) => BOT - w * (BOT - TOP)
const rx = (d: number) => RESP.x0 + ((d + BINS) / (2 * BINS)) * (RESP.x1 - RESP.x0)
const ry = (db: number) => TOP + (Math.max(DB_MIN, db) / DB_MIN) * (BOT - TOP)

/** Shape of a window over the samples and its response to a tone (main lobe, side lobes) in dB. */
export function WindowFigure({ kind }: { kind: WindowKind }) {
  const { shape, resp } = useMemo(() => {
    const n = 64
    const w = windowCoefficients(kind, n)
    const shape = [...w, w[0]].map((v, i) => `${i ? 'L' : 'M'}${sx(i, n).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ')
    const pts: string[] = []
    for (let i = 0; i <= 400; i++) {
      const d = -BINS + (i / 400) * 2 * BINS
      pts.push(`${i ? 'L' : 'M'}${rx(d).toFixed(1)} ${ry(toDb(Math.max(1e-12, windowGain(kind, d)))).toFixed(1)}`)
    }
    return { shape, resp: pts.join(' ') }
  }, [kind])

  return (
    <svg className="measure-figure" viewBox="0 0 300 96" role="img" aria-label="Window shape and its response to a tone">
      <line x1={SHAPE.x0} y1={BOT} x2={SHAPE.x1} y2={BOT} stroke={GUIDE} />
      <line x1={SHAPE.x0} y1={TOP} x2={SHAPE.x1} y2={TOP} stroke={GRID} strokeDasharray="2 3" />
      <path d={shape} fill="rgba(63, 182, 255, 0.12)" stroke={HL} strokeWidth="1.4" />
      <text x={(SHAPE.x0 + SHAPE.x1) / 2} y={BOT + 17} fill={GUIDE} fontSize="9" textAnchor="middle">
        window shape
      </text>
      {[0, -40, -80, -120].map((db) => (
        <g key={db}>
          <line x1={RESP.x0} y1={ry(db)} x2={RESP.x1} y2={ry(db)} stroke={GRID} strokeDasharray="2 3" />
          <text x={RESP.x0 - 3} y={ry(db) + 3} fill={GUIDE} fontSize="8" textAnchor="end">
            {db}
          </text>
        </g>
      ))}
      <path d={resp} fill="none" stroke={HL} strokeWidth="1.2" />
      {[-10, -5, 0, 5, 10].map((d) => (
        <text key={d} x={rx(d)} y={BOT + 9} fill={GUIDE} fontSize="8" textAnchor="middle">
          {d}
        </text>
      ))}
      <text x={(RESP.x0 + RESP.x1) / 2} y={BOT + 19} fill={GUIDE} fontSize="9" textAnchor="middle">
        response to a tone, dB vs. bins
      </text>
    </svg>
  )
}
