import { describe, expect, it } from 'vitest'
import { AnalysisStore } from './analysisStore'
import { BACK_STEPS, GESTURE_MS, Timebase } from './timebase'
import type { Session } from './types'
import { UndoHistory } from './undoHistory'
import type { TimeWindow } from './view'
import { analysisOf, defaultWorkspace, type Analysis } from './workspace'

// 1001 samples 1 ms apart: the record is 0…1 s, the narrowest window 10 ms, the widest 4 s
const wave = (id: string) => ({ id, data: new Float32Array(1001), t0: 0, dt: 1e-3, yUnit: 'V', xUnit: 's' })
const display = (id: string) => ({ id, label: '', color: '#f2e32c', visible: true, scale: 1, position: 0, offset: 0 })
const session: Session = {
  fileName: 'a.tss',
  fingerprint: 'fp',
  format: 'test',
  channels: [
    { wave: wave('CH1'), display: display('CH1') },
    { wave: wave('CH2'), display: display('CH2') },
  ],
  views: [['CH1', 'CH2']],
}

/** A timebase on a real store and undo history (subscribed as in the app), with a clock the test moves */
function setup(initial: TimeWindow = { start: 0.4, end: 0.6 }) {
  const clock = { t: 0 }
  const store = new AnalysisStore(analysisOf(defaultWorkspace(session)))
  const history = new UndoHistory<Analysis, TimeWindow>(store.get())
  store.subscribe(() => history.change(store.get()))
  const tb = new Timebase(session, initial, { store, history, now: () => clock.t })
  const win = () => tb.get().window
  const span = () => win().end - win().start
  /** The number of Back steps there are (going back through all of them) */
  const backSteps = () => {
    let n = 0
    while (tb.get().canGoBack) {
      tb.back()
      n++
    }
    return n
  }
  const scale = (id: string) => store.get().channels.find((c) => c.id === id)!.scale
  return { clock, store, history, tb, win, span, backSteps, scale }
}

