import type { LucideIcon } from 'lucide-react'

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
  onClick: () => void
}

export function IconButton({ icon: Icon, label, shortcut, active, disabled, showLabel, className = '', badge, onClick }: Props) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? 'active' : ''} ${showLabel ? 'with-label' : ''} ${className}`}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={17} strokeWidth={1.8} aria-hidden />
      {showLabel && <span className="btn-label">{label}</span>}
      {!!badge && <span className="icon-badge">{badge}</span>}
    </button>
  )
}
