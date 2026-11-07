import { describe, expect, it } from 'vitest'
import { MinMaxPyramid } from '../dsp/minmax'
import type { Callout } from './callouts'
import {
  addCallout,
  addMath,
  addSpectrum,
  adjustChannel,
  autoscale,
  changeMath,
  changeSpectrum,
  clearCallouts,
  clearSpectra,
  deleteCallout,
  duplicateCallout,
  mergeCallouts,
  moveToView,
  patchChannel,
  patchChannels,
  placeCursor,
  removeMath,
  removeSpectrum,
  setMeasurementExclude,
  setMeasurementKeys,
  setMeasurementRange,
  setNotes,
  setSpectrumOptions,
  setViewSizes,
  shiftCallout,
  showAll,
  showCursors,
  showOnly,
  toggleSpectrum,
  updateCallout,
} from './edits'
import { MAX_MATH } from './math'
import { MAX_SPECTRA } from './spectrum'
import type { Session } from './types'
import { autoscalePatches, type LiveChannel } from './view'
import { analysisOf, defaultWorkspace, type Analysis } from './workspace'

const wave = (id: string, data = new Float32Array(100)) => ({ id, data, t0: -1e-3, dt: 1e-5, yUnit: 'V', xUnit: 's' })
const display = (id: string, color: string, visible = true) => ({ id, label: '', color, visible, scale: 1, position: 0, offset: 0 })

/** CH1 and CH2 in the first view, CH3 (hidden) in the second */
const session: Session = {
  fileName: 'a.tss',
  fingerprint: 'fp',
  format: 'test',
  channels: [
    { wave: wave('CH1'), display: display('CH1', '#f2e32c') },
    { wave: wave('CH2'), display: display('CH2', '#22c8e6') },
    { wave: wave('CH3'), display: display('CH3', '#ff3d5a', false) },
  ],
  views: [['CH1', 'CH2'], ['CH3']],
}
const INPUTS = ['CH1', 'CH2', 'CH3']
const win = { start: -1e-3, end: 0 }

/** Freeze an analysis all the way down: an edit that changes its input instead of returning a new object throws */
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) frozen(v)
    Object.freeze(value)
  }
  return value
}

function analysis(over: Partial<Analysis> = {}): Analysis {
  return frozen({ ...analysisOf(defaultWorkspace(session)), ...over })
}

const note: Callout = { id: 'n1', n: 1, type: 'note', t: 0, channel: 'CH1', dx: 24, dy: -46, text: 'a', color: '#f2e32c' }
const marker: Callout = { id: 'm1', n: 2, type: 'marker', t: 1e-4, text: '', color: '#ff5a6a' }

describe('channel settings', () => {
  it('patches one or several channels', () => {
    const a = analysis()
    expect(patchChannel(a, 'CH2', { scale: 0.5 }).channels.find((d) => d.id === 'CH2')?.scale).toBe(0.5)
    const both = patchChannels(a, { CH1: { position: 2 }, CH2: { position: -2 } })
    expect(both.channels.map((d) => d.position)).toEqual([2, -2, 0])
    // channels not named keep their object
    expect(both.channels[2]).toBe(a.channels[2])
  })

  it('returns the same analysis when nothing changes', () => {
    const a = analysis()
    expect(patchChannel(a, 'CH1', { scale: 1 })).toBe(a)
    expect(patchChannel(a, 'NOPE', { scale: 3 })).toBe(a)
    const all = showAll(a)
    expect(showAll(all)).toBe(all)
    expect(showOnly(showOnly(a, 'CH1'), 'CH1')).toStrictEqual(showOnly(a, 'CH1'))
  })

  it('gives notes the new colour of their trace, unless they have a colour of their own', () => {
    const own: Callout = { ...note, id: 'n2', color: '#ffffff' }
    const other: Callout = { ...note, id: 'n3', channel: 'CH2', color: '#f2e32c' }
    const a = analysis({ callouts: [note, own, other, marker] })
    const b = adjustChannel(a, 'CH1', { color: '#00ff00' })
    expect(b.channels[0].color).toBe('#00ff00')
    expect(b.callouts.map((c) => c.color)).toEqual(['#00ff00', '#ffffff', '#f2e32c', '#ff5a6a'])
  })

  it('leaves the callouts alone when the colour stays or other settings change', () => {
    const a = analysis({ callouts: [note] })
    expect(adjustChannel(a, 'CH1', { color: '#f2e32c' })).toBe(a)
    expect(adjustChannel(a, 'CH1', { scale: 2 }).callouts).toBe(a.callouts)
  })

  it('shows one channel only, or all', () => {
    const a = analysis()
    expect(showOnly(a, 'CH2').channels.map((d) => d.visible)).toEqual([false, true, false])
    expect(showAll(a).channels.map((d) => d.visible)).toEqual([true, true, true])
  })
})

