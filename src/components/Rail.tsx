import { useCallback, useRef, useState } from 'react'
import { CircleHelp, Focus, GalleryHorizontal, Info, Ruler, StickyNote, Table2 } from 'lucide-react'
import { IconButton } from './ui/IconButton'
import { useDismiss } from './ui/useDismiss'

export type PanelId = 'cursors' | 'callouts' | 'info'

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
      <div className="rail-sep" />
      <IconButton icon={GalleryHorizontal} label="Overview strip" shortcut="O" active={p.overview} onClick={p.toggleOverview} />
      <IconButton icon={Table2} label="Measurements" shortcut="T" active={p.measurements} onClick={p.toggleMeasurements} />
      <IconButton icon={Focus} label="Focus: hide all panels" shortcut="\" active={p.focusMode} onClick={p.toggleFocus} />
      <div className="spacer" />
      <HelpButton />
    </nav>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Wheel', 'Zoom time around the pointer'],
  ['Shift + wheel', 'Pan'],
  ['Drag', 'Pan (Pan tool) / zoom rectangle (Zoom tool)'],
  ['Shift + drag, drag on time axis', 'Zoom to a time range'],
  ['Double-click', 'Full record'],
  ['Click a trace', 'Select channel'],
  ['Ctrl / Alt + wheel', 'V/div / position of selected channel'],
  ['P  Z', 'Pan / Zoom tool'],
  ['N  M  R', 'Note / Marker / Region'],
  ['C', 'Cursors on/off'],
  ['F', 'Full record'],
  ['+  −  ←  →', 'Zoom / pan'],
  ['Backspace', 'Back to previous view'],
  ['Enter / Delete', 'Edit / delete selected callout'],
  ['O  T  \\', 'Overview / measurements / focus mode'],
  ['Esc', 'Cancel, back to Pan'],
]

function HelpButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)
  return (
    <div className="help" ref={ref}>
      <IconButton icon={CircleHelp} label="Mouse & keyboard" active={open} onClick={() => setOpen(!open)} />
      {open && (
        <div className="popover help-popover">
          <h4>Mouse &amp; keyboard</h4>
          <dl>
            {SHORTCUTS.map(([k, v]) => (
              <div key={k}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}
