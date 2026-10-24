import { CALLOUT_COLORS } from '../model/callouts'
import { useTheme } from './ui/themeContext'

/**
 * The colour choice of a callout. The swatches show the colours as the callouts are drawn
 * (pale ones darkened in the light appearance). `keepFocus`: pressing a swatch leaves the focus
 * where it is (the inline editor keeps its text field).
 */
export function ColorSwatches({ value, onChange, keepFocus }: { value: string; onChange: (color: string) => void; keepFocus?: boolean }) {
  const { ink } = useTheme().theme
  return (
    <>
      {CALLOUT_COLORS.map((col, i) => (
        <button
          key={col}
          type="button"
          className={`swatch ${value === col ? 'active' : ''}`}
          style={{ background: ink(col) }}
          title="Colour"
          aria-label={`Colour ${i + 1}`}
          aria-pressed={value === col}
          onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
          onClick={() => onChange(col)}
        />
      ))}
    </>
  )
}