describe('autoscale', () => {
  const sine = (amp: number) => Float32Array.from({ length: 100 }, (_, i) => amp * Math.sin((i / 100) * 2 * Math.PI))
  const live = (id: string, amp: number, disp: Analysis['channels'][number]): LiveChannel => {
    const w = wave(id, sine(amp))
    return { wave: w, display: disp, pyramid: new MinMaxPyramid(w.data) }
  }

  it('fits the named channels, as autoscalePatches computes it, and no others', () => {
    const a = analysis()
    const channels = [live('CH1', 5, a.channels[0]), live('CH2', 0.1, a.channels[1])]
    const next = autoscale(a, channels, ['CH1'], { start: -1e-3, end: 0 }, 10)
    const expected = autoscalePatches(channels, a.views, ['CH1'], { start: -1e-3, end: 0 }, 10)
    expect(next.channels[0]).toMatchObject(expected.CH1)
    expect(next.channels[0].scale).not.toBe(1)
    expect(next.channels[1]).toBe(a.channels[1])
  })
})

describe('views', () => {
  it('moves a channel into another view', () => {
    const a = analysis()
    expect(moveToView(a, 'CH2', 1).views).toEqual([['CH1'], ['CH3', 'CH2']])
  })

  it('moves a channel to a new view past the last, and drops the view it leaves empty', () => {
    const a = analysis()
    expect(moveToView(a, 'CH3', 2).views).toEqual([['CH1', 'CH2'], ['CH3']])
    expect(moveToView(a, 'CH3', 0).views).toEqual([['CH1', 'CH2', 'CH3']])
    expect(moveToView(a, 'CH1', 5).views).toEqual([['CH2'], ['CH3'], ['CH1']])
  })

  it('carries the view sizes with the channels', () => {
    const a = analysis({ viewSizes: [0.7, 0.3] })
    // CH3 leaves its view, which goes: the first view keeps its size, the new one gets the mean
    const b = moveToView(a, 'CH3', 0)
    expect(b.views).toEqual([['CH1', 'CH2', 'CH3']])
    expect(b.viewSizes).toEqual([1])
    expect(setViewSizes(a, undefined).viewSizes).toBeUndefined()
    expect(setViewSizes(a, [0.5, 0.5]).viewSizes).toEqual([0.5, 0.5])
  })
})

