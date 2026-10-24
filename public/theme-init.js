// Sets the light appearance before the app and its styles load, so the page does not flash dark.
// The app (ThemeProvider) keeps it up to date afterwards. A file of its own, as the server's
// Content-Security-Policy does not allow inline scripts.
try {
  var preference = JSON.parse(localStorage.getItem('scope-viewer:theme') || '"dark"')
  // As in the app (resolveAppearance): "system" is dark only when the system asks for dark
  if (preference === 'light' || (preference === 'system' && !window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.dataset.theme = 'light'
  }
} catch {
  // storage unavailable: dark
}
