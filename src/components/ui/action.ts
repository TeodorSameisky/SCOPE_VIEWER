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
  /** Keyboard shortcut (see keymap.ts) */
  hint?: string
  /** Longer explanation (tooltip) */
  title?: string
  disabled?: boolean
  /** A setting that is on */
  checked?: boolean
  run: () => void
}

/** The action as a context menu item (`over` adapts it to the menu, e.g. a shorter label) */
export function menuItem(a: Action, over: Partial<MenuAction> = {}): MenuAction {
  return { label: a.label, icon: a.icon, hint: a.hint, title: a.title, disabled: a.disabled, checked: a.checked, onClick: a.run, ...over }
}

/** The action as a command of the palette; left out while it is not available */
export function command(id: string, group: string, a: Action, over: Partial<Command> = {}): Command | false {
  return !a.disabled && { id, group, label: a.label, icon: a.icon, hint: a.hint, checked: a.checked, run: a.run, ...over }
}
