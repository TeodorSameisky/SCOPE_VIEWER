import type { Waveform } from '../model/types'
import { butterworth, derivative, integral, movingAverage, movingRms, resample } from './signal'

/**
 * Small expression language for math channels, e.g.
 *   CH1 - CH2        CH3 * CH4        deriv(lowpass(CH2, 1M))        (CH1 + CH2) / 2
 * Numbers accept SI suffixes (p n u µ m k M G): 10k = 10000, 2.5m = 0.0025.
 */

// ---------- syntax tree ----------

export type Node =
  | { type: 'num'; value: number; pos: number }
  | { type: 'var'; name: string; pos: number }
  | { type: 'neg'; arg: Node; pos: number }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node; pos: number }
  | { type: 'call'; fn: string; args: Node[]; pos: number }

export class ExprError extends Error {
  pos: number
  constructor(message: string, pos: number) {
    super(message)
    this.pos = pos
  }
}

interface Token {
  kind: 'num' | 'id' | 'op' | 'lp' | 'rp' | 'comma' | 'end'
  text: string
  value?: number
  pos: number
}

const SI: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?([pnuµmkKMG](?![A-Za-z0-9_]))?/.exec(src.slice(i))
    if (num) {
      const value = parseFloat(num[1] + (num[2] ?? '')) * (num[3] ? SI[num[3]] : 1)
      tokens.push({ kind: 'num', text: num[0], value, pos: i })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (id) {
      tokens.push({ kind: 'id', text: id[0], pos: i })
      i += id[0].length
      continue
    }
    if ('+-*/^×÷−'.includes(c)) {
      const op = c === '×' ? '*' : c === '÷' ? '/' : c === '−' ? '-' : c
      tokens.push({ kind: 'op', text: op, pos: i++ })
      continue
    }
    if (c === '(') tokens.push({ kind: 'lp', text: c, pos: i++ })
    else if (c === ')') tokens.push({ kind: 'rp', text: c, pos: i++ })
    else if (c === ',') tokens.push({ kind: 'comma', text: c, pos: i++ })
    else throw new ExprError(`Unexpected character "${c}"`, i)
  }
  tokens.push({ kind: 'end', text: '', pos: src.length })
  return tokens
}

export function parse(src: string): Node {
  const tokens = tokenize(src)
  let k = 0
  const peek = () => tokens[k]
  const next = () => tokens[k++]
  const expect = (kind: Token['kind'], what: string) => {
    const t = next()
    if (t.kind !== kind) throw new ExprError(`Expected ${what}`, t.pos)
    return t
  }

  // expr := term (('+'|'-') term)*
  const expr = (): Node => {
    let left = term()
    while (peek().kind === 'op' && (peek().text === '+' || peek().text === '-')) {
      const t = next()
      left = { type: 'bin', op: t.text as '+' | '-', left, right: term(), pos: t.pos }
    }
    return left
  }
  // term := unary (('*'|'/') unary)*
  const term = (): Node => {
    let left = unary()
    while (peek().kind === 'op' && (peek().text === '*' || peek().text === '/')) {
      const t = next()
      left = { type: 'bin', op: t.text as '*' | '/', left, right: unary(), pos: t.pos }
    }
    return left
  }
  // unary := ('-'|'+') unary | power
  const unary = (): Node => {
    if (peek().kind === 'op' && (peek().text === '-' || peek().text === '+')) {
      const t = next()
      const arg = unary()
      return t.text === '-' ? { type: 'neg', arg, pos: t.pos } : arg
    }
    return power()
  }
  // power := primary ('^' unary)?   (right associative)
  const power = (): Node => {
    const base = primary()
    if (peek().kind === 'op' && peek().text === '^') {
      const t = next()
      return { type: 'bin', op: '^', left: base, right: unary(), pos: t.pos }
    }
    return base
  }
  const primary = (): Node => {
    const t = next()
    if (t.kind === 'num') return { type: 'num', value: t.value!, pos: t.pos }
    if (t.kind === 'lp') {
      const e = expr()
      expect('rp', '")"')
      return e
    }
    if (t.kind === 'id') {
      if (peek().kind === 'lp') {
        next()
        const args: Node[] = []
        if (peek().kind !== 'rp') {
          args.push(expr())
          while (peek().kind === 'comma') {
            next()
            args.push(expr())
          }
        }
        expect('rp', '")"')
        return { type: 'call', fn: t.text.toLowerCase(), args, pos: t.pos }
      }
      return { type: 'var', name: t.text.toUpperCase(), pos: t.pos }
    }
    if (t.kind === 'end') throw new ExprError('Unexpected end of expression', t.pos)
    throw new ExprError(`Unexpected "${t.text}"`, t.pos)
  }

  const root = expr()
  if (peek().kind !== 'end') throw new ExprError(`Unexpected "${peek().text}"`, peek().pos)
  return root
}

