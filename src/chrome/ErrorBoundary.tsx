import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Custom fallback UI. Receives the error and a `reset` that clears the
   *  boundary so the subtree re-mounts (e.g. after the user retries). */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Short label for console grouping. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time throws so one bad subtree — a pathological markdown
 * body, an unexpected IPC payload, a throwing Radix portal — can't white-screen
 * the whole app. Wrap the root (catch-all) and each SessionNode body (so one
 * broken conversation doesn't take the entire canvas down with it).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`,
      error,
      info.componentStack,
    );
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) {
      return this.props.fallback ? (
        this.props.fallback(error, this.reset)
      ) : (
        <RootFallback error={error} reset={this.reset} />
      );
    }
    return this.props.children;
  }
}

function RootFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
      <div className="font-mono text-sm text-danger">something went wrong</div>
      <p className="max-w-md font-mono text-xs leading-relaxed text-fg-muted">
        {error.message || "an unexpected error occurred"}
      </p>
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="rounded-md border border-border bg-bg-elevated px-3 py-1.5 font-mono text-xs text-fg-muted transition-colors hover:text-fg"
        >
          try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md border border-accent-from/40 bg-accent-from/10 px-3 py-1.5 font-mono text-xs text-accent-from transition-colors hover:bg-accent-from/20"
        >
          reload
        </button>
      </div>
    </div>
  );
}
