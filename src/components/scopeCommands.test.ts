import { describe, expect, it } from 'vitest'
import { MinMaxPyramid } from '../dsp/minmax'
import { AnalysisStore } from '../model/analysisStore'
import type { Callout } from '../model/callouts'
import { Timebase } from '../model/timebase'
import type { Session } from '../model/types'
import { UndoHistory } from '../model/undoHistory'
import type { LiveChannel, TimeWindow } from '../model/view'
import { analysisOf, defaultWorkspace, type Analysis } from '../model/workspace'
import { calloutMenu, channelMenu, paletteCommands, plotMenu, type ScopeActions, type ScopeApi } from './scopeCommands'
import type { Action } from './ui/action'
import type { MenuEntry } from './ui/menuContext'

// 1001 samples 1 ms apart: the record is 0 … 1 s
const wave = (id: string) => ({ id, data: new Float32Array(1001), t0: 0, dt: 1e-3, yUnit: 'V', xUnit: 's' })
const display = (id: string) => ({ id, label: '', color: '#f2e32c', visible: true, scale: 1, position: 0, offset: 0 })
const session: Session = {
  fileName: 'a.tss',
  fingerprint: 'fp',
  format: 'test',
  channels: ['CH1', 'CH2', 'CH3'].map((id) => ({ wave: wave(id), display: display(id) })),
  views: [['CH1', 'CH2'], ['CH3']],
}

/** Every action of the toolbar as one that does nothing (the menus only list them) */
const idle: Action = { label: 'action', run: () => {} }
const actions = new Proxy({} as ScopeActions, { get: (_, key) => (key === 'tools' || key === 'exports' ? new Proxy({}, { get: () => idle }) : idle) })

/**
 * The menus on a real analysis store and timebase, showing 0.4 … 0.6 s. The workspace verbs (selection,
 * editors, panels) are not what these tests are about: they record that they were asked.
 */
function setup(over: Partial<Analysis> = {}) {
  const store = new AnalysisStore({ ...analysisOf(defaultWorkspace(session)), ...over })
  const history = new UndoHistory<Analysis, TimeWindow>(store.get())
  const timebase = new Timebase(session, { start: 0.4, end: 0.6 }, { store, history })
  const asked: string[] = []
  const verb =
    (name: string) =>
    (...args: unknown[]) =>
      void asked.push(`${name} ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`.trim())
  const channels: LiveChannel[] = session.channels.map((c) => ({ wave: c.wave, display: c.display, pyramid: new MinMaxPyramid(c.wave.data) }))
  const api: ScopeApi = {
    session,
    store,
    timebase,
    actions,
    channels,
    selected: 'CH1',
    panel: null,
    measurementsShown: true,
    themePreference: 'system',
    setThemePreference: verb('theme'),
    select: verb('select'),
    autoscale: verb('autoscale'),
    toggleSpectrum: verb('toggleSpectrum'),
    addSpectrum: verb('addSpectrum'),
    addMath: verb('addMath'),
    removeMath: verb('removeMath'),
    openSettings: verb('openSettings'),
    addCallout: verb('addCallout'),
    editCallout: verb('editCallout'),
    deleteCallout: verb('deleteCallout'),
    jumpToCallout: verb('jumpToCallout'),
    zoomToBox: verb('zoomToBox'),
    duplicateCallout: verb('duplicateCallout'),
    setPanel: verb('setPanel'),
    openReference: verb('openReference'),
    copy: verb('copy'),
  }
  const doc = () => store.get()
  return { api, store, timebase, doc, asked }
}

/** Click the item (or the option of a choice) of a menu with this label */
function click(menu: MenuEntry[], label: string, option?: string) {
  for (const e of menu) {
    if (!e || e === '-' || !('label' in e) || e.label !== label) continue
    if ('options' in e) {
      const o = e.options.find((x) => x.label === option)
      if (!o) throw new Error(`no option ${option} in ${label}`)
      return o.onClick()
    }
    if ('onClick' in e && e.onClick) return e.onClick()
  }
  throw new Error(`no item ${label}`)
}

