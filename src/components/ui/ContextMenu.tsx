import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { MenuContext, normalizeMenu, type MenuItem, type OpenMenu } from './menuContext'
import { useDismiss } from './useDismiss'

/** Text fields keep the browser's own menu (copy, paste, spelling) */
const NATIVE = 'input, textarea, select, [contenteditable="true"]'

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | '-')[]; id: number } | null>(null)
  const open = useCallback<OpenMenu>((e, entries) => {
    // The innermost element with a menu wins: containers skip an event that already opened one
    if ((e.nativeEvent ?? e).defaultPrevented) return
    if ((e.target as Element | null)?.closest?.(NATIVE)) return
    const items = normalizeMenu(entries)
    if (!items.some((it) => it !== '-' && it.kind !== 'heading')) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, items, id: performance.now() })
  }, [])
  const close = useCallback(() => setMenu(null), [])
  return (
    <MenuContext.Provider value={open}>
      {children}
      {menu && <ContextMenu key={menu.id} x={menu.x} y={menu.y} items={menu.items} onClose={close} />}
    </MenuContext.Provider>
  )
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: (MenuItem | '-')[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useDismiss(ref, true, onClose)

  // Keep the menu inside the window: open to the left / upwards when there is no room
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = x + r.width > window.innerWidth - 4 ? Math.max(4, x - r.width) : x
    const top = y + r.height > window.innerHeight - 4 ? Math.max(4, window.innerHeight - 4 - r.height) : y
    setPos({ left, top })
  }, [x, y])
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
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    if (!buttons.length) return
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const focus = (n: number) => buttons[(n + buttons.length) % buttons.length].focus()
    if (e.key === 'ArrowDown') focus(i + 1)
    else if (e.key === 'ArrowUp') focus(i < 0 ? -1 : i - 1)
    else if (e.key === 'Home') focus(0)
    else if (e.key === 'End') focus(-1)
    else if (e.key === 'Tab') return onClose()
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
              {it.color && <span className="dot" style={{ background: it.color }} />}
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
                    style={o.color ? { background: o.color } : undefined}
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
            {it.hint && <kbd>{it.hint}</kbd>}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
