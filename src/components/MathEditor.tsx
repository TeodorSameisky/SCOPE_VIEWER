import { useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, Check, Trash2 } from 'lucide-react'
import { checkSyntax, parse, references, type MathResult } from '../math/expr'
import { MATH_PRESETS, type MathDef } from '../model/math'
import { channelName } from '../util/names'

interface Props {
  def: MathDef
  result?: MathResult
  /** Channels that can be used as operands (inputs and other math channels) */
  sources: string[]
  onChange: (patch: Partial<MathDef>) => void
  onRemove: () => void
  onOpenReference: () => void
}

/** Expression editor of a math channel, shown in its channel popover. */
export function MathEditor({ def, result, sources, onChange, onRemove, onOpenReference }: Props) {
  const [draft, setDraft] = useState(def.expr)
  const operands = sources.filter((s) => s !== def.id)
  const known = useMemo(() => new Set(operands.map((s) => s.toUpperCase())), [operands])

  // Pre-select A/B from the channels the expression already uses
  const used = useMemo(() => {
    try {
      return [...references(parse(def.expr))].filter((r) => known.has(r))
    } catch {
      return []
    }
  }, [def.expr, known])
  const [a, setA] = useState(used[0] ?? operands[0] ?? '')
  const [b, setB] = useState(used[1] ?? operands.find((s) => s !== a) ?? operands[0] ?? '')

  const syntax = checkSyntax(draft, known)
  const dirty = draft.trim() !== def.expr
  const apply = (expr = draft) => {
    const e = expr.trim()
    if (!e || checkSyntax(e, known).error || e === def.expr) return
    onChange({ expr: e })
  }

  const error = dirty ? syntax.error : result?.error
  return (
    <div className="math-editor">
      <label className="field-label" htmlFor={`expr-${def.id}`}>
        Expression
      </label>
      <div className="expr-row">
        <input
          id={`expr-${def.id}`}
          className={`mono expr ${error ? 'invalid' : ''}`}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          placeholder="e.g. CH1 - CH2"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply()
            if (e.key === 'Escape' && dirty) {
              e.stopPropagation()
              setDraft(def.expr)
            }
          }}
          onBlur={() => apply()}
        />
        <button type="button" className="icon-btn" title="Apply (Enter)" aria-label="Apply expression" disabled={!dirty || !!syntax.error} onClick={() => apply()}>
          <Check size={16} />
        </button>
      </div>
      {error ? (
        <div className="expr-msg error" role="alert">
          <AlertTriangle size={13} aria-hidden /> {error}
        </div>
      ) : (
        <div className="expr-msg">{dirty ? 'Press Enter to apply' : `Unit: ${result?.derivedUnit || 'none'}`}</div>
      )}

      <div className="field-label">Quick operations</div>
      <div className="operands">
        <label>
          A
          <select value={a} onChange={(e) => setA(e.target.value)}>
            {operands.map((s) => (
              <option key={s} value={s}>
                {channelName(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          B
          <select value={b} onChange={(e) => setB(e.target.value)}>
            {operands.map((s) => (
              <option key={s} value={s}>
                {channelName(s)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="presets">
        {MATH_PRESETS.map((pr) => (
          <button
            key={pr.label}
            type="button"
            title={pr.title}
            onClick={() => {
              const expr = pr.build(a, b)
              setDraft(expr)
              apply(expr)
            }}
          >
            {pr.label}
          </button>
        ))}
      </div>

      <div className="math-foot">
        <label className="unit-field">
          Unit
          <input value={def.unit ?? ''} placeholder={result?.derivedUnit || 'auto'} onChange={(e) => onChange({ unit: e.target.value || undefined })} />
        </label>
        <span className="spacer" />
        <button type="button" className="text-btn" onClick={onOpenReference}>
          <BookOpen size={13} aria-hidden /> Functions
        </button>
        <button type="button" className="text-btn danger" onClick={onRemove}>
          <Trash2 size={13} aria-hidden /> Delete
        </button>
      </div>
    </div>
  )
}