/** Channel names referenced by an expression (upper case) */
export function references(node: Node, out = new Set<string>()): Set<string> {
  if (node.type === 'var') out.add(node.name)
  else if (node.type === 'neg') references(node.arg, out)
  else if (node.type === 'bin') {
    references(node.left, out)
    references(node.right, out)
  } else if (node.type === 'call') node.args.forEach((a) => references(a, out))
  return out
}

// ---------- values and units ----------

interface Sig {
  kind: 'sig'
  data: Float32Array
  t0: number
  dt: number
  unit: string
}
interface Scalar {
  kind: 'num'
  value: number
  unit: string
}
type Value = Sig | Scalar

function unitMul(a: string, b: string): string {
  if (!a) return b
  if (!b) return a
  if (a === b) return `${a}²`
  if ((a === 'V' && b === 'A') || (a === 'A' && b === 'V')) return 'W'
  return `${a}·${b}`
}
function unitDiv(a: string, b: string): string {
  if (!b) return a
  if (a === b) return ''
  if (a === 'W' && (b === 'V' || b === 'A')) return b === 'V' ? 'A' : 'V'
  if (a === 'V' && b === 'A') return 'Ω'
  return a ? `${a}/${b}` : `1/${b}`
}

// ---------- functions ----------

interface FnCtx {
  pos: number
  args: Value[]
}

export interface FunctionDoc {
  name: string
  signature: string
  description: string
  example: string
}

type FnImpl = (c: FnCtx) => Value

const needSig = (v: Value, fn: string, pos: number): Sig => {
  if (v.kind !== 'sig') throw new ExprError(`${fn}() needs a channel as first argument`, pos)
  return v
}
const needNum = (v: Value | undefined, fn: string, what: string, pos: number): number => {
  if (!v || v.kind !== 'num') throw new ExprError(`${fn}() needs ${what} as a number`, pos)
  return v.value
}
const arity = (c: FnCtx, fn: string, n: number) => {
  if (c.args.length !== n) throw new ExprError(`${fn}() takes ${n} argument${n > 1 ? 's' : ''}`, c.pos)
}

/** Element-wise function on scalars and signals */
const pointwise =
  (fn: string, f: (x: number) => number, unit: (u: string) => string): FnImpl =>
  (c) => {
    arity(c, fn, 1)
    const a = c.args[0]
    if (a.kind === 'num') return { kind: 'num', value: f(a.value), unit: unit(a.unit) }
    const data = new Float32Array(a.data.length)
    for (let i = 0; i < data.length; i++) data[i] = f(a.data[i])
    return { ...a, data, unit: unit(a.unit) }
  }

const same = (u: string) => u
const none = () => ''

