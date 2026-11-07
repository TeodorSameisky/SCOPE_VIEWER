import type { LucideIcon } from 'lucide-react'
import type { Command } from './commandSearch'
import type { MenuAction } from './menuContext'

/**
 * A command of the workspace, defined once and offered by the toolbar (ActionButton), the menus
 * (menuItem), the command palette (command) and the keyboard, so all of them have the same
 * label, icon, shortcut and state.
 */
export interface Action {
  label: string
  icon?: LucideIcon
  /**
   * Keyboard shortcut (see keymap.ts). A single character ("F", "+", ",") is also bound: pressing that
   * key runs the action (see `shortcutMap`). Longer ones ("Ctrl+Z", "Backspace") are only shown.
   */
  hint?: string
  /** Longer explanation (tooltip) */
  title?: string
  disabled?: boolean
  /** A setting that is on */
  checked?: boolean
  /** Its toolbar button leaves the focus where it is (e.g. in a text field) */
  keepFocus?: boolean
  /** The entry it has in the command palette; without it the palette does not list it */
  palette?: PaletteInfo
  run: () => void
}

/** How an action appears in the command palette: its own id and group, and what differs from the action's label */
export interface PaletteInfo {
  /** Stable id, remembered for "recently used": "view:full" */
  id: string
  /** Section, shown next to the label and searched: "View" */
  group: string
  /** Where the label of the action does not suit a list of commands ("Focus mode: hide all panels") */
  label?: string
  /** More words the command is found by */
  keywords?: string
}

/** Every action of a catalogue: its own members, and those of members that are records of actions (the tools, the exports) */
export function actionsOf(catalogue: object): Action[] {
  const isAction = (v: unknown): v is Action => typeof (v as Action | undefined)?.run === 'function'
  return Object.values(catalogue).flatMap((v): Action[] => (isAction(v) ? [v] : v && typeof v === 'object' ? Object.values(v).filter(isAction) : []))
}

/** The actions with a one-character shortcut, by that key in lower case, as `KeyboardEvent.key` gives it */
export function shortcutMap(actions: Action[]): Record<string, Action> {
  const map: Record<string, Action> = {}
  for (const a of actions) if (a.hint?.length === 1) map[a.hint.toLowerCase()] = a
  return map
}

/**
 * The palette commands of the actions that have palette info, in their order; only the group `group`
 * when it is given. An action that is not available (disabled) is left out, as `command` does.
 */
export function paletteEntries(actions: Action[], group?: string): Command[] {
  return actions.flatMap((a) => {
    const p = a.palette
    if (!p || (group !== undefined && p.group !== group)) return []
    const entry = command(p.id, p.group, a, { ...(p.label ? { label: p.label } : {}), ...(p.keywords ? { keywords: p.keywords } : {}) })
    return entry ? [entry] : []
  })
}

/** The action as a context menu item (`over` adapts it to the menu, e.g. a shorter label) */
export function menuItem(a: Action, over: Partial<MenuAction> = {}): MenuAction {
  return { label: a.label, icon: a.icon, hint: a.hint, title: a.title, disabled: a.disabled, checked: a.checked, onClick: a.run, ...over }
}

/** The action as a command of the palette; left out while it is not available */
export function command(id: string, group: string, a: Action, over: Partial<Command> = {}): Command | false {
  return !a.disabled && { id, group, label: a.label, icon: a.icon, hint: a.hint, checked: a.checked, run: a.run, ...over }
}
