import { useCallback, useMemo, useRef, useState } from 'react'
import { inputItems } from '../model/input'
import type { Channel, Session } from '../model/types'
import { si } from '../util/format'
import { channelName, triggerText } from '../util/names'
import { useTheme } from './ui/themeContext'
import { useDismiss } from './ui/useDismiss'

/** `channels`: the input channels with their current settings (colour, label), not those of the file */
export function InfoPanel({ session, channels, storage }: { session: Session; channels: Channel[]; storage?: React.ReactNode }) {
  const [filter, setFilter] = useState('')
  const [zoomShot, setZoomShot] = useState(false)
  const shotUrl = session.screenshot ? screenshotUrl(session.screenshot) : undefined

  const first = session.channels[0]?.wave
  const setupRows = useMemo(() => {
    if (!session.setup) return []
    const f = filter.trim().toUpperCase()
    return Object.entries(session.setup)
      .filter(([k, v]) => !f || k.includes(f) || v.toUpperCase().includes(f))
  }, [session.setup, filter])

  return (
    <div className="panel-body">
      {storage}
      <h4>File</h4>
      <dl className="info-list">
        <dt>File</dt>
        <dd>{session.fileName}</dd>
        <dt>Format</dt>
        <dd>{session.format}</dd>
        {first && (
          <>
            <dt>Record length</dt>
            <dd className="mono">{first.data.length.toLocaleString()} pts</dd>
            <dt>Sample interval</dt>
            <dd className="mono">
              {si(first.dt, 's')} ({si(1 / first.dt, 'S/s')})
            </dd>
            <dt>Record</dt>
            <dd className="mono">
              {si(first.t0, 's')} … {si(first.t0 + (first.data.length - 1) * first.dt, 's')}
            </dd>
          </>
        )}
        {session.horizontal && (
          <>
            <dt>Horizontal</dt>
            <dd className="mono">
              {si(session.horizontal.scale, 's/div')}, pos {session.horizontal.position}%
            </dd>
          </>
        )}
        {session.trigger && (
          <>
            <dt>Trigger</dt>
            <dd className="mono">{triggerText(session, 4)}</dd>
          </>
        )}
        {session.warnings?.length ? (
          <>
            <dt>Not read</dt>
            <dd>
              {session.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </dd>
          </>
        ) : null}
      </dl>

      <ChannelInputs channels={channels} />

      {shotUrl && (
        <>
          <h4>Instrument screenshot</h4>
          <img className="screenshot" src={shotUrl} alt="Scope screen at time of saving" onClick={() => setZoomShot(true)} />
          {zoomShot && <ScreenshotModal url={shotUrl} onClose={() => setZoomShot(false)} />}
        </>
      )}

      {session.setup && (
        <>
          <h4>
            Instrument setup (
            {filter.trim() ? `${setupRows.length} of ${Object.keys(session.setup).length}` : Object.keys(session.setup).length} settings)
          </h4>
          <input className="search" placeholder="Filter, e.g. CH2 or TRIGGER" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="setup-list mono">
            {setupRows.map(([k, v]) => (
              <div key={k}>
                <span className="k">{k}</span> <span className="v">{v}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** How each channel was connected and set on the scope: one column per setting any channel has */
function ChannelInputs({ channels }: { channels: Channel[] }) {
  const { ink } = useTheme().theme
  const rows = channels.flatMap((c) => (c.input ? [{ c, items: new Map(inputItems(c.input).map((it) => [it.label, it.value])) }] : []))
  if (!rows.length) return null
  // In the order of inputItems, only settings at least one channel has
  const columns = [...new Set(rows.flatMap((r) => [...r.items.keys()]))]
  return (
    <>
      <h4>Channel inputs</h4>
      <div className="table-scroll">
        <table className="data-table compact">
          <thead>
            <tr>
              <th>Channel</th>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, items }) => (
              <tr key={c.wave.id}>
                <td title={c.display.label || undefined}>
                  <span className="dot" style={{ background: ink(c.display.color) }} />
                  {channelName(c.wave.id)}
                </td>
                {columns.map((col) => (
                  <td key={col} className="mono">
                    {items.get(col) ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">As set on the scope when the session was saved. The setup names the settings of a probe, not the probe itself.</p>
    </>
  )
}

/** The screenshot over the whole window: a click or Esc closes it, as the other dialogs */
function ScreenshotModal({ url, onClose }: { url: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => onClose(), [onClose])
  useDismiss(ref, true, close)
  return (
    <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label="Instrument screenshot" onClick={close}>
      <img src={url} alt="Scope screen at time of saving" />
    </div>
  )
}

// One object URL per screenshot for the lifetime of the page: the panel mounts and unmounts
// often, and revoking on unmount would break the image when it remounts (e.g. StrictMode).
const urls = new WeakMap<Blob, string>()
function screenshotUrl(blob: Blob): string {
  let url = urls.get(blob)
  if (!url) {
    url = URL.createObjectURL(blob)
    urls.set(blob, url)
  }
  return url
}
