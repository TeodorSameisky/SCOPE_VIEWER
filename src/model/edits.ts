/**
 * The changes a user can make to an analysis, as pure functions: each takes the current `Analysis`
 * and returns the next one (the same object when nothing changes). Nothing here knows about React,
 * the selection, the time window or a notice to show: the workspace calls them through the
 * `AnalysisStore` (`store.update((a) => addMath(a, ids))`) and does the UI parts of a change itself.
 *
 * What an edit needs besides the analysis (the ids of the file's channels, the visible time window,
 * the live channels with their samples) is passed in, so each edit can be tested on its own.
 */
import type { MeasurementKey } from '../dsp/measure'
import { DEFAULT_CALLOUT_COLOR, calloutsOn, newCalloutId, nextCalloutNumber, type Callout, type NewCallout } from './callouts'
import { MATH_COLORS, MAX_MATH, nextMathId, type MathDef } from './math'
import { MAX_SPECTRA, newSpectrum, type SpectrumDef, type SpectrumOptions } from './spectrum'
import { autoscalePatches, carryViewSizes, cursorsInView, patchDisplays, type CursorState, type DisplayPatch, type LiveChannel, type MeasureRange, type TimeWindow } from './view'
import type { Analysis } from './workspace'

// ---------- channels ----------

/** Change the settings of several channels at once (by id); the same analysis when they all stay as they are */
export function patchChannels(a: Analysis, patches: Record<string, DisplayPatch>): Analysis {
  const channels = patchDisplays(a.channels, patches)
  return channels === a.channels ? a : { ...a, channels }
}

/** Change the settings of one channel */
export function patchChannel(a: Analysis, id: string, patch: DisplayPatch): Analysis {
  return patchChannels(a, { [id]: patch })
}

/**
 * Change a channel's settings from its badge or a menu. A new colour also goes to the notes on its
 * trace that still have its old colour; a note given a colour of its own keeps it.
 */
export function adjustChannel(a: Analysis, id: string, patch: DisplayPatch): Analysis {
  const old = a.channels.find((d) => d.id === id)?.color
  const next = patchChannel(a, id, patch)
  const color = patch.color
  if (color === undefined || old === undefined || color === old) return next
  return { ...next, callouts: next.callouts.map((c) => (c.type === 'note' && c.channel === id && c.color === old ? { ...c, color } : c)) }
}

/** Show one channel and hide all others */
export function showOnly(a: Analysis, id: string): Analysis {
  return patchChannels(a, Object.fromEntries(a.channels.map((d) => [d.id, { visible: d.id === id }])))
}

/** Show every channel */
export function showAll(a: Analysis): Analysis {
  return patchChannels(a, Object.fromEntries(a.channels.map((d) => [d.id, { visible: true }])))
}

/**
 * Fit the samples of the channels `ids` that are in `range` into their views, `divs` high (see
 * `autoscalePatches`). `channels` are the live channels with their samples, as drawn.
 */
export function autoscale(a: Analysis, channels: LiveChannel[], ids: string[], range: TimeWindow, divs: number): Analysis {
  return patchChannels(a, autoscalePatches(channels, a.views, ids, range, divs))
}

// ---------- views ----------

/** Change the channels of the views; a view's size goes with its channels (see `carryViewSizes`) */
export function withViews(a: Analysis, change: (views: string[][]) => string[][]): Analysis {
  const views = change(a.views)
  return { ...a, views, viewSizes: carryViewSizes(a.views, a.viewSizes, views) }
}

/** Move a channel to view number `view`, or to a new view of its own when the number is past the last; emptied views go */
export function moveToView(a: Analysis, id: string, view: number): Analysis {
  return withViews(a, (views) => {
    const next = views.map((v) => v.filter((x) => x !== id))
    if (view >= next.length) next.push([id])
    else next[view].push(id)
    return next.filter((v) => v.length > 0)
  })
}

/** The share of the plot's height of each view (adding up to 1), or undefined for views of equal height */
export function setViewSizes(a: Analysis, viewSizes: number[] | undefined): Analysis {
  return { ...a, viewSizes }
}

// ---------- math channels ----------

/**
 * Add a math channel in a view of its own: `CH1 - CH2` of the first two visible input channels (else
 * the negation of the first). `inputIds` are the channels of the file, in order. Undefined at the limit.
 * The result also names the new channel and its expression, for what the caller does with them.
 */
