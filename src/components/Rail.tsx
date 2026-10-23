import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, CircleHelp, Focus, GalleryHorizontal, Info, Ruler, StickyNote, Table2 } from 'lucide-react'
import { IconButton } from './ui/IconButton'
import { ThemeButton } from './ui/ThemeProvider'
import { useDismiss } from './ui/useDismiss'

export type PanelId = 'cursors' | 'callouts' | 'info' | 'reference'

interface Props {
  panel: PanelId | null
  setPanel: (p: PanelId | null) => void
  overview: boolean
  toggleOverview: () => void
  measurements: boolean
  toggleMeasurements: () => void
  focusMode: boolean
  toggleFocus: () => void
  calloutCount: number
}

/** Vertical icon bar on the right: opens side panels and shows/hides parts of the layout. */
export function Rail(p: Props) {
  const toggle = (id: PanelId) => p.setPanel(p.panel === id ? null : id)
  return (
    <nav className="rail" aria-label="Panels">
      <IconButton icon={Ruler} label="Cursor readouts" active={p.panel === 'cursors'} onClick={() => toggle('cursors')} />
      <IconButton icon={StickyNote} label="Callouts" badge={p.calloutCount} active={p.panel === 'callouts'} onClick={() => toggle('callouts')} />
      <IconButton icon={Info} label="Session info & setup" active={p.panel === 'info'} onClick={() => toggle('info')} />
      <IconButton icon={BookOpen} label="Reference: measurements, math & spectrum" active={p.panel === 'reference'} onClick={() => toggle('reference')} />
      <div className="rail-sep" />
      <IconButton icon={GalleryHorizontal} label="Overview strip" shortcut="O" active={p.overview} onClick={p.toggleOverview} />
      <IconButton icon={Table2} label="Measurements" shortcut="T" active={p.measurements} onClick={p.toggleMeasurements} />
      <IconButton icon={Focus} label="Focus: hide all panels" shortcut="\" active={p.focusMode} onClick={p.toggleFocus} />
      <div className="spacer" />
      <ThemeButton />
      <HelpButton />
    </nav>
  )
}

/** Keys or gestures (alternatives as separate chips) and what they do */
const SHORTCUTS: [string[], string][] = [
  [['Ctrl + K'], 'Command palette: find any command, channel, callout or measurement by name'],
  [['Wheel'], 'Zoom time around the pointer'],
  [['Shift + wheel'], 'Pan'],
  [['Right-click'], 'Commands for the point, trace, callout, channel or table cell under the pointer'],
  [['Drag'], 'Pan (Pan tool) / zoom rectangle (Zoom tool)'],
  [['Middle drag'], 'Pan with any tool'],
  [['Shift + drag', 'Drag on time axis'], 'Zoom to a time range'],
  [['Double-click'], 'Full record'],
  [['Click a trace'], 'Select channel'],
  [['Drag a channel tag'], 'Move the trace up or down (left edge of the plot; Alt: no snapping); drop it on another view to move it there'],
  [['Wheel on a tag', 'Wheel on the scale'], 'V/div of that channel'],
  [['↑  ↓', 'Page Up / Down'], 'Position / V/div of the selected channel (Shift + ↑ ↓: a whole division)'],
  [['Ctrl / Alt + wheel'], 'V/div / position of selected channel'],
  [['P  Z'], 'Pan / Zoom tool'],
  [['N  M  R  B  D'], 'Note / Marker / Region / Box / Span (Δt between two traces)'],
  [['C'], 'Cursors on/off'],
  [['V'], 'Values of all channels at the pointer on/off'],
  [['F'], 'Full record'],
  [['+  −  ←  →'], 'Zoom / pan'],
  [['Backspace'], 'Back to previous view'],
  [['Enter / Delete'], 'Edit / delete selected callout'],
  [[',  .'], 'Previous / next callout'],
  [['Shift + ←  →'], 'Move the selected callout by one pixel'],
  [['Alt'], 'Hold while placing or dragging a marker or region edge: no snapping to edges'],
  [['Ctrl + Z', 'Ctrl + Y'], 'Undo / redo changes (Ctrl + Shift + Z also redoes)'],
  [['O  T  \\'], 'Overview / measurements / focus mode'],
  [['Wheel', 'Drag'], 'In the spectrum: zoom / pan frequency (Ctrl + wheel: level)'],
  [['Esc'], 'Cancel, back to Pan'],
]

/** Gap between the help popover and the edges of the window (px) */
const EDGE = 8

function HelpButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  // Fixed to the window, left of the button and growing upwards from its bottom; in a window too
  // short (or narrow) for it, it gets as much room as there is and scrolls
  const [place, setPlace] = useState<React.CSSProperties>()
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const bottom = Math.max(EDGE, window.innerHeight - r.bottom)
      setPlace({
        position: 'fixed',
        right: window.innerWidth - r.left + EDGE,
        bottom,
        maxHeight: window.innerHeight - bottom - EDGE,
        maxWidth: Math.max(200, r.left - 2 * EDGE),
        overflowY: 'auto',
      })
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
            {SHORTCUTS.map(([keys, v]) => (
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
