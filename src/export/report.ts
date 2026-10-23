/**
 * Self-contained HTML report of a session: notes, the exported image, channel and math
 * settings, measurements, cursors, callouts and spectrum peaks. Light and print-friendly,
 * so it can be printed to PDF from the browser.
 */
import { escapeHtml } from '../util/html'

export interface ReportTable {
  title: string
  columns: string[]
  /** Cells are text, or HTML that is already escaped */
  rows: { color?: string; cells: (string | { html: string })[] }[]
  note?: string
}

export interface ReportContent {
  title: string
  notes: string
  meta: [string, string][]
  /** PNG as data URL */
  image?: string
  tables: ReportTable[]
  generatedBy: string
}

export function buildReport(r: ReportContent): string {
  const table = (t: ReportTable) => `
  <section>
    <h2>${escapeHtml(t.title)}</h2>
    ${t.note ? `<p class="note">${escapeHtml(t.note)}</p>` : ''}
    <table>
      <thead><tr>${t.columns.map((c, i) => `<th${i ? ' class="num"' : ''}>${escapeHtml(c)}</th>`).join('')}</tr></thead>
      <tbody>
        ${t.rows
          .map(
            (row) =>
              `<tr>${row.cells
                .map((c, i) => {
                  const html = typeof c === 'string' ? escapeHtml(c) : c.html
                  return i === 0 ? `<td>${row.color ? `<span class="dot" style="background:${escapeHtml(row.color)}"></span>` : ''}${html}</td>` : `<td class="num">${html}</td>`
                })
                .join('')}</tr>`,
          )
          .join('\n        ')}
      </tbody>
    </table>
  </section>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(r.title)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1d2430; background: #fff; margin: 0; }
  main { max-width: 1100px; margin: 0 auto; padding: 28px 24px 48px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #d9dee6; }
  .sub { color: #5d6776; margin: 0 0 18px; }
  .notes { white-space: pre-wrap; background: #f4f6f9; border-left: 3px solid #1d7fc4; padding: 10px 14px; border-radius: 4px; }
  dl.meta { display: grid; grid-template-columns: max-content 1fr; gap: 3px 18px; margin: 0; }
  dl.meta dt { color: #5d6776; }
  dl.meta dd { margin: 0; font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
  figure { margin: 18px 0 0; }
  figure img { width: 100%; border-radius: 4px; border: 1px solid #d9dee6; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { padding: 5px 8px; border-bottom: 1px solid #e3e7ed; text-align: left; vertical-align: top; }
  th { color: #5d6776; font-weight: 600; }
  .num { text-align: right; font-family: ui-monospace, Consolas, monospace; white-space: nowrap; }
  td:first-child { white-space: nowrap; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px; vertical-align: 0; border: 1px solid rgba(0,0,0,.25); }
  .note { color: #5d6776; margin: 0 0 6px; font-size: 13px; }
  footer { margin-top: 36px; color: #8a93a1; font-size: 12px; }
  @media print {
    main { padding: 0; max-width: none; }
    section, figure { break-inside: avoid; }
    h2 { break-after: avoid; }
  }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(r.title)}</h1>
  <p class="sub">Oscilloscope session report</p>
  ${r.notes.trim() ? `<div class="notes">${escapeHtml(r.notes.trim())}</div>` : ''}
  <section>
    <h2>Session</h2>
    <dl class="meta">
      ${r.meta.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('\n      ')}
    </dl>
  </section>
  ${r.image ? `<figure><img src="${r.image}" alt="Waveforms"></figure>` : ''}
  ${r.tables.filter((t) => t.rows.length).map(table).join('\n')}
  <footer>${escapeHtml(r.generatedBy)}</footer>
</main>
</body>
</html>
`
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
