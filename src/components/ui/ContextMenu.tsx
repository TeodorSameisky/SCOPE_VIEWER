import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { MenuContext, normalizeMenu, type DropdownOptions, type MenuItem, type Menus, type OpenMenu } from './menuContext'
import { fitInWindow } from './placement'
import { useDismiss } from './useDismiss'
import { useTheme } from './themeContext'

/** Text fields keep the browser's own menu (copy, paste, spelling) */
const NATIVE = 'input, textarea, select, [contenteditable="true"]'

interface Open {
  x: number
  y: number
  items: (MenuItem | '-')[]
  id: number
  /** Drop-down: aligned with the button that opened it (x is its left or right edge) */
  align?: 'left' | 'right'
  button?: HTMLElement
  onClose?: () => void
}

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState<Open | null>(null)
  const current = useRef<Open | null>(null)
  const show = useCallback((m: Open | null) => {
    // The menu that was open is closed first (its button learns that it closed)
    if (current.current !== m) current.current?.onClose?.()
    current.current = m
    setMenu(m)
  }, [])
  const close = useCallback(() => show(null), [show])
  const open = useCallback<OpenMenu>(
    (e, entries) => {
      // The innermost element with a menu wins: containers skip an event that already opened one
      if ((e.nativeEvent ?? e).defaultPrevented) return
      if ((e.target as Element | null)?.closest?.(NATIVE)) return
      const items = normalizeMenu(entries)
      if (!items.some((it) => it !== '-' && it.kind !== 'heading')) return
      e.preventDefault()
      show({ x: e.clientX, y: e.clientY, items, id: performance.now() })
    },
    [show],
  )
  const openBelow = useCallback(
    (button: HTMLElement, entries: Parameters<OpenMenu>[1], o: DropdownOptions = {}) => {
      const r = button.getBoundingClientRect()
      const align = o.align ?? 'left'
      show({ x: align === 'left' ? r.left : r.right, y: r.bottom + 6, items: normalizeMenu(entries), id: performance.now(), align, button, onClose: o.onClose })
    },
    [show],
  )
  const value = useMemo<Menus>(() => ({ open, openBelow, close }), [open, openBelow, close])
  return (
    <MenuContext.Provider value={value}>
      {children}
      {menu && <ContextMenu key={menu.id} menu={menu} onClose={close} />}
    </MenuContext.Provider>
  )
}

function ContextMenu({ menu, onClose }: { menu: Open; onClose: () => void }) {
  const { x, y, items, align, button } = menu
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const { ink } = useTheme().theme
  // A press on the button of a drop-down is left to the button (it closes the menu)
  useDismiss(ref, true, onClose, button)

  // Keep the menu inside the window: open to the left / upwards when there is no room
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const fit = fitInWindow(align === 'right' ? x - r.width : x, y, r.width, r.height)
    setPos({ left: Math.max(4, fit.left), top: fit.top })
  }, [x, y, align])
  // The menu takes the keyboard once it is placed (a hidden element cannot be focused)
  useEffect(() => {
    if (pos) ref.current?.focus({ preventScroll: true })
  }, [pos])

  useEffect(() => {
    const close = () => onClose()
    const wheel = (e: WheelEvent) => !ref.current?.contains(e.target as Node) && onClose()
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('wheel', wheel, { capture: true, passive: true })
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('wheel', wheel, { capture: true })
    }
  }, [onClose])

  const run = (fn: () => void) => {
    onClose()
    fn()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The menu has the keyboard: no workspace shortcuts while it is open
    e.stopPropagation()
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      onClose()
      button?.focus()
      return
    }
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    if (!buttons.length) return
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const focus = (n: number) => buttons[(n + buttons.length) % buttons.length].focus()
    if (e.key === 'ArrowDown') focus(i + 1)
    else if (e.key === 'ArrowUp') focus(i < 0 ? -1 : i - 1)
    else if (e.key === 'Home') focus(0)
    else if (e.key === 'End') focus(-1)
    else return
    e.preventDefault()
  }

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      tabIndex={-1}
      style={pos ?? { left: x, top: y, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => {
        if (it === '-') return <div key={i} className="menu-divider" role="separator" />
        if (it.kind === 'heading') {
          return (
            <div key={i} className="cm-heading">
              {it.color && <span className="dot" style={{ background: ink(it.color) }} />}
              <span className="cm-heading-label">{it.label}</span>
              {it.detail && <small className="mono">{it.detail}</small>}
            </div>
          )
        }
        if (it.kind === 'choices') {
          return (
            <div key={i} className="cm-choices" role="group" aria-label={it.label}>
              <span className="cm-choices-label">{it.label}</span>
              <span className="cm-options">
                {it.options.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    role={o.checked === undefined ? 'menuitem' : 'menuitemradio'}
                    aria-checked={o.checked}
                    aria-label={o.title ?? o.label}
                    title={o.title ?? o.label}
                    disabled={o.disabled}
                    className={`${o.checked ? 'active' : ''} ${o.color ? 'swatch' : ''}`}
                    // Colours as drawn in the plot (pale ones darkened in the light appearance)
                    style={o.color ? { background: ink(o.color) } : undefined}
                    onPointerMove={(e) => e.currentTarget.focus({ preventScroll: true })}
                    onClick={() => run(o.onClick)}
                  >
                    {!o.color && o.label}
                  </button>
                ))}
              </span>
            </div>
          )
        }
        const Icon = it.checked ? Check : it.icon
        return (
          <button
            key={i}
            type="button"
            role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={it.checked}
            className={`cm-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            title={it.title}
            onPointerMove={(e) => e.currentTarget.focus({ preventScroll: true })}
            onClick={() => run(it.onClick)}
          >
            <span className="cm-icon">{Icon && <Icon size={15} strokeWidth={1.8} aria-hidden />}</span>
            <span className="cm-label">{it.label}</span>
            {it.note && <small className="cm-note">{it.note}</small>}
            {it.hint && <kbd>{it.hint}</kbd>}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
