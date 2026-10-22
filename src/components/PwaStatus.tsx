import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, WifiOff, X } from 'lucide-react'

/** Check for a new version once an hour while the app stays open */
const UPDATE_CHECK_MS = 60 * 60 * 1000

/**
 * Service worker registration and its notices: "ready to work offline" after the first
 * install, and "new version available" when an update has been downloaded.
 */
export function PwaStatus() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => registration.update().catch(() => {}), UPDATE_CHECK_MS)
    },
  })

  // The offline notice is only informative: hide it after a few seconds
  useEffect(() => {
    if (!offlineReady) return
    const t = window.setTimeout(() => setOfflineReady(false), 6000)
    return () => window.clearTimeout(t)
  }, [offlineReady, setOfflineReady])

  if (needRefresh) {
    return (
      <div className="pwa-toast" role="status">
        <RefreshCw size={15} aria-hidden />
        <span>A new version of Scope Viewer is available. Your work is saved.</span>
        <button type="button" className="primary" onClick={() => updateServiceWorker(true)}>
          Reload
        </button>
        <button type="button" className="icon-btn" aria-label="Later" title="Later" onClick={() => setNeedRefresh(false)}>
          <X size={14} />
        </button>
      </div>
    )
  }
  if (offlineReady) {
    return (
      <div className="pwa-toast" role="status">
        <WifiOff size={15} aria-hidden />
        <span>Scope Viewer can now be used offline.</span>
        <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setOfflineReady(false)}>
          <X size={14} />
        </button>
      </div>
    )
  }
  return null
}
