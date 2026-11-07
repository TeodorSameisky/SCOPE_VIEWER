/**
 * Whether two JSON-like values (objects, arrays, strings, numbers, booleans, null) have the same
 * content, as comparing their JSON would say – but without writing it out: parts that are the very
 * same object are not looked into at all. Edits of the analysis keep the parts they do not change, so
 * comparing the analysis before and after a change costs about as much as the change, not the size of
 * the analysis.
 *
 * Like in JSON, a key whose value is undefined counts as missing, and NaN equals NaN (JSON makes both null).
 */
export function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b)
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const arrayA = Array.isArray(a)
  if (arrayA !== Array.isArray(b)) return false
  if (arrayA) {
    const listB = b as unknown[]
    if (a.length !== listB.length) return false
    return a.every((v, i) => sameContent(v, listB[i]))
  }
  const objA = a as Record<string, unknown>
  const objB = b as Record<string, unknown>
  let countA = 0
  for (const key of Object.keys(objA)) {
    if (objA[key] === undefined) continue
    countA++
    if (!sameContent(objA[key], objB[key])) return false
  }
  let countB = 0
  for (const key of Object.keys(objB)) if (objB[key] !== undefined) countB++
  return countA === countB
}
