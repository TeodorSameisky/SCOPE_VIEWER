/**
 * Colours of the page around the app: its background (--bg in styles.css, also the inline style
 * in index.html) and the top bar (--chrome), which the installed app uses for its title bar.
 * A module without imports, so vite.config.ts can use it too; a test checks that
 * styles.css and index.html agree with it.
 */
export const PAGE_COLORS: Record<'dark' | 'light', { background: string; chrome: string }> = {
  dark: { background: '#0b0e13', chrome: '#0f1318' },
  light: { background: '#eef1f5', chrome: '#f8f9fb' },
}
