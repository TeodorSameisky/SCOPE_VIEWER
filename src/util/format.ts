const PREFIXES: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
  [1e-15, 'f'],
]

/** Format a value with an SI prefix, e.g. 0.0000257 s -> "25.70 µs". */
export function si(value: number, unit = '', digits = 4): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return `0 ${unit}`.trim()
  const abs = Math.abs(value)
  const [mult, prefix] = PREFIXES.find(([m]) => abs >= m * 0.9995) ?? PREFIXES[PREFIXES.length - 1]
  const scaled = value / mult
  const intDigits = Math.max(1, Math.floor(Math.log10(Math.abs(scaled))) + 1)
  const decimals = Math.max(0, digits - intDigits)
  return `${scaled.toFixed(decimals)} ${prefix}${unit}`.trim()
}

/**
 * Compact SI format for axis ticks. `step` is the tick spacing; enough decimals
 * are shown to tell neighbouring ticks apart, trailing zeros are removed.
 */
export function siTick(value: number, unit = '', step?: number): string {
  if (Math.abs(value) < (step ?? 1e-15) * 1e-6) return `0 ${unit}`.trim()
  const abs = Math.abs(value)
  const [mult, prefix] = PREFIXES.find(([m]) => abs >= m * 0.9995) ?? PREFIXES[PREFIXES.length - 1]
  const decimals = step ? Math.min(12, Math.max(0, -Math.floor(Math.log10(step / mult) + 1e-9))) : 3
  const scaled = parseFloat((value / mult).toFixed(decimals))
  return `${scaled} ${prefix}${unit}`.trim()
}

/** Round a step up to the 1-2-5 sequence. */
export function niceStep(raw: number): number {
  const exp = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / exp
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10
  return nice * exp
}

/** File / storage size for display: "512 B", "37 kB", "2.2 MB", "1.05 GB" (binary units) */
export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} kB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