export function addMath(a: Analysis, inputIds: string[]): { doc: Analysis; id: string; expr: string } | undefined {
  if (a.math.length >= MAX_MATH) return undefined
  const id = nextMathId(a.math, inputIds)
  const visible = inputIds.filter((x) => a.channels.find((d) => d.id === x)?.visible)
  const first = visible[0] ?? inputIds[0]
  const second = visible.find((x) => x !== first)
  const expr = second ? `${first} - ${second}` : `-${first}`
  const color = MATH_COLORS[(parseInt(id.slice(4), 10) - 1) % MATH_COLORS.length]
  const added: Analysis = {
    ...a,
    math: [...a.math, { id, expr }],
    channels: [...a.channels, { id, label: '', color, visible: true, scale: 1, position: 0, offset: 0 }],
  }
  return { doc: withViews(added, (views) => [...views, [id]]), id, expr }
}

/** Change the expression or unit of a math channel */
export function changeMath(a: Analysis, id: string, patch: Partial<MathDef>): Analysis {
  return { ...a, math: a.math.map((m) => (m.id === id ? { ...m, ...patch } : m)) }
}

/**
 * Delete a math channel with everything that refers to it: its settings and place in a view, its
 * spectra, the callouts on its trace, and the measurements regions and boxes took of it. Cursors that
 * used it as their source fall back to `fallbackId`.
 */
export function removeMath(a: Analysis, id: string, fallbackId: string): Analysis {
  const gone = new Set(calloutsOn(a.callouts, id).map((c) => c.id))
  const removed: Analysis = {
    ...a,
    math: a.math.filter((m) => m.id !== id),
    channels: a.channels.filter((d) => d.id !== id),
    spectra: a.spectra.filter((s) => s.source !== id),
    // A math channel made later under the same name is measured again
    measurements: { ...a.measurements, exclude: a.measurements.exclude.filter((x) => x !== id) },
    callouts: a.callouts.filter((c) => !gone.has(c.id)).map((c) => (c.measure?.channel === id ? { ...c, measure: undefined } : c)),
    cursors: a.cursors.source === id ? { ...a.cursors, source: fallbackId } : a.cursors,
  }
  return withViews(removed, (views) => views.map((v) => v.filter((x) => x !== id)).filter((v) => v.length > 0))
}

// ---------- callouts ----------

/**
 * Add a callout at the end of the list. A note takes the colour of its trace; the other types have a
 * colour of their own. A note gets a default place for its text box next to its anchor.
 */
export function addCallout(a: Analysis, nc: NewCallout, id: string = newCalloutId()): { doc: Analysis; callout: Callout } {
  const trace = nc.type === 'note' && nc.channel ? a.channels.find((d) => d.id === nc.channel) : undefined
  const callout: Callout = {
    id,
    n: nextCalloutNumber(a.callouts),
    text: '',
    color: trace?.color ?? DEFAULT_CALLOUT_COLOR[nc.type],
    ...nc,
    ...(nc.type === 'note' ? { dx: 24, dy: nc.dy ?? -46 } : {}),
  }
  return { doc: { ...a, callouts: [...a.callouts, callout] }, callout }
}

export function updateCallout(a: Analysis, id: string, patch: Partial<Callout>): Analysis {
  return { ...a, callouts: a.callouts.map((c) => (c.id === id ? { ...c, ...patch } : c)) }
}

export function deleteCallout(a: Analysis, id: string): Analysis {
  return { ...a, callouts: a.callouts.filter((c) => c.id !== id) }
}

export function clearCallouts(a: Analysis): Analysis {
  return a.callouts.length ? { ...a, callouts: [] } : a
}

/** Add callouts from a file; one with the id of a callout that is there replaces it */
export function mergeCallouts(a: Analysis, incoming: Callout[]): Analysis {
  const ids = new Set(incoming.map((c) => c.id))
  return { ...a, callouts: [...a.callouts.filter((c) => !ids.has(c.id)), ...incoming] }
}

/** A copy of a callout, `shift` seconds later, with a number of its own */
export function duplicateCallout(a: Analysis, source: Callout, shift: number, id: string = newCalloutId()): { doc: Analysis; callout: Callout } {
  const callout: Callout = { ...source, id, n: nextCalloutNumber(a.callouts), t: source.t + shift, ...(source.t2 !== undefined ? { t2: source.t2 + shift } : {}) }
  return { doc: { ...a, callouts: [...a.callouts, callout] }, callout }
}

