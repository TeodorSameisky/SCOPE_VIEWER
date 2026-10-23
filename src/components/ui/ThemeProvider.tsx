import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react'
import { Moon, Sun, SunMoon } from 'lucide-react'
import { THEMES, type Appearance } from '../../render/theme'
import { usePersistentState } from '../../util/usePersistentState'
import { IconButton } from './IconButton'
import { THEME_KEY, THEME_LABEL, ThemeContext, isThemePreference, resolveAppearance, useTheme, type ThemePreference } from './themeContext'

const DARK_QUERY = '(prefers-color-scheme: dark)'
/** Window title bar of the installed app: the colour of the top bar (--chrome) */
const TITLE_BAR: Record<Appearance, string> = { dark: '#0f1318', light: '#f8f9fb' }

function subscribeSystem(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const systemIsDark = () => window.matchMedia(DARK_QUERY).matches

/**
 * Applies the chosen appearance to the page (`data-theme` on <html>, which switches the CSS
 * tokens) and gives the components its canvas colours. Dark unless the user chose otherwise.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [stored, setPreference] = usePersistentState<ThemePreference>(THEME_KEY, 'dark')
  const preference = isThemePreference(stored) ? stored : 'dark'
  const systemDark = useSyncExternalStore(subscribeSystem, systemIsDark)
  const appearance = resolveAppearance(preference, systemDark)

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = appearance
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', TITLE_BAR[appearance])
  }, [appearance])

  const value = useMemo(() => ({ preference, appearance, theme: THEMES[appearance], setPreference }), [preference, appearance, setPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

const NEXT: Record<ThemePreference, ThemePreference> = { dark: 'light', light: 'system', system: 'dark' }
const ICON = { dark: Moon, light: Sun, system: SunMoon }

/** Cycles dark → light → same as the system */
export function ThemeButton() {
  const { preference, setPreference } = useTheme()
  return (
    <IconButton
      icon={ICON[preference]}
      label={`Appearance: ${THEME_LABEL[preference]} – click for ${THEME_LABEL[NEXT[preference]].toLowerCase()}`}
      onClick={() => setPreference(NEXT[preference])}
    />
  )
}
