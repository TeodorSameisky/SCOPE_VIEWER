/**
 * Composes an exported image: header with acquisition info, channel legend, the
 * plot (and spectrum) rendered at the requested resolution, and the measurement table.
 * All sizes are in CSS pixels and multiplied by `scale`.
 */
import { MONO, SANS as FONT } from '../render/fonts'
import type { Theme } from '../render/theme'

export interface LegendItem {
  name: string
  label: string
  color: string
  detail: string
}

export interface ImageTable {
  columns: string[]
  rows: { color?: string; cells: string[] }[]
}

export interface ImageContent {
  scale: number
  /** CSS width of the image (= plot width) */
  width: number
  header?: { title: string; lines: string[] }
  legend?: LegendItem[]
  /** Canvases already rendered at `scale` */
  plots: HTMLCanvasElement[]
  table?: ImageTable
  footer?: string
  /** Colours; the plots must already be drawn with the same theme */
  theme: Theme
}

const PAD = 14

export function composeImage(c: ImageContent): HTMLCanvasElement {
  const s = c.scale
  const W = c.width
  const { theme } = c
  // Measure with a scratch context to know the height before drawing
  const probe = document.createElement('canvas').getContext('2d')!
  const headerH = c.header ? 24 + c.header.lines.length * 17 + PAD : 0
  const legendLayout = c.legend ? layoutLegend(probe, c.legend, W - 2 * PAD) : null
  const legendH = legendLayout ? legendLayout.height + PAD : 0
  const plotsH = c.plots.reduce((h, p) => h + p.height / s, 0)
  const tableLayout = c.table && c.table.rows.length ? layoutTable(probe, c.table, W - 2 * PAD) : null
  const tableH = tableLayout ? tableLayout.height + 2 * PAD : 0
  const footerH = c.footer ? 22 : 0

  const out = document.createElement('canvas')
  out.width = Math.round(W * s)
  out.height = Math.round((headerH + legendH + plotsH + tableH + footerH) * s)
  const ctx = out.getContext('2d')!
  ctx.setTransform(s, 0, 0, s, 0, 0)
  ctx.fillStyle = theme.page
  ctx.fillRect(0, 0, W, out.height / s)
  ctx.textBaseline = 'alphabetic'
  let y = 0

  if (c.header) {
    ctx.fillStyle = theme.panel
    ctx.fillRect(0, 0, W, headerH)
    ctx.fillStyle = theme.text
    ctx.font = `600 16px ${FONT}`
    ctx.fillText(c.header.title, PAD, PAD + 14)
    ctx.font = `12px ${MONO}`
    ctx.fillStyle = theme.muted
    c.header.lines.forEach((l, i) => ctx.fillText(l, PAD, PAD + 34 + i * 17))
    y = headerH
  }

  if (legendLayout) {
    for (const it of legendLayout.items) {
      const x = PAD + it.x
      const yy = y + PAD / 2 + it.y
      ctx.fillStyle = theme.panel
      ctx.fillRect(x, yy, it.w, 34)
      ctx.fillStyle = theme.ink(it.item.color)
      ctx.fillRect(x, yy, it.w, 3)
      ctx.font = `700 12px ${FONT}`
      ctx.fillText(it.item.name, x + 7, yy + 17)
      ctx.fillStyle = theme.text
      ctx.font = `11.5px ${MONO}`
      ctx.fillText(it.item.detail, x + 7 + it.nameW + 8, yy + 17)
      ctx.fillStyle = theme.muted
      ctx.font = `11.5px ${FONT}`
      ctx.fillText(it.item.label || ' ', x + 7, yy + 30)
    }
    y += legendH
  }

  for (const p of c.plots) {
    ctx.drawImage(p, 0, y, p.width / s, p.height / s)
    y += p.height / s
  }

  if (tableLayout && c.table) {
    y += PAD
    const { colX, colW, rowH, fontSize } = tableLayout
    ctx.font = `${fontSize}px ${FONT}`
    ctx.fillStyle = theme.muted
    c.table.columns.forEach((col, i) => drawCell(ctx, col, PAD + colX[i], y + rowH - 6, colW[i], i > 0))
    ctx.fillStyle = theme.border
    ctx.fillRect(PAD, y + rowH, W - 2 * PAD, 1)
    c.table.rows.forEach((r, ri) => {
      const ry = y + (ri + 1) * rowH
      r.cells.forEach((cell, i) => {
        if (i === 0 && r.color) {
          ctx.fillStyle = theme.ink(r.color)
          ctx.beginPath()
          ctx.arc(PAD + 4, ry + rowH / 2 + 1, 4, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.fillStyle = theme.text
        ctx.font = i === 0 ? `${fontSize}px ${FONT}` : `${fontSize - 0.5}px ${MONO}`
        drawCell(ctx, cell, PAD + colX[i] + (i === 0 && r.color ? 12 : 0), ry + rowH - 6, colW[i] - (i === 0 && r.color ? 12 : 0), i > 0)
      })
      ctx.fillStyle = theme.border
      ctx.fillRect(PAD, ry + rowH, W - 2 * PAD, 1)
    })
    y += tableLayout.height + PAD
  }

  if (c.footer) {
    ctx.fillStyle = theme.muted
    ctx.font = `11px ${FONT}`
    ctx.fillText(c.footer, PAD, y + 15)
  }
  return out
}

function drawCell(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, right: boolean) {
  let t = text
  while (t.length > 1 && ctx.measureText(t).width > w - 6) t = t.slice(0, -2) + '…'
  ctx.textAlign = right ? 'right' : 'left'
  ctx.fillText(t, right ? x + w - 4 : x, y)
  ctx.textAlign = 'left'
}

function layoutLegend(ctx: CanvasRenderingContext2D, items: LegendItem[], maxW: number) {
  let x = 0
  let y = 0
  const out: { item: LegendItem; x: number; y: number; w: number; nameW: number }[] = []
  for (const item of items) {
    ctx.font = `700 12px ${FONT}`
    const nameW = ctx.measureText(item.name).width
    ctx.font = `11.5px ${MONO}`
    const detailW = ctx.measureText(item.detail).width
    ctx.font = `11.5px ${FONT}`
    const labelW = ctx.measureText(item.label).width
    const w = Math.ceil(Math.max(nameW + 8 + detailW, labelW) + 14)
    if (x > 0 && x + w > maxW) {
      x = 0
      y += 40
    }
    out.push({ item, x, y, w, nameW })
    x += w + 6
  }
  return { items: out, height: y + 34 + 6 }
}

/** Column widths from the content; the font shrinks (down to 9 px) to fit the width */
function layoutTable(ctx: CanvasRenderingContext2D, t: ImageTable, maxW: number) {
  let fontSize = 12
  let widths: number[] = []
  for (; fontSize >= 9; fontSize -= 0.5) {
    widths = t.columns.map((col, i) => {
      ctx.font = `${fontSize}px ${FONT}`
      let w = ctx.measureText(col).width
      ctx.font = `${fontSize}px ${i === 0 ? FONT : MONO}`
      for (const r of t.rows) w = Math.max(w, ctx.measureText(r.cells[i] ?? '').width + (i === 0 && r.color ? 12 : 0))
      return w + 18
    })
    if (widths.reduce((a, b) => a + b, 0) <= maxW) break
  }
  // Spread the remaining width over the value columns
  const total = widths.reduce((a, b) => a + b, 0)
  const extra = Math.max(0, maxW - total)
  const colW = widths.map((w, i) => (i === 0 ? w : w + extra / Math.max(1, widths.length - 1)))
  if (total > maxW) {
    // still too wide: scale all columns down (cells get ellipsised)
    const k = maxW / total
    for (let i = 0; i < colW.length; i++) colW[i] = widths[i] * k
  }
  const colX: number[] = []
  colW.reduce((x, w, i) => ((colX[i] = x), x + w), 0)
  const rowH = Math.round(fontSize * 1.9)
  return { colX, colW, rowH, fontSize, height: (t.rows.length + 1) * rowH }
}

export function canvasToBlob(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'))
}