/** Move a callout in time by `dt` seconds */
export function shiftCallout(a: Analysis, id: string, dt: number): Analysis {
  return { ...a, callouts: a.callouts.map((c) => (c.id === id ? { ...c, t: c.t + dt, ...(c.t2 !== undefined ? { t2: c.t2 + dt } : {}) } : c)) }
}

// ---------- cursors ----------

export function setCursors(a: Analysis, cursors: CursorState): Analysis {
  return { ...a, cursors }
}

/** Switch the cursors on where they are, or in the view at 30 % and 70 % when they are not within it ("between cursors" needs visible cursors) */
export function showCursors(a: Analysis, win: TimeWindow): Analysis {
  const c = a.cursors
  if (c.on) return a
  const inView = (t: number) => t >= win.start && t <= win.end
  return { ...a, cursors: inView(c.a) && inView(c.b) ? { ...c, on: true } : cursorsInView(c, win) }
}

/** Put cursor A or B at `t`. When the cursors come on, the other one is moved into the view if it is outside. */
export function placeCursor(a: Analysis, which: 'a' | 'b', t: number, win: TimeWindow): Analysis {
  const c = a.cursors
  const next: CursorState = { ...c, on: true }
  next[which] = t
  const other = which === 'a' ? 'b' : 'a'
  if (!c.on && (next[other] < win.start || next[other] > win.end)) {
    const span = win.end - win.start
    next[other] = Math.min(win.end, Math.max(win.start, t + (which === 'a' ? 0.2 : -0.2) * span))
  }
  return { ...a, cursors: next }
}

// ---------- measurements ----------

export function setMeasurementKeys(a: Analysis, keys: MeasurementKey[]): Analysis {
  return { ...a, measurements: { ...a.measurements, keys } }
}

/** Choose the samples measurements are taken from; "between cursors" brings the cursors into view */
export function setMeasurementRange(a: Analysis, range: MeasureRange, win: TimeWindow): Analysis {
  const next: Analysis = { ...a, measurements: { ...a.measurements, range } }
  return range === 'cursors' ? showCursors(next, win) : next
}

/** Leave channels out of the measurement table, or take them back in: the new list, or a change of the current one */
export function setMeasurementExclude(a: Analysis, change: string[] | ((ids: string[]) => string[])): Analysis {
  const exclude = typeof change === 'function' ? change(a.measurements.exclude) : change
  return { ...a, measurements: { ...a.measurements, exclude } }
}

// ---------- spectra ----------

/** Add the spectrum of a channel (a window other than that of its spectra already there, see `newSpectrum`); nothing at the limit */
export function addSpectrum(a: Analysis, source: string): Analysis {
  if (a.spectra.length >= MAX_SPECTRA) return a
  return { ...a, spectra: [...a.spectra, newSpectrum(a.spectra, source)] }
}

/** Remove the spectra of a channel, or add one when it has none */
export function toggleSpectrum(a: Analysis, source: string): Analysis {
  if (!a.spectra.some((s) => s.source === source)) return addSpectrum(a, source)
  return { ...a, spectra: a.spectra.filter((s) => s.source !== source) }
}

export function changeSpectrum(a: Analysis, id: string, patch: Partial<SpectrumDef>): Analysis {
  return { ...a, spectra: a.spectra.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
}

export function removeSpectrum(a: Analysis, id: string): Analysis {
  return { ...a, spectra: a.spectra.filter((s) => s.id !== id) }
}

export function clearSpectra(a: Analysis): Analysis {
  return a.spectra.length ? { ...a, spectra: [] } : a
}

/** Change the settings the spectra share; the range "between cursors" brings the cursors into view */
export function setSpectrumOptions(a: Analysis, patch: Partial<SpectrumOptions>, win: TimeWindow): Analysis {
  const next: Analysis = { ...a, spectrumOptions: { ...a.spectrumOptions, ...patch } }
  return patch.range === 'cursors' ? showCursors(next, win) : next
}

// ---------- notes ----------

export function setNotes(a: Analysis, notes: string): Analysis {
  return notes === a.notes ? a : { ...a, notes }
}
