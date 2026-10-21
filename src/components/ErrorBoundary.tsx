import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Discard the saved state of the open file and show it with the file defaults */
  onReset?: () => void
  onClose: () => void
}

interface State {
  error: Error | null
}

/**
 * Catches errors while rendering the workspace, so a bug (or unexpected saved state) shows a
 * message with ways out instead of a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="landing">
        <div className="landing-card crash">
          <h2>
            <AlertTriangle size={20} aria-hidden /> Something went wrong
          </h2>
          <p>The session could not be shown. Your saved changes are still in this browser unless you choose to discard them.</p>
          <pre className="mono">{error.message}</pre>
          <div className="button-row">
            {this.props.onReset && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  this.setState({ error: null })
                  this.props.onReset?.()
                }}
              >
                Open without saved changes
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null })
                this.props.onClose()
              }}
            >
              Close session
            </button>
            <button type="button" className="text-btn" onClick={() => location.reload()}>
              Reload page
            </button>
          </div>
        </div>
      </div>
    )
  }
}