describe('math channels', () => {
  it('adds the difference of the first two visible channels, in a view of its own', () => {
    const r = addMath(analysis(), INPUTS)
    expect(r?.id).toBe('MATH1')
    expect(r?.expr).toBe('CH1 - CH2')
    expect(r?.doc.math).toEqual([{ id: 'MATH1', expr: 'CH1 - CH2' }])
    expect(r?.doc.views).toEqual([['CH1', 'CH2'], ['CH3'], ['MATH1']])
    const d = r?.doc.channels.find((c) => c.id === 'MATH1')
    expect(d).toMatchObject({ visible: true, scale: 1, position: 0, offset: 0 })
  })

  it('skips hidden channels, and negates the only visible one', () => {
    const only1 = showOnly(analysis(), 'CH1')
    expect(addMath(only1, INPUTS)?.expr).toBe('-CH1')
    const hidden1 = patchChannel(analysis(), 'CH1', { visible: false })
    expect(addMath(hidden1, INPUTS)?.expr).toBe('-CH2')
  })

  it('numbers math channels past those of the file and those already added', () => {
    const first = addMath(analysis(), ['CH1', 'CH2', 'MATH1'])
    expect(first?.id).toBe('MATH2')
    const second = addMath(first!.doc, ['CH1', 'CH2', 'MATH1'])
    expect(second?.id).toBe('MATH3')
  })

  it('adds nothing at the limit', () => {
    let a = analysis()
    for (let i = 0; i < MAX_MATH; i++) a = addMath(a, INPUTS)!.doc
    expect(a.math).toHaveLength(MAX_MATH)
    expect(addMath(a, INPUTS)).toBeUndefined()
  })

  it('changes an expression', () => {
    const a = addMath(analysis(), INPUTS)!.doc
    const b = changeMath(a, 'MATH1', { expr: 'CH1 * CH2', unit: 'W' })
    expect(b.math[0]).toEqual({ id: 'MATH1', expr: 'CH1 * CH2', unit: 'W' })
  })

  it('removes a math channel with everything that refers to it', () => {
    const base = addMath(analysis(), INPUTS)!.doc
    const onIt: Callout = { ...note, id: 'x1', channel: 'MATH1' }
    const spanTo: Callout = { id: 'x2', n: 3, type: 'span', t: 0, t2: 1e-4, channel: 'CH1', channel2: 'MATH1', text: '', color: '#c86bff' }
    const region: Callout = { id: 'x3', n: 4, type: 'region', t: 0, t2: 1e-4, text: '', color: '#3fb6ff', measure: { channel: 'MATH1', keys: ['pkpk'] } }
    const a = frozen({
      ...base,
      callouts: [note, onIt, spanTo, region],
      spectra: [{ id: 'FFT1', source: 'MATH1', window: 'hann' as const, visible: true }, { id: 'FFT2', source: 'CH1', window: 'hann' as const, visible: true }],
      measurements: { ...base.measurements, exclude: ['MATH1', 'CH3'] },
      cursors: { ...base.cursors, source: 'MATH1' },
    })
    const b = removeMath(a, 'MATH1', 'CH1')
    expect(b.math).toEqual([])
    expect(b.channels.map((d) => d.id)).toEqual(INPUTS)
    expect(b.views).toEqual([['CH1', 'CH2'], ['CH3']])
    expect(b.spectra.map((s) => s.id)).toEqual(['FFT2'])
    expect(b.measurements.exclude).toEqual(['CH3'])
    expect(b.cursors.source).toBe('CH1')
    // the notes and spans on its trace go; a region only stops measuring it
    expect(b.callouts.map((c) => c.id)).toEqual(['n1', 'x3'])
    expect(b.callouts[1].measure).toBeUndefined()
  })

  it('keeps cursors that have another source', () => {
    const a = addMath(analysis(), INPUTS)!.doc
    expect(removeMath(a, 'MATH1', 'CH1').cursors).toBe(a.cursors)
  })
})

