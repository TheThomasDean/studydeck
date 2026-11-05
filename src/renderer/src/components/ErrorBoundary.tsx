import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

/** Last line of defence: show a readable message instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('StudyDeck crashed:', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="fatal">
        <h1>Something went wrong</h1>
        <p>StudyDeck hit an unexpected error. Your saved sets are safe on disk.</p>
        <pre>{this.state.error.message}</pre>
        <button className="btn primary" onClick={() => location.reload()}>
          Reload StudyDeck
        </button>
      </div>
    )
  }
}
