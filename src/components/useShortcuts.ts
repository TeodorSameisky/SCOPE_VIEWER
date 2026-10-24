import { useEffect, useRef } from 'react'
import type { ChannelDisplay } from '../model/types'
import { POSITION_STEP, stepPosition, stepScale, type DisplayPatch } from '../model/view'
import { KEYS, TOOLS, TOOL_ORDER } from './keymap'
import type { ScopeActions } from './scopeCommands'
import type { Action } from './ui/action'

interface Shortcuts {
  /** Off while a modal dialog (export) is open */
  enabled: boolean
  paletteOpen: boolean
  togglePalette: () => void
  actions: ScopeActions
  selectedCallout?: string
  selectedDisplay?: ChannelDisplay
  adjust: (id: string, patch: DisplayPatch) => void
  editCallout: (id: string) => void
  deleteCallout: (id: string) => void
  /** Move a callout by one pixel */
  nudgeCallout: (id: string, dir: -1 | 1) => void
  /** Pan by a share of the view */
  pan: (share: number) => void
  /** Esc: back to the Pan tool, nothing selected */
  cancel: () => void
}

/** Where keys are typed or handled by their own component: no workspace shortcuts there */
const OWN_KEYS = 'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"]'

/** The single-key shortcuts of the actions (see KEYS), by `KeyboardEvent.key` in lower case */
function keyActions(a: ScopeActions): Record<string, Action> {
  const map: Record<string, Action> = {}
  for (const t of TOOL_ORDER) map[TOOLS[t].key.toLowerCase()] = a.tools[t]
  const single: [string, Action][] = [
    [KEYS.fullRecord, a.fullRecord],
    [KEYS.cursors, a.cursors],
    [KEYS.readout, a.readout],
    [KEYS.overview, a.overview],
    [KEYS.measurements, a.measurements],
    [KEYS.focus, a.focus],
    [KEYS.prevCallout, a.prevCallout],
    [KEYS.nextCallout, a.nextCallout],
    [KEYS.zoomIn, a.zoomIn],
    // + without Shift on most keyboards
    ['=', a.zoomIn],
    [KEYS.zoomOut, a.zoomOut],
  ]
  for (const [k, action] of single) map[k.toLowerCase()] = action
  return map
}

/** The keyboard shortcuts of the workspace (listed in keymap.ts and the help popover) */
export function useShortcuts(s: Shortcuts): void {
  const latest = useRef(s)
  useEffect(() => {
    latest.current = s
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = latest.current
      if (!s.enabled) return
      const a = s.actions
      const k = e.key.toLowerCase()
      // The command palette opens (and closes) from anywhere, text fields included
      if ((e.ctrlKey || e.metaKey) && (k === 'k' || (e.shiftKey && k === 'p'))) {
        e.preventDefault()
        s.togglePalette()
        return
      }
      if (s.paletteOpen || (e.target as Element | null)?.closest?.(OWN_KEYS)) return
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) {
        e.preventDefault()
        ;(k === 'y' || e.shiftKey ? a.redo : a.undo).run()
        return
      }
      if (e.ctrlKey || e.metaKey) return

      const selected = s.selectedCallout
      const d = s.selectedDisplay
      let run: (() => void) | undefined
      if (e.key === 'Escape') run = s.cancel
      else if (e.key === 'Delete') run = selected ? () => s.deleteCallout(selected) : undefined
      else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) run = a.back.run
      else if (e.altKey) return
      else if (e.shiftKey && selected && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) run = () => s.nudgeCallout(selected, e.key === 'ArrowLeft' ? -1 : 1)
      else if (e.key === 'Enter') run = selected ? () => s.editCallout(selected) : undefined
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && d) {
        // Position of the selected channel: a step, with Shift a whole division
        const step = (e.shiftKey ? 1 : POSITION_STEP) * (e.key === 'ArrowUp' ? 1 : -1)
        run = () => s.adjust(d.id, { position: stepPosition(d.position, step) })
      } else if ((e.key === 'PageUp' || e.key === 'PageDown') && d) {
        // V/div of the selected channel: Page Up makes the trace larger
        run = () => s.adjust(d.id, { scale: stepScale(d.scale, e.key === 'PageUp' ? -1 : 1) })
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') run = () => s.pan(e.key === 'ArrowLeft' ? -0.1 : 0.1)
      else {
        const action = keyActions(a)[k]
        // A shortcut of an action that is not available now does nothing (but is still taken)
        if (action) run = action.disabled ? () => {} : action.run
      }
      // Keys without a shortcut here keep their usual meaning (Enter on a button, …)
      if (!run) return
      e.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
