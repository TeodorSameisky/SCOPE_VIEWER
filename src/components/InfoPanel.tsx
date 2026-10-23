import { useMemo, useState } from 'react'
import type { Session } from '../model/types'
import { si } from '../util/format'
import { triggerText } from '../util/names'

export function InfoPanel({ session, storage }: { session: Session; storage?: React.ReactNode }) {
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
      </dl>

      {shotUrl && (
        <>
          <h4>Instrument screenshot</h4>
          <img className="screenshot" src={shotUrl} alt="Scope screen at time of saving" onClick={() => setZoomShot(true)} />
          {zoomShot && (
            <div className="modal" onClick={() => setZoomShot(false)}>
              <img src={shotUrl} alt="Scope screen at time of saving" />
            </div>
          )}
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