const FUNCTIONS: Record<string, { impl: FnImpl; doc: FunctionDoc }> = {
  abs: {
    impl: pointwise('abs', Math.abs, same),
    doc: { name: 'abs', signature: 'abs(x)', description: 'Absolute value.', example: 'abs(CH3)' },
  },
  sqrt: {
    impl: pointwise('sqrt', Math.sqrt, (u) => (u.endsWith('²') ? u.slice(0, -1) : u ? `√${u}` : '')),
    doc: { name: 'sqrt', signature: 'sqrt(x)', description: 'Square root.', example: 'sqrt(CH1^2 + CH2^2)' },
  },
  exp: {
    impl: pointwise('exp', Math.exp, none),
    doc: { name: 'exp', signature: 'exp(x)', description: 'Exponential eˣ.', example: 'exp(-t / 1m)' },
  },
  ln: {
    impl: pointwise('ln', Math.log, none),
    doc: { name: 'ln', signature: 'ln(x)', description: 'Natural logarithm.', example: 'ln(CH1)' },
  },
  log10: {
    impl: pointwise('log10', Math.log10, none),
    doc: { name: 'log10', signature: 'log10(x)', description: 'Base-10 logarithm, e.g. for dB.', example: '20 * log10(CH2 / CH1)' },
  },
  sin: {
    impl: pointwise('sin', Math.sin, none),
    doc: { name: 'sin', signature: 'sin(x)', description: 'Sine (radians).', example: 'sin(2 * pi * 50 * t)' },
  },
  cos: {
    impl: pointwise('cos', Math.cos, none),
    doc: { name: 'cos', signature: 'cos(x)', description: 'Cosine (radians).', example: 'cos(2 * pi * 50 * t)' },
  },
  min: {
    impl: (c) => {
      arity(c, 'min', 2)
      return binary('min', c.args[0], c.args[1], c.pos)
    },
    doc: { name: 'min', signature: 'min(a, b)', description: 'Smaller of two values, sample by sample.', example: 'min(CH1, CH2)' },
  },
  max: {
    impl: (c) => {
      arity(c, 'max', 2)
      return binary('max', c.args[0], c.args[1], c.pos)
    },
    doc: { name: 'max', signature: 'max(a, b)', description: 'Larger of two values, sample by sample.', example: 'max(CH1, 0)' },
  },
  deriv: {
    impl: (c) => {
      arity(c, 'deriv', 1)
      const a = needSig(c.args[0], 'deriv', c.pos)
      return { ...a, data: derivative(a.data, a.dt), unit: a.unit ? `${a.unit}/s` : '1/s' }
    },
    doc: {
      name: 'deriv',
      signature: 'deriv(x)',
      description: 'Time derivative dx/dt (central difference). Amplifies noise; combine with lowpass().',
      example: 'deriv(lowpass(CH2, 1M))',
    },
  },
  integ: {
    impl: (c) => {
      arity(c, 'integ', 1)
      const a = needSig(c.args[0], 'integ', c.pos)
      return { ...a, data: integral(a.data, a.dt), unit: a.unit ? (a.unit === 'W' ? 'J' : `${a.unit}·s`) : 's' }
    },
    doc: {
      name: 'integ',
      signature: 'integ(x)',
      description: 'Running integral ∫x dt from the start of the record (trapezoidal). Power → energy.',
      example: 'integ(CH1 * CH2)',
    },
  },
  avg: {
    impl: (c) => {
      arity(c, 'avg', 2)
      const a = needSig(c.args[0], 'avg', c.pos)
      const win = needNum(c.args[1], 'avg', 'the window length in seconds', c.pos)
      if (!(win > 0)) throw new ExprError('avg() window must be > 0', c.pos)
      return { ...a, data: movingAverage(a.data, Math.max(1, Math.round(win / a.dt))) }
    },
    doc: { name: 'avg', signature: 'avg(x, window)', description: 'Moving average over a time window in seconds (centred).', example: 'avg(CH3, 10u)' },
  },
  rms: {
    impl: (c) => {
      arity(c, 'rms', 2)
      const a = needSig(c.args[0], 'rms', c.pos)
      const win = needNum(c.args[1], 'rms', 'the window length in seconds', c.pos)
      if (!(win > 0)) throw new ExprError('rms() window must be > 0', c.pos)
      return { ...a, data: movingRms(a.data, Math.max(1, Math.round(win / a.dt))) }
    },
    doc: { name: 'rms', signature: 'rms(x, window)', description: 'Moving RMS over a time window in seconds, e.g. one mains period.', example: 'rms(CH1, 20m)' },
  },
  lowpass: {
    impl: (c) => filter(c, 'lowpass', 'low'),
    doc: {
      name: 'lowpass',
      signature: 'lowpass(x, fc)',
      description: 'Low-pass filter with cut-off fc in Hz (Butterworth, applied forward and backward: no time shift).',
      example: 'lowpass(CH5, 100k)',
    },
  },
  highpass: {
    impl: (c) => filter(c, 'highpass', 'high'),
    doc: {
      name: 'highpass',
      signature: 'highpass(x, fc)',
      description: 'High-pass filter with cut-off fc in Hz (removes DC and slow drift; zero phase).',
      example: 'highpass(CH1, 1k)',
    },
  },
  delay: {
    impl: (c) => {
      arity(c, 'delay', 2)
      const a = needSig(c.args[0], 'delay', c.pos)
      const d = needNum(c.args[1], 'delay', 'the delay in seconds', c.pos)
      return { ...a, t0: a.t0 + d }
    },
    doc: { name: 'delay', signature: 'delay(x, seconds)', description: 'Shift a signal in time (positive = later), e.g. to deskew probes.', example: 'CH1 - delay(CH2, 15n)' },
  },
}

