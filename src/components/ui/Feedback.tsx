import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { FeedbackContext, type ConfirmOptions, type Feedback, type Notice } from './feedbackContext'
import { useDismiss } from './useDismiss'

type Shown = Notice & { id: number }

/** What a notice replaces: a newer one of the same kind (plain, with a button, error) */
const kindOf = (n: Notice) => (n.action ? 'action' : (n.kind ?? 'info'))

/** Notices and confirmation dialogs for everything below it (see useFeedback) */
export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [notices, setNotices] = useState<Shown[]>([])
  const [ask, setAsk] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setNotices((ns) => ns.filter((n) => n.id !== id)), [])
  const notify = useCallback(
    (n: Notice) => {
      const id = nextId.current++
      setNotices((ns) => [...ns.filter((x) => kindOf(x) !== kindOf(n)), { ...n, id }])
      const timeout = n.timeout ?? (n.kind === 'error' ? undefined : 2500)
      if (timeout) window.setTimeout(() => dismiss(id), timeout)
      return id
    },
    [dismiss],
  )
  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        setAsk((prev) => {
          prev?.resolve(false)
          return { ...o, resolve }
        }),
      ),
    [],
  )
  const answer = useCallback(
    (ok: boolean) => {
      ask?.resolve(ok)
      setAsk(null)
    },
    [ask],
  )

  const value = useMemo<Feedback>(() => ({ confirm, notify, dismiss }), [confirm, notify, dismiss])
  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="toast-stack">
        {notices.map((n) => (
          <div key={n.id} className={`toast ${n.kind === 'error' ? 'error' : ''} ${n.action || n.kind === 'error' ? '' : 'plain'}`} role={n.kind === 'error' ? 'alert' : 'status'}>
            <span>{n.message}</span>
            {n.action && (
              <button
                type="button"
                className="text-btn"
                onClick={() => {
                  dismiss(n.id)
                  n.action!.run()
                }}
              >
                {n.action.label} {n.action.hint && <kbd>{n.action.hint}</kbd>}
              </button>
            )}
            {(n.action || n.kind === 'error') && (
              <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(n.id)}>
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      {ask && <ConfirmDialog options={ask} onAnswer={answer} />}
    </FeedbackContext.Provider>
  )
}

function ConfirmDialog({ options: o, onAnswer }: { options: ConfirmOptions; onAnswer: (ok: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  const cancel = useCallback(() => onAnswer(false), [onAnswer])
  // Esc or a click outside cancels, Enter confirms (the confirm button has the focus)
  useDismiss(ref, true, cancel)
  return (
    <div className="modal-backdrop">
      <div className="dialog confirm" ref={ref} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={o.message ? `${id}-m` : undefined}>
        <div className="confirm-body">
          <h3 id={`${id}-t`}>{o.title}</h3>
          {o.message && <p id={`${id}-m`}>{o.message}</p>}
        </div>
        <div className="dialog-foot">
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className={o.danger ? 'primary danger' : 'primary'} autoFocus onClick={() => onAnswer(true)}>
            {o.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