describe('the channel menu', () => {
  it('shows only one channel, then all of them again, in the analysis', () => {
    const { api, doc } = setup()
    click(channelMenu(api, 'CH2'), 'Show only this channel')
    expect(doc().channels.map((d) => d.visible)).toEqual([false, true, false])
    // Built again, the menu offers to show them all
    click(channelMenu(api, 'CH2'), 'Show all channels')
    expect(doc().channels.every((d) => d.visible)).toBe(true)
  })

  it('moves a channel to another view or a new one of its own', () => {
    const { api, doc } = setup()
    click(channelMenu(api, 'CH1'), 'View', '2')
    expect(doc().views).toEqual([['CH2'], ['CH3', 'CH1']])
    click(channelMenu(api, 'CH2'), 'View', 'New')
    expect(doc().views.some((v) => v.length === 1 && v[0] === 'CH2')).toBe(true)
  })

  it('takes a channel out of the measurement table and back', () => {
    const { api, doc } = setup()
    click(channelMenu(api, 'CH3'), 'Measure')
    expect(doc().measurements.exclude).toEqual(['CH3'])
    click(channelMenu(api, 'CH3'), 'Measure')
    expect(doc().measurements.exclude).toEqual([])
  })

  it('leaves what the workspace does around a change to its verbs', () => {
    const { api, asked } = setup()
    click(channelMenu(api, 'CH2'), 'Autoscale')
    click(channelMenu(api, 'CH2'), 'Settings…')
    expect(asked).toEqual(['autoscale ["CH2"]', 'openSettings CH2'])
  })
})

describe('the plot menu', () => {
  const at = { t: 0.45, onAxis: false, view: 0 }

  it('puts a cursor at the pointer, and the other one into the window as it is when clicked', () => {
    const { api, doc, timebase } = setup()
    const menu = plotMenu(api, at)
    // The window moves after the menu was built: the cursor follows the window of the click
    timebase.zoomTo({ start: 0.44, end: 0.54 })
    click(menu, 'Cursor', 'A here')
    const { cursors } = doc()
    expect(cursors.on).toBe(true)
    expect(cursors.a).toBe(0.45)
    expect(cursors.b).toBeGreaterThanOrEqual(0.44)
    expect(cursors.b).toBeLessThanOrEqual(0.54)
  })

  it('zooms the timebase around the pointer', () => {
    const { api, timebase } = setup()
    click(plotMenu(api, at), 'Zoom in here')
    const w = timebase.get().window
    expect(w.end - w.start).toBeCloseTo(0.1, 12)
    expect((0.45 - w.start) / (w.end - w.start)).toBeCloseTo(0.25, 12)
  })
})

describe('the callout menu', () => {
  const box: Callout = { id: 'b1', n: 1, type: 'box', t: 0.42, t2: 0.48, channel: 'CH1', v: -1, v2: 1, text: '', color: '#f2e32c' }

  it('changes the callout in the analysis', () => {
    const { api, doc } = setup({ callouts: [box] })
    click(calloutMenu(api, box), 'Shape', 'Ellipse')
    expect(doc().callouts[0].shape).toBe('ellipse')
  })

  it('sets the cursors to its time span', () => {
    const { api, doc } = setup({ callouts: [box] })
    click(calloutMenu(api, box), 'Set cursors to box')
    expect(doc().cursors).toMatchObject({ on: true, a: 0.42, b: 0.48 })
  })
})

describe('the palette', () => {
  const run = (api: ScopeApi, id: string) => {
    const c = paletteCommands(api).find((x) => x.id === id)
    if (!c) throw new Error(`no command ${id}`)
    c.run()
  }

  it('changes the measurements: the range, the columns and the channels measured', () => {
    const { api, doc } = setup()
    run(api, 'meas:range:cursors')
    // Measuring between the cursors brings them in, within the window
    expect(doc().measurements.range).toBe('cursors')
    expect(doc().cursors.on).toBe(true)
    expect(doc().cursors.a).toBeGreaterThanOrEqual(0.4)
    expect(doc().cursors.b).toBeLessThanOrEqual(0.6)
    const key = doc().measurements.keys[0]
    run(api, `meas:remove:${key}`)
    expect(doc().measurements.keys).not.toContain(key)
    run(api, 'ch:measure:CH2')
    expect(doc().measurements.exclude).toEqual(['CH2'])
  })

  it('hides a channel and shows them all again', () => {
    const { api, doc } = setup()
    run(api, 'ch:visible:CH1')
    expect(doc().channels[0].visible).toBe(false)
    run(api, 'ch:all')
    expect(doc().channels.every((d) => d.visible)).toBe(true)
  })
})
