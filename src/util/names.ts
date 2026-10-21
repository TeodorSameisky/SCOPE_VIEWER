/** Display names for channel ids: CH1 → "Ch 1", MATH2 → "Math 2" */
export function channelName(id: string): string {
  const m = /^(CH|MATH|REF)(\d+)$/i.exec(id)
  if (!m) return id
  const kind = m[1].toUpperCase()
  return `${kind === 'CH' ? 'Ch' : kind === 'MATH' ? 'Math' : 'Ref'} ${m[2]}`
}

/** Short tag used on the plot: CH1 → "C1", MATH2 → "M2" */
export function channelTag(id: string): string {
  return id.replace(/^CH/i, 'C').replace(/^MATH/i, 'M').replace(/^REF/i, 'R')
}