describe('Timebase', () => {
  it('knows the record, the saved window and the zoom limits of the session', () => {
    const { tb } = setup()
    expect(tb.record).toEqual({ start: 0, end: 1 })
    expect(tb.savedWindow).toEqual({ start: 0, end: 1 })
    expect(tb.minSpan).toBeCloseTo(0.01)
    expect(tb.maxSpan).toBeCloseTo(4)
  })

  describe('Back steps', () => {
    it('groups a burst of wheel zooms into one step', () => {
      const { clock, tb, win, backSteps } = setup()
      for (let i = 0; i < 5; i++) {
        tb.zoomAt(0.5, 0.9, { continuous: true })
        clock.t += GESTURE_MS / 2
      }
      expect(win().end - win().start).toBeLessThan(0.2)
      expect(backSteps()).toBe(1)
      expect(win()).toEqual({ start: 0.4, end: 0.6 })
    })

    it('starts a new step after a pause or a change of kind', () => {
      const { clock, tb, backSteps } = setup()
      tb.zoomAt(0.5, 0.9, { continuous: true })
      clock.t += GESTURE_MS + 1
      tb.zoomAt(0.5, 0.9, { continuous: true })
      clock.t += 10
      tb.panBy(0.1)
      clock.t += 10
      tb.panBy(0.1)
      expect(backSteps()).toBe(3)
    })

    it('makes every zoom from a button, key or click a step of its own', () => {
      const { tb, backSteps } = setup()
      tb.zoomAt(0.5, 0.5)
      tb.zoomAt(0.5, 0.5)
      expect(backSteps()).toBe(2)
    })

    it('goes back twice when Back is pressed twice in a row', () => {
      const { tb, win } = setup()
      tb.zoomTo({ start: 0.45, end: 0.55 })
      tb.zoomTo({ start: 0.48, end: 0.52 })
      tb.back()
      tb.back()
      expect(win()).toEqual({ start: 0.4, end: 0.6 })
      expect(tb.get().canGoBack).toBe(false)
    })

    it(`keeps the last ${BACK_STEPS} steps`, () => {
      const { clock, tb, backSteps } = setup({ start: 0, end: 0.01 })
      for (let i = 0; i < BACK_STEPS + 10; i++) {
        tb.panBy(1)
        clock.t += GESTURE_MS + 1
      }
      expect(backSteps()).toBe(BACK_STEPS)
    })

    it('adds no step for a change that does not move the window', () => {
      const { tb, backSteps } = setup({ start: 0, end: 1 })
      tb.zoomTo({ start: 0, end: 1 })
      tb.panBy(-0.5)
      expect(backSteps()).toBe(0)
    })
  })

  describe('limits', () => {
    it('clamps every zoom between the narrowest and the widest window', () => {
      const { tb, span } = setup()
      tb.zoomAt(0.5, 1e-6)
      expect(span()).toBeCloseTo(tb.minSpan)
      tb.zoomAt(0.5, 1e6, { continuous: true })
      expect(span()).toBeCloseTo(tb.maxSpan)
      tb.zoomTo({ start: 0.5, end: 0.5 })
      expect(span()).toBeCloseTo(tb.minSpan)
    })

    it('centres a zoom to a range narrower than the narrowest window on the range', () => {
      const { tb, win } = setup()
      tb.zoomTo({ start: 0.3, end: 0.302 })
      expect((win().start + win().end) / 2).toBeCloseTo(0.301)
    })

    it('keeps a resized window between the limits', () => {
      const { tb, win, span } = setup()
      tb.resize('end', 0.3)
      expect(win().start).toBe(0.4)
      expect(span()).toBeCloseTo(tb.minSpan)
      tb.resize('start', -10)
      expect(span()).toBeLessThanOrEqual(tb.maxSpan + 1e-9)
    })
  })

  describe('the record', () => {
    it('stops pans at the ends of the record', () => {
      const { tb, win } = setup()
      tb.pan({ start: 0.9, end: 1.1 })
      expect(win().start).toBeCloseTo(0.8)
      expect(win().end).toBeCloseTo(1)
      tb.panBy(-10)
      expect(win().start).toBeCloseTo(0)
    })

    it('keeps zooms on the record unless they are free', () => {
      const { tb, win } = setup()
      tb.zoomTo({ start: 2, end: 2.1 })
      expect(win().start).toBeCloseTo(0.9)
      expect(win().end).toBeCloseTo(1)
      tb.zoomTo({ start: 2, end: 2.1 }, { free: true })
      expect(win().start).toBeCloseTo(2)
      expect(win().end).toBeCloseTo(2.1)
    })

    it('says when the window shows the whole record', () => {
      const { tb } = setup()
      expect(tb.get().showsRecord).toBe(false)
      tb.zoomTo(tb.record)
      expect(tb.get().showsRecord).toBe(true)
    })
  })

  describe('a zoom that scales channels', () => {
    it('changes the channels, and Back restores them with the window', () => {
      const { tb, win, scale } = setup()
      tb.zoomTo({ start: 0.45, end: 0.55 }, { patches: [{ id: 'CH1', patch: { scale: 0.5 } }] })
      expect(scale('CH1')).toBe(0.5)
      expect(scale('CH2')).toBe(1)
      tb.back()
      expect(scale('CH1')).toBe(1)
      expect(win()).toEqual({ start: 0.4, end: 0.6 })
    })

    it('is an undo step that returns the window, without a Back step of its own', () => {
      const { tb, history, store, win, scale, backSteps } = setup()
      tb.zoomTo({ start: 0.45, end: 0.55 }, { patches: [{ id: 'CH1', patch: { scale: 0.5 } }] })
      const undo = history.undo()!
      store.update(undo.doc)
      tb.show(undo.view!)
      expect(scale('CH1')).toBe(1)
      expect(win()).toEqual({ start: 0.4, end: 0.6 })

      const redo = history.redo()!
      store.update(redo.doc)
      tb.show(redo.view!)
      expect(scale('CH1')).toBe(0.5)
      expect(win()).toEqual({ start: 0.45, end: 0.55 })
      // Only the zoom itself
      expect(backSteps()).toBe(1)
    })

    it('makes Back from it an undo step that moves the window too', () => {
      const { tb, history, store, win, scale } = setup()
      tb.zoomTo({ start: 0.45, end: 0.55 }, { patches: [{ id: 'CH1', patch: { scale: 0.5 } }] })
      history.commit()
      tb.back()
      const undo = history.undo()!
      store.update(undo.doc)
      tb.show(undo.view!)
      expect(scale('CH1')).toBe(0.5)
      expect(win()).toEqual({ start: 0.45, end: 0.55 })
    })
  })

  it('tells subscribers about changes and keeps its state while nothing changes', () => {
    const { tb } = setup()
    let calls = 0
    const stop = tb.subscribe(() => calls++)
    const before = tb.get()
    expect(tb.get()).toBe(before)
    tb.panBy(0.1)
    expect(calls).toBe(1)
    expect(tb.get()).not.toBe(before)
    stop()
    tb.panBy(0.1)
    expect(calls).toBe(1)
  })
})
