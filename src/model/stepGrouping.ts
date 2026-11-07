/**
 * Decides when a step of the undo history ends. A drag, a wheel gesture or a burst of typing makes many
 * changes, and they belong together: one Undo takes them all back. The rules, in the order a user meets them:
 *
 *  - a press of the pointer starts a new gesture, so it ends the step before it;
 *  - a pause of `idleMs` after a change ends the step, unless the pointer is still held down (a drag);
 *  - a key press ends the step, except a repeat of a held key, a key typed in a text field (the browser's
 *    own undo takes care of those), or a key pressed during a drag (Esc puts the drag back);
 *  - while `hold` is on (a new callout and the text written into it) nothing ends the step; it ends when
 *    the hold ends.
 *
 * This only decides; it calls `commit` and knows nothing about the history, the DOM or React. The events
 * come from useUndoHistory.
 */
export class StepGrouper {
  private readonly commit: () => void
  private readonly idleMs: number
  private pointerIsDown = false
  private held = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(commit: () => void, idleMs = 700) {
    this.commit = commit
    this.idleMs = idleMs
  }

  /** The document changed: the step ends after a pause (each change starts the pause again) */
  changed(): void {
    this.waitForPause()
  }

  /** A press of the pointer: the gesture before it is over (unless held) */
  pointerDown(): void {
    this.pointerIsDown = true
    if (!this.held) this.commit()
  }

  /** The pointer is released or the gesture cancelled: the step stays open for the pause */
  pointerUp(): void {
    this.pointerIsDown = false
    this.waitForPause()
  }

  /** A key was pressed. `repeat`: the key is held down; `inTextField`: it is typed into an input */
  keyDown(key: { repeat: boolean; inTextField: boolean }): void {
    if (key.repeat || key.inTextField || this.pointerIsDown || this.held) return
    this.commit()
  }

  /** Keep the step open across gestures and pauses; turning it off ends the step */
  setHold(hold: boolean): void {
    this.held = hold
    if (!hold) this.commit()
  }

  /** Stop waiting (the history is gone) */
  dispose(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private waitForPause(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (!this.pointerIsDown && !this.held) this.commit()
    }, this.idleMs)
  }
}