function filter(c: FnCtx, fn: string, type: 'low' | 'high'): Value {
  arity(c, fn, 2)
  const a = needSig(c.args[0], fn, c.pos)
  const fc = needNum(c.args[1], fn, 'the cut-off frequency in Hz', c.pos)
  const fs = 1 / a.dt
  if (!(fc > 0 && fc < fs / 2)) throw new ExprError(`${fn}() cut-off must be between 0 and ${(fs / 2).toExponential(2)} Hz (half the sample rate)`, c.pos)
  return { ...a, data: butterworth(a.data, fs, fc, type) }
}

export const FUNCTION_DOCS: FunctionDoc[] = Object.values(FUNCTIONS).map((f) => f.doc)

export const OPERATOR_DOCS: { op: string; description: string }[] = [
  { op: '+  −', description: 'Add, subtract' },
  { op: '*  /', description: 'Multiply, divide (V × A gives W)' },
  { op: '^', description: 'Power, e.g. CH1^2' },
  { op: '( )', description: 'Grouping' },
  { op: 't', description: 'Time of each sample (s, trigger = 0)' },
  { op: 'pi  e', description: 'Constants' },
  { op: '10k 2.5m 100u', description: 'SI suffixes p n u m k M G (M = mega, m = milli)' },
]

// ---------- evaluation ----------

function binary(op: '+' | '-' | '*' | '/' | '^' | 'min' | 'max', a: Value, b: Value, pos: number): Value {
  const f: (x: number, y: number) => number =
    op === '+'
      ? (x, y) => x + y
      : op === '-'
        ? (x, y) => x - y
        : op === '*'
          ? (x, y) => x * y
          : op === '/'
            ? (x, y) => x / y
            : op === '^'
              ? Math.pow
              : op === 'min'
                ? Math.min
                : Math.max
  const unit =
    op === '*'
      ? unitMul(a.unit, b.unit)
      : op === '/'
        ? unitDiv(a.unit, b.unit)
        : op === '^'
          ? b.kind === 'num' && b.value === 2 && a.unit
            ? `${a.unit}²`
            : ''
          : a.unit || b.unit
  if (a.kind === 'num' && b.kind === 'num') return { kind: 'num', value: f(a.value, b.value), unit }
  if (a.kind === 'sig' && b.kind === 'num') {
    const data = new Float32Array(a.data.length)
    for (let i = 0; i < data.length; i++) data[i] = f(a.data[i], b.value)
    return { ...a, data, unit }
  }
  if (a.kind === 'num' && b.kind === 'sig') {
    const data = new Float32Array(b.data.length)
    for (let i = 0; i < data.length; i++) data[i] = f(a.value, b.data[i])
    return { ...b, data, unit }
  }
  const sa = a as Sig
  let sb = b as Sig
  // Different time bases: interpolate the right operand onto the left one
  if (sa.t0 !== sb.t0 || sa.dt !== sb.dt || sa.data.length !== sb.data.length) {
    sb = { ...sb, data: resample(sb.data, sb.t0, sb.dt, sa.data.length, sa.t0, sa.dt), t0: sa.t0, dt: sa.dt }
  }
  void pos
  const data = new Float32Array(sa.data.length)
  for (let i = 0; i < data.length; i++) data[i] = f(sa.data[i], sb.data[i])
  return { ...sa, data, unit }
}

function evaluate(node: Node, env: Map<string, Waveform>, timeBase: Waveform): Value {
  switch (node.type) {
    case 'num':
      return { kind: 'num', value: node.value, unit: '' }
    case 'var': {
      if (node.name === 'PI') return { kind: 'num', value: Math.PI, unit: '' }
      if (node.name === 'E') return { kind: 'num', value: Math.E, unit: '' }
      if (node.name === 'T') {
        const data = new Float32Array(timeBase.data.length)
        for (let i = 0; i < data.length; i++) data[i] = timeBase.t0 + i * timeBase.dt
        return { kind: 'sig', data, t0: timeBase.t0, dt: timeBase.dt, unit: 's' }
      }
      const w = env.get(node.name)
      if (!w) throw new ExprError(`Unknown channel "${node.name}"`, node.pos)
      return { kind: 'sig', data: w.data, t0: w.t0, dt: w.dt, unit: w.yUnit }
    }
    case 'neg': {
      const a = evaluate(node.arg, env, timeBase)
      return binary('*', a, { kind: 'num', value: -1, unit: '' }, node.pos)
    }
    case 'bin':
      return binary(node.op, evaluate(node.left, env, timeBase), evaluate(node.right, env, timeBase), node.pos)
    case 'call': {
      const f = FUNCTIONS[node.fn]
      if (!f) throw new ExprError(`Unknown function "${node.fn}()"`, node.pos)
      return f.impl({ pos: node.pos, args: node.args.map((a) => evaluate(a, env, timeBase)) })
    }
  }
}

