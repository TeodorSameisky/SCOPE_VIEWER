import { useSyncExternalStore } from 'react'

/**
 * "Install app": Chromium browsers fire `beforeinstallprompt` once the app is installable.
 * The event is kept here (from page load on, before React renders) so an Install button
 * can show the browser's install dialog later.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export function listenForInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep the browser's own mini-infobar from showing; we offer our own button
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

/** True when the app runs installed (in its own window) */
export function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

export async function installApp(): Promise<boolean> {
  if (!deferred) return false
  const e = deferred
  await e.prompt()
  const { outcome } = await e.userChoice
  // The event can only be used once
  deferred = null
  notify()
  return outcome === 'accepted'
}

/** Whether the browser currently offers installation */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => deferred !== null,
  )
}
