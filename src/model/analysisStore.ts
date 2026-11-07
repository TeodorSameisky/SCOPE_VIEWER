import type { Analysis } from './workspace'

/**
 * The analysis of the open session (see `Analysis`) in one place that React does not own. Whatever
 * has to follow its changes subscribes: the components (`useAnalysis`), the undo history, autosave.
 * Changes are made with `update`, usually with one of the pure functions of edits.ts.
 *
 * The store also knows when the analysis was last changed (`changedAt`, ms since 1970): of two
 * versions of one session, in two tabs, the later one counts (see tabSync.ts). A change made here is
 * always later than any version taken over from another tab.
 */
export class AnalysisStore {
  private doc: Analysis
  private stamp: number
  private readonly clock: () => number
  private readonly listeners = new Set<() => void>()

  /** `changedAt`: when the analysis it starts with was changed, 0 when unknown */
  constructor(doc: Analysis, changedAt = 0, clock: () => number = Date.now) {
    this.doc = doc
    this.stamp = changedAt
    this.clock = clock
  }

  /** The current analysis (a new object whenever it changed, so it can be compared by identity) */
  get = (): Analysis => this.doc

  /** When the analysis shown was changed, here or in the tab it was taken over from */
  get changedAt(): number {
    return this.stamp
  }

  /** Call `listener` after every change; returns the function that stops it */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /**
   * Make a change here: the next analysis, or a function from the current one to it. Edits return
   * the same object when they change nothing, which is not a change. Several updates in a row each
   * see the result of the one before.
   */
  update = (change: Analysis | ((current: Analysis) => Analysis)): void => {
    const next = typeof change === 'function' ? change(this.doc) : change
    if (next === this.doc) return
    this.doc = next
    // Strictly later than the version before, also within the same millisecond
    this.stamp = Math.max(this.clock(), this.stamp + 1)
    this.notify()
  }

  /**
   * Take over an analysis that was changed elsewhere (another tab), `changedAt` being the time of that
   * change. Only a newer one is taken: returns whether it was. One with the same content only moves the
   * time forward. The next version made here is later still.
   */
  adopt(next: Analysis, changedAt: number): boolean {
    if (changedAt <= this.stamp) return false
    this.stamp = changedAt
    if (next === this.doc || JSON.stringify(next) === JSON.stringify(this.doc)) return false
    this.doc = next
    this.notify()
    return true
  }

  private notify(): void {
    for (const l of this.listeners) l()
  }
}
