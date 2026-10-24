import { createContext, useContext } from 'react'
import type { LucideIcon } from 'lucide-react'

/** A command in a context menu */
export interface MenuAction {
  kind?: 'action'
  label: string
  icon?: LucideIcon
  /** Keyboard shortcut shown on the right */
  hint?: string
  /** Short description shown on the right instead (e.g. the file types of an Open command) */
  note?: string
  disabled?: boolean
  danger?: boolean
  /** Shown with a check mark (toggle that is on) */
  checked?: boolean
  title?: string
  onClick: () => void
}

/** Section title, e.g. the channel or time the following commands refer to */
export interface MenuHeading {
  kind: 'heading'
  label: string
  color?: string
  /** Secondary text on the right (value, scale) */
  detail?: string
}

/** A row of small buttons: options (with `checked`), colour swatches (with `color`) or related commands */
export interface MenuChoices {
  kind: 'choices'
  label: string
  options: { label: string; title?: string; color?: string; checked?: boolean; disabled?: boolean; onClick: () => void }[]
}

export type MenuItem = MenuAction | MenuHeading | MenuChoices
/** '-' is a separator; false/null/undefined entries are skipped, so items can be added conditionally */
export type MenuEntry = MenuItem | '-' | false | null | undefined | 0 | ''

export type MenuPointer = Pick<MouseEvent, 'clientX' | 'clientY' | 'target' | 'preventDefault'> & { nativeEvent?: Event; defaultPrevented?: boolean }
export type OpenMenu = (e: MenuPointer, entries: MenuEntry[]) => void

export interface DropdownOptions {
  /** Which edge of the menu lines up with the button */
  align?: 'left' | 'right'
  /** Called when the menu closes, however it closes */
  onClose?: () => void
}

/** One menu at a time: right-click menus and the drop-down menus of the toolbar look and work the same */
export interface Menus {
  /** Open a context menu at the pointer of a `contextmenu` event */
  open: OpenMenu
  /** Open a drop-down menu below a button */
  openBelow: (button: HTMLElement, entries: MenuEntry[], o?: DropdownOptions) => void
  close: () => void
}

export const MenuContext = createContext<Menus>({ open: () => {}, openBelow: () => {}, close: () => {} })

/** Opens a context menu at the pointer of a `contextmenu` event */
export const useContextMenu = () => useContext(MenuContext).open
export const useMenus = () => useContext(MenuContext)

/** Drop skipped entries, and separators at the start, at the end or next to each other */
export function normalizeMenu(entries: MenuEntry[]): (MenuItem | '-')[] {
  const out: (MenuItem | '-')[] = []
  for (const e of entries) {
    if (!e) continue
    if (e === '-' && (out.length === 0 || out[out.length - 1] === '-')) continue
    out.push(e)
  }
  while (out[out.length - 1] === '-') out.pop()
  return out
}
