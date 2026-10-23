import { createContext, useContext } from 'react'
import { DARK_THEME, type Appearance, type Theme } from '../../render/theme'

/** The user's choice: a fixed appearance, or the one of the operating system */
export type ThemePreference = Appearance | 'system'

export const THEME_PREFERENCES: ThemePreference[] = ['dark', 'light', 'system']
export const THEME_LABEL: Record<ThemePreference, string> = { dark: 'Dark', light: 'Light', system: 'Same as the system' }

/** Where the preference is remembered; public/theme-init.js reads it before the app loads */
export const THEME_KEY = 'scope-viewer:theme'

export interface ThemeState {
  preference: ThemePreference
  /** The appearance in effect */
  appearance: Appearance
  /** Colours for the canvases and SVG of that appearance */
  theme: Theme
  setPreference: (p: ThemePreference) => void
}

export const ThemeContext = createContext<ThemeState>({ preference: 'dark', appearance: 'dark', theme: DARK_THEME, setPreference: () => {} })

/** The appearance in effect and its colours */
export const useTheme = () => useContext(ThemeContext)

export function isThemePreference(v: unknown): v is ThemePreference {
  return THEME_PREFERENCES.includes(v as ThemePreference)
}

export function resolveAppearance(p: ThemePreference, systemDark: boolean): Appearance {
  return p === 'system' ? (systemDark ? 'dark' : 'light') : p
}
