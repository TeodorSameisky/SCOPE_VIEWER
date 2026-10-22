/**
 * Undo/redo history of a document made of immutable snapshots.
 *
 * Changes are grouped into steps: the first change after `commit()` opens a step (the state
 * before it goes on the undo stack), further changes join that step until the next `commit()`.
 * The caller commits at the end of a gesture (pointer up, a key press, a pause), so a drag or
 * a burst of typing is undone in one go.
 *
 * `subscribe` / `getVersion` follow React's useSyncExternalStore: the version changes whenever
 * the stacks do.
 */
export class UndoHistory<T> {
  private past: T[] = []
  private future: T[] = []
  /** State at the last commit (or undo/redo) */
  private base: T
  private baseJson: string
  private latest: T
  private open = false
  private readonly limit: number
  private version = 0
  private listeners = new Set<() => void>()
  /** Number of steps started so far */
  started = 0

  constructor(doc: T, limit = 200) {
    this.limit = limit
    this.base = doc
    this.latest = doc
    this.baseJson = JSON.stringify(doc)
  }

  /** The document changed; returns true when this started a new step */
  change(doc: T): boolean {
    this.latest = doc
    if (this.open) return false
    if (JSON.stringify(doc) === this.baseJson) return false
    this.past.push(this.base)
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
    this.open = true
    this.started++
    this.notify()
    return true
  }

  /** End the open step; returns true when the stacks changed */
  commit(): boolean {
    if (!this.open) return false
    this.open = false
    this.setBase(this.latest)
    // A step that ended where it started (e.g. a drag back to the start) is no step
    if (this.past.length && JSON.stringify(this.past[this.past.length - 1]) === this.baseJson) this.past.pop()
    this.notify()
    return true
  }

  /** The state to go back to, or undefined when there is nothing to undo */
  undo(): T | undefined {
    this.commit()
    const prev = this.past.pop()
    if (prev === undefined) return undefined
    this.future.push(this.base)
    this.setBase(prev)
    this.notify()
    return prev
  }

  redo(): T | undefined {
    this.commit()
    const next = this.future.pop()
    if (next === undefined) return undefined
    this.past.push(this.base)
    this.setBase(next)
    this.notify()
    return next
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = (): number => this.version

  private notify() {
    this.version++
    for (const l of this.listeners) l()
  }

  private setBase(doc: T) {
    this.base = doc
    this.latest = doc
    this.baseJson = JSON.stringify(doc)
  }
}