describe('callouts', () => {
  it('adds a note in the colour of its trace, with a place for its text', () => {
    const a = analysis({ callouts: [marker] })
    const r = addCallout(a, { type: 'note', t: 1e-4, channel: 'CH2' }, 'id9')
    expect(r.callout).toMatchObject({ id: 'id9', n: 3, type: 'note', text: '', color: '#22c8e6', dx: 24, dy: -46, channel: 'CH2' })
    expect(r.doc.callouts).toEqual([marker, r.callout])
    expect(addCallout(a, { type: 'note', t: 0, channel: 'CH2', dy: 10 }, 'x').callout.dy).toBe(10)
  })

  it('gives the other types the colour of their type', () => {
    const r = addCallout(analysis(), { type: 'marker', t: 0 })
    expect(r.callout.color).toBe('#ff5a6a')
    expect(r.callout.dx).toBeUndefined()
    expect(r.callout.id).toBeTruthy()
    // a note that is not on a trace
    expect(addCallout(analysis(), { type: 'note', t: 0, view: 0, div: 1 }).callout.color).toBe('#ffd84d')
  })

  it('updates, deletes and clears', () => {
    const a = analysis({ callouts: [note, marker] })
    expect(updateCallout(a, 'm1', { text: 'edge' }).callouts[1].text).toBe('edge')
    expect(updateCallout(a, 'm1', { text: 'edge' }).callouts[0]).toBe(note)
    expect(deleteCallout(a, 'n1').callouts).toEqual([marker])
    expect(clearCallouts(a).callouts).toEqual([])
    const none = analysis()
    expect(clearCallouts(none)).toBe(none)
  })

  it('merges callouts from a file, replacing those with the same id', () => {
    const a = analysis({ callouts: [note, marker] })
    const edited = { ...marker, text: 'from file' }
    const added: Callout = { ...marker, id: 'm2', n: 3 }
    expect(mergeCallouts(a, [edited, added]).callouts).toEqual([note, edited, added])
  })

  it('duplicates a callout a little later, with a number of its own', () => {
    const region: Callout = { id: 'r1', n: 5, type: 'region', t: 0, t2: 1e-3, text: 'w', color: '#3fb6ff' }
    const a = analysis({ callouts: [region] })
    const r = duplicateCallout(a, region, 1e-4, 'copy')
    expect(r.callout).toMatchObject({ id: 'copy', n: 6, t: 1e-4, t2: 1e-3 + 1e-4, text: 'w' })
    expect(r.doc.callouts).toHaveLength(2)
    expect(duplicateCallout(a, note, 1e-4, 'c2').callout.t2).toBeUndefined()
  })

  it('moves a callout in time, both ends of a span', () => {
    const region: Callout = { id: 'r1', n: 5, type: 'region', t: 0, t2: 1e-3, text: '', color: '#3fb6ff' }
    const a = analysis({ callouts: [note, region] })
    const b = shiftCallout(a, 'r1', 2e-4)
    expect(b.callouts[1].t).toBeCloseTo(2e-4, 12)
    expect(b.callouts[1].t2).toBeCloseTo(1.2e-3, 12)
    expect(b.callouts[0]).toBe(note)
  })
})

describe('cursors', () => {
  const cursors = { on: false, a: -8e-4, b: -2e-4, source: 'CH1' }

  it('switches them on where they are when both are in the view', () => {
    const a = analysis({ cursors })
    expect(showCursors(a, win).cursors).toEqual({ ...cursors, on: true })
  })

  it('brings them into the view when they are off-screen', () => {
    const a = analysis({ cursors: { ...cursors, a: 5, b: 6 } })
    const c = showCursors(a, win).cursors
    expect(c.on).toBe(true)
    expect(c.a).toBeCloseTo(-1e-3 + 1e-3 * 0.3)
    expect(c.b).toBeCloseTo(-1e-3 + 1e-3 * 0.7)
  })

  it('leaves cursors that are on', () => {
    const a = analysis({ cursors: { ...cursors, on: true, a: 5 } })
    expect(showCursors(a, win)).toBe(a)
  })

  it('puts one cursor at a time, and the other one into the view if the cursors come on', () => {
    const a = analysis({ cursors: { ...cursors, b: 5 } })
    const c = placeCursor(a, 'a', -5e-4, win).cursors
    expect(c).toMatchObject({ on: true, a: -5e-4 })
    // the other is moved a fifth of the view after A, but within the view
    expect(c.b).toBeCloseTo(-5e-4 + 0.2 * 1e-3)
    const d = placeCursor(analysis({ cursors: { ...cursors, a: -5 } }), 'b', -9e-4, win).cursors
    expect(d.b).toBe(-9e-4)
    expect(d.a).toBeCloseTo(-1e-3)
  })

  it('keeps the other cursor where it is when the cursors are on already', () => {
    const a = analysis({ cursors: { ...cursors, on: true, b: 5 } })
    expect(placeCursor(a, 'a', -5e-4, win).cursors).toEqual({ on: true, a: -5e-4, b: 5, source: 'CH1' })
  })
})

