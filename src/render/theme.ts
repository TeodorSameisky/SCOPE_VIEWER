import { printColor, textOn } from './color'

/** Colour scheme of the app and of exported images */
export type Appearance = 'dark' | 'light'

/**
 * Colours of the plots, the composed export image around them and the callouts. The app draws
 * with the theme of its appearance; exports choose theirs. The CSS tokens in styles.css match.
 */
export interface Theme {
  bg: string
  grid: string
  /** Minor grid lines of the spectrum's log axis */
  gridMinor: string
  gridCenter: string
  axisText: string
  cursor: string
  /** Letter on the cursor A/B labels */
  cursorText: string
  trigger: string
  /** Dashed line at the trigger level */
  triggerLevel: string
  hover: string
  selection: string
  /** Rectangle of the visible window in the overview, and its edge */
  windowBox: string
  /** Overview: the record outside the visible window */
  shade: string
  overviewBg: string
  /** Text in the rubber band of a zoom or a new region */
  bandText: string

  /** Background of the export image around the plots */
  page: string
  /** Header and legend boxes */
  panel: string
  border: string
  text: string
  /** Legend entries of the spectrum caption */
  textDim: string
  muted: string
  readoutBg: string
  readoutBorder: string

  noteBox: string
  /** Label box of regions */
  labelBox: string
  noteText: string
  /** Text of a note without text of its own */
  notePlaceholder: string

  /** A channel or callout colour as drawn on `bg` */
  ink: (color: string) => string
  /** Text on a filled `ink` colour (channel badges, marker flags) */
  onInk: (fill: string) => string
}

/** The screen theme */
export const DARK_THEME: Theme = {
  bg: '#05070a',
  grid: 'rgba(160, 170, 185, 0.16)',
  gridMinor: 'rgba(160, 170, 185, 0.07)',
  gridCenter: 'rgba(160, 170, 185, 0.32)',
  axisText: '#8a94a3',
  cursor: '#e6e9ee',
  cursorText: '#000',
  trigger: '#ff9d2e',
  triggerLevel: 'rgba(255, 157, 46, 0.35)',
  hover: 'rgba(255,255,255,0.25)',
  selection: '#fff',
  windowBox: '#3fb6ff',
  shade: 'rgba(0, 0, 0, 0.55)',
  overviewBg: '#0a0d12',
  bandText: '#cfe6ff',

  page: '#0b0e13',
  panel: '#12161d',
  border: '#222934',
  text: '#d7dce4',
  textDim: '#b9c1cd',
  muted: '#7d8796',
  readoutBg: 'rgba(30, 36, 46, 0.9)',
  readoutBorder: '#3a4454',

  noteBox: 'rgba(12,15,20,0.92)',
  labelBox: 'rgba(12,15,20,0.9)',
  noteText: '#e8ecf2',
  notePlaceholder: '#8a94a3',

  ink: (color) => color,
  onInk: () => '#000',
}

const printCache = new Map<string, string>()

/** White background, grey grid, dark text; pale trace colours are darkened (see printColor) */
export const LIGHT_THEME: Theme = {
  bg: '#ffffff',
  grid: 'rgba(70, 80, 95, 0.3)',
  gridMinor: 'rgba(70, 80, 95, 0.12)',
  gridCenter: 'rgba(70, 80, 95, 0.6)',
  axisText: '#4a5361',
  cursor: '#2b3340',
  cursorText: '#fff',
  trigger: '#c4691a',
  triggerLevel: 'rgba(196, 105, 26, 0.5)',
  hover: 'rgba(0,0,0,0.25)',
  selection: '#000',
  windowBox: '#1673b8',
  shade: 'rgba(238, 241, 245, 0.7)',
  overviewBg: '#f6f7f9',
  bandText: '#164f80',

  page: '#ffffff',
  panel: '#f2f4f7',
  border: '#d9dee6',
  text: '#1d2430',
  textDim: '#3d4654',
  muted: '#5d6776',
  readoutBg: 'rgba(255, 255, 255, 0.92)',
  readoutBorder: '#b8c0cc',

  noteBox: 'rgba(255,255,255,0.92)',
  labelBox: 'rgba(255,255,255,0.9)',
  noteText: '#1d2430',
  notePlaceholder: '#5d6776',

  ink: (color) => {
    let c = printCache.get(color)
    if (c === undefined) printCache.set(color, (c = printColor(color)))
    return c
  },
  onInk: textOn,
}

export const THEMES: Record<Appearance, Theme> = { dark: DARK_THEME, light: LIGHT_THEME }
