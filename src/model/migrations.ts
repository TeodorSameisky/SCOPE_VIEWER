/**
 * Saved data carries the version of its format. Most changes need no migration: `sanitizeWorkspace`
 * gives a field that is missing its default, and ignores fields it does not know. A step is for the
 * rest — a field renamed, split, or meant differently — so data saved before the change is still
 * read as it was meant. The change then raises the version and adds the step that turns data of
 * the previous version into data of the new one (see WORKSPACE_MIGRATIONS in workspace.ts).
 */

/** Turns data of version N into data of version N + 1, without changing its argument */
export type MigrationStep = (raw: Record<string, unknown>) => Record<string, unknown>

/** Version of a saved object; data from before versions were written counts as the first */
export function versionOf(raw: unknown): number {
  const v = raw && typeof raw === 'object' ? (raw as { version?: unknown }).version : undefined
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1
}

/**
 * Bring data from version `from` up to `to` by running the steps in between, in order. Data of
 * the current or a newer version is returned as it is. Undefined when it is not an object or a
 * step fails: like any other broken data, that falls back to the defaults.
 */
export function upgrade(raw: unknown, from: number, to: number, steps: Readonly<Record<number, MigrationStep>>): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  let data = raw as Record<string, unknown>
  try {
    for (let v = from; v < to; v++) {
      const step = steps[v]
      if (!step) throw new Error(`no migration from version ${v}`)
      data = { ...step(data), version: v + 1 }
    }
  } catch {
    return undefined
  }
  return data
}
