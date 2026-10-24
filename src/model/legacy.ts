/**
 * Analyses saved by versions before the workspace (callouts, math channels and spectra stored
 * separately per session file). They are read once, migrated into the workspace (see
 * loadWorkspace) and deleted when the workspace is saved. Can be removed together with
 * LEGACY_PREFIXES once no browser is expected to hold such data any more.
 */
import { sanitizeCallouts, type Callout } from './callouts'
import type { MathDef } from './math'
import { parseStoredSpectra, type SpectrumDef, type SpectrumOptions } from './spectrum'
import type { ChannelDisplay } from './types'

/** Keys of the old stores (followed by the session fingerprint) */
export const LEGACY_PREFIXES = ['scope-viewer:callouts:', 'scope-viewer:math:', 'scope-viewer:spectra:']
const [CALLOUTS, MATH, SPECTRA] = LEGACY_PREFIXES

interface StoredMath {
  def: MathDef
  display: Omit<ChannelDisplay, 'id'>
  /** Index of the view it was shown in */
  view: number
}

export interface LegacyAnalysis {
  callouts: Callout[]
  math: StoredMath[]
  spectra: SpectrumDef[]
  spectrumOptions: SpectrumOptions
}

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** What an earlier version stored for a session file, or undefined when there is nothing */
export function loadLegacy(fingerprint: string): LegacyAnalysis | undefined {
  const callouts = sanitizeCallouts(read(CALLOUTS + fingerprint))
  const rawMath = read(MATH + fingerprint)
  const math = (Array.isArray(rawMath) ? rawMath : []).filter(
    (m): m is StoredMath =>
      m && typeof m.def?.id === 'string' && /^MATH\d+$/.test(m.def.id) && typeof m.def.expr === 'string' && typeof m.display === 'object' && typeof m.view === 'number',
  )
  const spectra = parseStoredSpectra(read(SPECTRA + fingerprint))
  if (!callouts.length && !math.length && !spectra.defs.length) return undefined
  return { callouts, math, spectra: spectra.defs, spectrumOptions: spectra.options }
}