describe('measurements', () => {
  it('chooses the columns and the channels', () => {
    const a = analysis()
    expect(setMeasurementKeys(a, ['max']).measurements.keys).toEqual(['max'])
    expect(setMeasurementExclude(a, ['CH2']).measurements.exclude).toEqual(['CH2'])
    expect(setMeasurementExclude(setMeasurementExclude(a, ['CH2']), (ids) => [...ids, 'CH3']).measurements.exclude).toEqual(['CH2', 'CH3'])
  })

  it('brings the cursors into view for the range "between cursors", and only then', () => {
    const a = analysis({ cursors: { on: false, a: 5, b: 6, source: 'CH1' } })
    const c = setMeasurementRange(a, 'cursors', win)
    expect(c.measurements.range).toBe('cursors')
    expect(c.cursors.on).toBe(true)
    const r = setMeasurementRange(a, 'record', win)
    expect(r.measurements.range).toBe('record')
    expect(r.cursors).toBe(a.cursors)
  })
})

describe('spectra', () => {
  it('adds, toggles, changes and removes spectra', () => {
    const a = addSpectrum(analysis(), 'CH1')
    expect(a.spectra).toMatchObject([{ id: 'FFT1', source: 'CH1', visible: true }])
    // a second one of the same channel takes another window, so the two differ
    const two = addSpectrum(a, 'CH1')
    expect(two.spectra[1].window).not.toBe(two.spectra[0].window)
    expect(toggleSpectrum(a, 'CH1').spectra).toEqual([])
    expect(toggleSpectrum(a, 'CH2').spectra.map((s) => s.source)).toEqual(['CH1', 'CH2'])
    expect(changeSpectrum(a, 'FFT1', { window: 'flatTop', visible: false }).spectra[0]).toMatchObject({ window: 'flatTop', visible: false })
    expect(removeSpectrum(two, 'FFT1').spectra.map((s) => s.id)).toEqual(['FFT2'])
    expect(clearSpectra(two).spectra).toEqual([])
  })

  it('adds nothing at the limit', () => {
    let a = analysis()
    for (let i = 0; i < MAX_SPECTRA; i++) a = addSpectrum(a, 'CH1')
    expect(a.spectra).toHaveLength(MAX_SPECTRA)
    expect(addSpectrum(a, 'CH2')).toBe(a)
  })

  it('changes the shared settings; the range "between cursors" brings the cursors into view', () => {
    const a = analysis({ cursors: { on: false, a: 5, b: 6, source: 'CH1' } })
    const b = setSpectrumOptions(a, { scale: 'linear' }, win)
    expect(b.spectrumOptions.scale).toBe('linear')
    expect(b.cursors).toBe(a.cursors)
    const c = setSpectrumOptions(a, { range: 'cursors' }, win)
    expect(c.spectrumOptions.range).toBe('cursors')
    expect(c.cursors.on).toBe(true)
  })

  it('leaves clearing alone when there is nothing to clear', () => {
    const a = analysis()
    expect(clearSpectra(a)).toBe(a)
  })
})

describe('notes', () => {
  it('sets the notes, and is no change for the same text', () => {
    const a = analysis()
    expect(setNotes(a, 'event at 3 ms').notes).toBe('event at 3 ms')
    expect(setNotes(a, a.notes)).toBe(a)
  })
})
