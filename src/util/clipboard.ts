/**
 * Copy text to the clipboard. The Clipboard API needs a secure context (HTTPS or localhost);
 * over plain HTTP the older copy command is used. Resolves to false when neither works.
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the copy command (e.g. permission denied)
    }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  const focused = document.activeElement as HTMLElement | null
  ta.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    ta.remove()
    focused?.focus?.({ preventScroll: true })
  }
}
