import { createContext, useContext } from 'react'

/** A question before something that cannot be undone */
export interface ConfirmOptions {
  title: string
  /** More detail below the title */
  message?: string
  /** The button that confirms, e.g. "Delete" */
  confirmLabel: string
  /** The action deletes or discards something */
  danger?: boolean
}

/** A short message above the channel bar */
export interface Notice {
  message: string
  /** Errors stay until they are dismissed */
  kind?: 'info' | 'error'
  /** A button in the notice, e.g. Undo */
  action?: { label: string; hint?: string; run: () => void }
  /** Milliseconds until it goes (default: 2.5 s for information, never for errors) */
  timeout?: number
}

export interface Feedback {
  /** Ask in a dialog; resolves to true when the user confirms */
  confirm: (o: ConfirmOptions) => Promise<boolean>
  /** Show a notice (it replaces an older one of the same kind); returns its id */
  notify: (n: Notice) => number
  dismiss: (id: number) => void
}

export const FeedbackContext = createContext<Feedback>({
  confirm: async (o) => window.confirm(o.message ? `${o.title}\n\n${o.message}` : o.title),
  notify: () => 0,
  dismiss: () => {},
})

/** Questions and notices of the app: one look for all of them instead of the browser's alert() / confirm() */
export const useFeedback = () => useContext(FeedbackContext)
