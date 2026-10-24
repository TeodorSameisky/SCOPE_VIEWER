/**
 * Fonts of everything drawn on canvases and in SVG (plots, callouts, exported images). The
 * families are the same as the CSS ones (`font-family` of :root and `--mono` in styles.css), so
 * text on the plots matches the panels around them on every system.
 */

export const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
export const MONO = "'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace"

/** A CSS font shorthand, e.g. font(12, SANS, 600) → "600 12px system-ui, …" */
export function font(size: number, family: string = SANS, weight?: number): string {
  return `${weight ? `${weight} ` : ''}${size}px ${family}`
}

/** Axis labels, channel tags and readouts on the plots */
export const PLOT_FONT = font(11, MONO)
