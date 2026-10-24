/**
 * Undo/redo history of a document made of immutable snapshots.
 *
 * Changes are grouped into steps: the first change after `commit()` opens a step (the state
 * before it goes on the undo stack), further changes join that step until the next `commit()`.
 * The caller commits at the end of a gesture (pointer up, a key press, a pause), so a drag or
 * a burst of typing is undone in one go.
 *
 * A step can also move a view that is not part of the document (a zoom that scales channels
 * moves the time window with them): `moveView` attaches it, and undo / redo return the view to
 * go to together with the document.
 *
 * `subscribe` / `getVersion` follow React's useSyncExternalStore: the version changes whenever
 * the stacks do.
 */

interface ViewMove<V> {
  from: V
  to: V
}

/** A step: the document on the other side of it, and the view it moved */
interface Step<T, V> {
  doc: T
  view?: ViewMove<V>
}

/** What undo / redo restores */
export interface Restore<T, V> {
  doc: T
  /** The view to go to, when the step moved one */
  view?: V
}

export class UndoHistory<T, V = never> {
  /** Steps done, each with the document before it */
  private past: Step<T, V>[] = []
  /** Steps undone, each with the document after it */
  private future: Step<T, V>[] = []
  /** State at the last commit (or undo/redo) */
  private base: T
  private baseJson: string
  private latest: T
  private open = false
  /** View moved for the step the next change opens */
  private moved?: ViewMove<V>
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
    this.past.push({ doc: this.base, view: this.moved })
    this.moved = undefined
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
    this.open = true
    this.started++
    this.notify()
    return true
  }

  /**
   * The open step, or else the one the next change opens, also moves the view from `from` to
   * `to`. Without a change before the next commit it is dropped: the view moved on its own.
   */
  moveView(from: V, to: V): void {
    const step = this.open ? this.past[this.past.length - 1] : undefined
    if (step) step.view = { from: step.view?.from ?? from, to }
    else this.moved = { from, to }
  }

  /** End the open step; returns true when the stacks changed */
  commit(): boolean {
    this.moved = undefined
    if (!this.open) return false
    this.open = false
    this.setBase(this.latest)
    // A step that ended where it started (e.g. a drag back to the start) is no step
    if (this.past.length && JSON.stringify(this.past[this.past.length - 1].doc) === this.baseJson) this.past.pop()
    this.notify()
    return true
  }

  /** The state to go back to, or undefined when there is nothing to undo */
  undo(): Restore<T, V> | undefined {
    this.commit()
    const step = this.past.pop()
    if (step === undefined) return undefined
    this.future.push({ doc: this.base, view: step.view })
    this.setBase(step.doc)
    this.notify()
    return { doc: step.doc, view: step.view?.from }
  }

  redo(): Restore<T, V> | undefined {
    this.commit()
    const step = this.future.pop()
    if (step === undefined) return undefined
    this.past.push({ doc: this.base, view: step.view })
    this.setBase(step.doc)
    this.notify()
    return { doc: step.doc, view: step.view?.to }
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
