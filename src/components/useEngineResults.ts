import { useState, useSyncExternalStore } from 'react'
import type { ComputeEngine } from '../compute/engine'
import { LastResults } from '../util/lastResults'

/** What a component needs of the compute engine to follow the measurements and spectra it asks for */
export type ResultSource = Pick<ComputeEngine, 'subscribeResults' | 'resultsVersion'>

/**
 * A number that changes when a measurement or spectrum arrives from the worker (or one that was waiting
 * had to be dropped and must be asked for again). The engine answers `measured` and `spectrum` with
 * undefined until the result is there, so whatever asks for them lists this number among its dependencies
 * and asks again when it changes.
 */
export function useEngineResults(engine: ResultSource): number {
  return useSyncExternalStore(engine.subscribeResults, engine.resultsVersion)
}

/**
 * The `keep` function of a `LastResults` that lives as long as the component: it takes the key of what is
 * shown and the result the engine has now, and gives back that result, or while it is not there yet the
 * last one seen for the key, with `pending` set (see util/lastResults.ts).
 */
export function useLastResults<T>(): LastResults<T>['keep'] {
  const [results] = useState(() => new LastResults<T>())
  return results.keep
}
