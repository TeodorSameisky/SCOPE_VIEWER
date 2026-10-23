import { describe, expect, it } from 'vitest'
import { isThemePreference, resolveAppearance } from './themeContext'

describe('theme preference', () => {
  it('follows the system only when asked to', () => {
    expect(resolveAppearance('system', true)).toBe('dark')
    expect(resolveAppearance('system', false)).toBe('light')
    expect(resolveAppearance('dark', false)).toBe('dark')
    expect(resolveAppearance('light', true)).toBe('light')
  })

  it('rejects stored values it does not know', () => {
    expect(isThemePreference('light')).toBe(true)
    expect(isThemePreference('sepia')).toBe(false)
    expect(isThemePreference(null)).toBe(false)
  })
})
