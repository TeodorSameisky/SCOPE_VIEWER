import { createContext, useContext, useSyncExternalStore } from 'react'
import type { AnalysisStore } from '../model/analysisStore'
import type { Analysis } from '../model/workspace'

/**
 * The analysis store of the open session, for components that read or change the analysis
 * themselves instead of being handed every field and every setter as props. The store never
 * changes while a session is open (the workspace is remounted for another one), so the context
 * value is stable and does not re-render anything: components follow the analysis with `useAnalysis`.
 */
export const AnalysisContext = createContext<AnalysisStore | null>(null)

/** The store of the open session */
export function useAnalysisStore(): AnalysisStore {
  const store = useContext(AnalysisContext)
  if (!store) throw new Error('useAnalysisStore needs an AnalysisContext.Provider above it')
  return store
}

/** The current analysis of a store; the component renders again whenever it changes */
export function useStoreAnalysis(store: AnalysisStore): Analysis {
  return useSyncExternalStore(store.subscribe, store.get)
}

/** The current analysis of the open session */
export function useAnalysis(): Analysis {
  return useStoreAnalysis(useAnalysisStore())
}
