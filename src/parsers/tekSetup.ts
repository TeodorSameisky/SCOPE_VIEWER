/**
 * Parser for Tektronix SCPI "learn" setup files (*.set as stored in sessions).
 * Each line holds one or more `:HEADER:PATH value` commands separated by ';'.
 * Later occurrences of a header override earlier ones, like on the instrument.
 */
export function parseTekSetup(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    for (const cmd of line.split(/;(?=[:*])/)) {
      const c = cmd.trim()
      if (!c.startsWith(':')) continue
      const sp = c.indexOf(' ')
      const key = (sp < 0 ? c : c.slice(0, sp)).toUpperCase()
      const value = sp < 0 ? '' : c.slice(sp + 1).trim()
      out[key] = value
    }
  }
  return out
}

/** Strip surrounding quotes and URL-style escapes used by the 4/5/6-Series ("STO%20STAT"). */
export function setupString(v: string | undefined): string | undefined {
  if (v === undefined) return undefined
  const s = v.replace(/^"(.*)"$/, '$1')
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function setupNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}
