import { useCallback, useRef, useState } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { useDismiss } from './useDismiss'

export interface MenuItem {
  label: string
  icon?: LucideIcon
  hint?: string
  disabled?: boolean
  /** Draw a separator line above this item */
  divider?: boolean
  onClick: () => void
}

/** Button that opens a small drop-down list of actions. */
export function Menu({ icon: Icon, label, items, align = 'right' }: { icon: LucideIcon; label: string; items: MenuItem[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  return (
    <div className="menu" ref={ref}>
      <button type="button" className={`icon-btn with-label ${open ? 'active' : ''}`} aria-haspopup="menu" aria-expanded={open} title={label} onClick={() => setOpen(!open)}>
        <Icon size={17} strokeWidth={1.8} aria-hidden />
        <span className="btn-label">{label}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className={`menu-list ${align}`} role="menu">
          {items.map((it) => (
            <div key={it.label} className="menu-entry">
              {it.divider && <div className="menu-divider" role="separator" />}
              <button
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false)
                  it.onClick()
                }}
              >
                {it.icon && <it.icon size={16} strokeWidth={1.8} aria-hidden />}
                <span>{it.label}</span>
                {it.hint && <small>{it.hint}</small>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