export interface MathInput {
  id: string
  expr: string
  /** Overrides the derived unit */
  unit?: string
}

export interface MathResult {
  wave?: Waveform
  /** Unit derived from the expression */
  derivedUnit?: string
  error?: string
  errorPos?: number
}

/**
 * Evaluate all math channels. They may reference input channels and each other;
 * evaluation follows the dependencies and reports cycles as errors.
 */
export function evaluateMath(defs: MathInput[], sources: Waveform[]): Map<string, MathResult> {
  const results = new Map<string, MathResult>()
  const env = new Map(sources.map((w) => [w.id.toUpperCase(), w]))
  const byId = new Map(defs.map((d) => [d.id.toUpperCase(), d]))
  const visiting = new Set<string>()

  const run = (id: string): MathResult => {
    const done = results.get(id)
    if (done) return done
    const def = byId.get(id)!
    if (visiting.has(id)) return { error: `Circular reference involving ${id}` }
    visiting.add(id)
    let result: MathResult
    try {
      const ast = parse(def.expr)
      for (const ref of references(ast)) {
        if (byId.has(ref) && !env.has(ref)) {
          const dep = run(ref)
          if (dep.wave) env.set(ref, dep.wave)
          else throw new ExprError(`${ref} has an error`, 0)
        }
      }
      const firstRef = [...references(ast)].map((r) => env.get(r)).find(Boolean)
      const timeBase = firstRef ?? sources[0]
      if (!timeBase) throw new ExprError('No channel to take the time base from', 0)
      let v = evaluate(ast, env, timeBase)
      if (v.kind === 'num') {
        // constant expression: a flat line on the time base of the record
        v = { kind: 'sig', data: new Float32Array(timeBase.data.length).fill(v.value), t0: timeBase.t0, dt: timeBase.dt, unit: v.unit }
      }
      const unit = def.unit?.trim() || v.unit
      result = { wave: { id: def.id, data: v.data, t0: v.t0, dt: v.dt, yUnit: unit, xUnit: 's' }, derivedUnit: v.unit }
    } catch (e) {
      result = e instanceof ExprError ? { error: e.message, errorPos: e.pos } : { error: e instanceof Error ? e.message : String(e) }
    }
    visiting.delete(id)
    results.set(id, result)
    if (result.wave) env.set(id, result.wave)
    return result
  }

  for (const d of defs) run(d.id.toUpperCase())
  // Return keyed by the original ids
  return new Map(defs.map((d) => [d.id, results.get(d.id.toUpperCase())!]))
}

/** Syntax check without evaluating (for live feedback while typing) */
export function checkSyntax(src: string, known: Set<string>): { error?: string; pos?: number } {
  try {
    const ast = parse(src)
    for (const ref of references(ast)) {
      if (!known.has(ref) && ref !== 'T' && ref !== 'PI' && ref !== 'E') return { error: `Unknown channel "${ref}"` }
    }
    const checkCalls = (n: Node): string | undefined => {
      if (n.type === 'call') {
        if (!FUNCTIONS[n.fn]) return `Unknown function "${n.fn}()"`
        for (const a of n.args) {
          const e = checkCalls(a)
          if (e) return e
        }
      } else if (n.type === 'bin') return checkCalls(n.left) ?? checkCalls(n.right)
      else if (n.type === 'neg') return checkCalls(n.arg)
      return undefined
    }
    const fnErr = checkCalls(ast)
    return fnErr ? { error: fnErr } : {}
  } catch (e) {
    return e instanceof ExprError ? { error: e.message, pos: e.pos } : { error: String(e) }
  }
}
