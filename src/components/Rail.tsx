import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, CircleHelp, Info, Ruler, StickyNote } from 'lucide-react'
import { HELP_ROWS } from './keymap'
import type { ScopeActions } from './scopeCommands'
import { ActionButton, IconButton } from './ui/IconButton'
import { placeLeftOf } from './ui/placement'
import { ThemeButton } from './ui/ThemeProvider'
import { useDismiss } from './ui/useDismiss'

export type PanelId = 'cursors' | 'callouts' | 'info' | 'reference'

interface Props {
  panel: PanelId | null
  setPanel: (p: PanelId | null) => void
  /** Overview, measurements and focus mode */
  actions: Pick<ScopeActions, 'overview' | 'measurements' | 'focus'>
  calloutCount: number
}

/** Vertical icon bar on the right: opens side panels and shows/hides parts of the layout. */
export function Rail({ panel, setPanel, actions: a, calloutCount }: Props) {
  const toggle = (id: PanelId) => setPanel(panel === id ? null : id)
  return (
    <nav className="rail" aria-label="Panels">
      <IconButton icon={Ruler} label="Cursor readouts" active={panel === 'cursors'} onClick={() => toggle('cursors')} />
      <IconButton icon={StickyNote} label="Callouts" badge={calloutCount} active={panel === 'callouts'} onClick={() => toggle('callouts')} />
      <IconButton icon={Info} label="Session info & setup" active={panel === 'info'} onClick={() => toggle('info')} />
      <IconButton icon={BookOpen} label="Reference: measurements, math & spectrum" active={panel === 'reference'} onClick={() => toggle('reference')} />
      <div className="rail-sep" />
      <ActionButton action={a.overview} />
      <ActionButton action={a.measurements} />
      <ActionButton action={a.focus} />
      <div className="spacer" />
      <ThemeButton />
      <HelpButton />
    </nav>
  )
}

function HelpButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  // Left of the button and growing upwards from its bottom; in a window too short (or narrow)
  // for it, it gets as much room as there is and scrolls
  const [place, setPlace] = useState<React.CSSProperties>()
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const r = ref.current?.getBoundingClientRect()
      if (r) setPlace(placeLeftOf(r))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [open])
  return (
    <div className="help" ref={ref}>
      <IconButton icon={CircleHelp} label="Mouse & keyboard" active={open} onClick={() => setOpen(!open)} />
      {open && (
        <div className="popover help-popover" style={place}>
          <h4>Mouse &amp; keyboard</h4>
          <dl>
            {HELP_ROWS.map(([keys, v]) => (
              <div key={keys.join('|')}>
                <dt>
                  {keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="version mono">
            Scope Viewer {__APP_VERSION__} · built {new Date(__BUILD_TIME__).toLocaleString()}
            <br />
            MIT License ·{' '}
            <a href={`${import.meta.env.BASE_URL}third-party-licenses.txt`} target="_blank" rel="noreferrer">
              licenses
            </a>
          </p>
        </div>
      )}
    </div>
  )
}
