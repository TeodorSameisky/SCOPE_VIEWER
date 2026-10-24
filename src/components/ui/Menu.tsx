import { useState } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { useMenus, type MenuEntry } from './menuContext'

/** Toolbar button with a drop-down menu (the same menu as on right-click: keyboard, separators, notes). */
export function Menu({ icon: Icon, label, items, align = 'right' }: { icon: LucideIcon; label: string; items: MenuEntry[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const { openBelow, close } = useMenus()
  return (
    <button
      type="button"
      className={`icon-btn with-label ${open ? 'active' : ''}`}
      aria-haspopup="menu"
      aria-expanded={open}
      title={label}
      onClick={(e) => {
        if (open) return close()
        setOpen(true)
        openBelow(e.currentTarget, items, { align, onClose: () => setOpen(false) })
      }}
    >
      <Icon size={17} strokeWidth={1.8} aria-hidden />
      <span className="btn-label">{label}</span>
      <ChevronDown size={14} aria-hidden />
    </button>
  )
}
