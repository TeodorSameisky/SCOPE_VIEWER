import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { rememberCommand, searchCommands, type Command } from './ui/commandSearch'
import { useDismiss } from './ui/useDismiss'
import { useTheme } from './ui/themeContext'

interface Props {
  /** The commands, read once when the palette opens (it is modal: nothing changes meanwhile) */
  getCommands: () => Command[]
  onClose: () => void
}

/** Rows moved by Page Up / Page Down */
const PAGE = 8

// Recently run commands. Written directly: the palette closes (unmounts) as a command runs.
const RECENT_KEY = 'scope-viewer:recent-commands'

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // storage unavailable: not remembered
  }
}

/**
 * Ctrl+K: search every command of the workspace by name – tools, views, panels, channels,
 * callouts, measurements, files, exports, the appearance – and run it with Enter.
 */
export function CommandPalette({ getCommands, onClose }: Props) {
  const [commands] = useState(getCommands)
  const [query, setQuery] = useState('')
  const [recent] = useState(readRecent)
  const results = useMemo(() => searchCommands(commands, query, recent), [commands, query, recent])
  const [active, setActive] = useState(0)
  const index = Math.max(0, Math.min(active, results.length - 1))
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const { ink } = useTheme().theme
  useDismiss(ref, true, onClose)

  // The chosen row stays in view while moving with the keyboard
  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = (c: Command) => {
    onClose()
    saveRecent(rememberCommand(recent, c.id))
    c.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const move = (to: number) => setActive(Math.max(0, Math.min(results.length - 1, to)))
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) move(index + 1 >= results.length ? 0 : index + 1)
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) move(index - 1 < 0 ? results.length - 1 : index - 1)
    else if (e.key === 'PageDown') move(index + PAGE)
    else if (e.key === 'PageUp') move(index - PAGE)
    else if (e.key === 'Enter' && results[index]) run(results[index])
    else return
    e.preventDefault()
  }

  return (
    <div className="palette-backdrop">
      <div className="palette" ref={ref} role="dialog" aria-modal="true" aria-label="Command palette">
        <label className="palette-input">
          <Search size={16} aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results.length ? `palette-cmd-${index}` : undefined}
            value={query}
            spellCheck={false}
            autoComplete="off"
            placeholder="Search commands, channels, callouts, measurements…"
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
          />
          <kbd>Esc</kbd>
        </label>
        <ul id="palette-list" className="palette-list" role="listbox" aria-label="Commands" ref={listRef}>
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`palette-cmd-${i}`}
              role="option"
              aria-selected={i === index}
              aria-checked={c.checked}
              className={i === index ? 'active' : undefined}
              onMouseMove={() => i !== index && setActive(i)}
              onClick={() => run(c)}
            >
              <span className="cmd-icon">
                {c.checked ? <Check size={15} aria-hidden /> : c.icon ? <c.icon size={15} strokeWidth={1.8} aria-hidden /> : c.color ? <span className="dot" style={{ background: ink(c.color) }} /> : null}
              </span>
              <span className="cmd-label">{c.label}</span>
              <span className="cmd-group">{c.group}</span>
              {c.hint && <kbd>{c.hint}</kbd>}
            </li>
          ))}
        </ul>
        {!results.length && <div className="palette-empty">No command matches “{query.trim()}”</div>}
        <div className="palette-foot">↑ ↓ choose · Enter run · Esc close</div>
      </div>
    </div>
  )
}
