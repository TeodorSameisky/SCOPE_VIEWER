import type { LucideIcon } from 'lucide-react'
import type { Action } from './action'

interface Props {
  icon: LucideIcon
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  /** Show the text label next to the icon (hidden on narrow screens via CSS) */
  showLabel?: boolean
  className?: string
  badge?: number
  /** Pressing it leaves the focus where it is */
  keepFocus?: boolean
  onClick: () => void
}

export function IconButton({ icon: Icon, label, shortcut, active, disabled, showLabel, className = '', badge, keepFocus, onClick }: Props) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? 'active' : ''} ${showLabel ? 'with-label' : ''} ${className}`}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
      onClick={onClick}
    >
      <Icon size={17} strokeWidth={1.8} aria-hidden />
      {showLabel && <span className="btn-label">{label}</span>}
      {!!badge && <span className="icon-badge">{badge}</span>}
    </button>
  )
}

/** A toolbar button for an action (it needs an icon) */
export function ActionButton({ action: a, showLabel }: { action: Action; showLabel?: boolean }) {
  return (
    <IconButton
      icon={a.icon!}
      label={a.label}
      shortcut={a.hint}
      active={a.checked}
      disabled={a.disabled}
      showLabel={showLabel}
      keepFocus={a.keepFocus}
      onClick={a.run}
    />
  )
}
