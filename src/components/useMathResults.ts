import { useEffect, useState } from 'react'
import type { ComputeEngine, MathState } from '../compute/engine'
import type { MathDef } from '../model/math'

const NONE: MathState = { defs: [], results: new Map(), pyramids: new Map() }

/**
 * The math channels as the engine computed them in its worker. Results arrive a little after the
 * definitions change; until then the previous ones are shown (`defs` tells which they are for).
 */
export function useMathResults(engine: ComputeEngine, defs: MathDef[]): MathState {
  const [state, setState] = useState(NONE)
  useEffect(() => engine.onMath(setState), [engine])
  useEffect(() => engine.setMath(defs), [engine, defs])
  return state
}
