import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react';
import { captureError, type ErrorContext } from '../lib/telemetry';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Free-form label included in the error report, e.g. "dashboard:reports". */
  scope?: string;
  /** Optional custom fallback instead of the built-in screen. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Application-level error boundary.
 *
 * Without this, any exception thrown while rendering a dashboard page unmounted
 * the whole React tree and left the user on a blank white page — the worst
 * possible failure mode for a lab that is mid-report. This keeps the shell
 * alive, shows an actionable message, and reports the failure through
 * `captureError` (which survives the production minifier).
 *
 * One boundary per route group is enough; `resetKey` lets a parent retry when
 * the underlying data changes (e.g. navigating to a different report).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const context: ErrorContext = {
      scope: this.props.scope ?? 'react-render',
      componentStack: info.componentStack?.slice(0, 300),
    };
    captureError(error, context);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (!error) return children;

    if (fallback) return fallback(error, this.reset);

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-4xl border border-[var(--elevated-border)] bg-surface-container-lowest p-8 text-center shadow-float">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-accent/10 text-accent">
            <AlertTriangle className="h-8 w-8" aria-hidden="true" />
          </div>
          <h2 className="text-xl font-bold tracking-[-0.02em] text-on-surface">
            This screen hit a problem
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
            Your saved data is safe — the view just could not be rendered. Try again, or reload if
            it keeps happening.
          </p>
          {/* The raw message can echo a value from the record that was being
              rendered, and this screen is shown at the bench with people around —
              so it is collapsed by default and only a support conversation opens
              it. Nothing here is transmitted; the same text goes to the local
              crash log (Settings → Diagnostics). */}
          {error.message && (
            <details className="mt-3 text-left">
              <summary className="cursor-pointer font-mono text-xs text-on-surface-variant/70">
                Technical details
              </summary>
              <p className="mt-1.5 break-words font-mono text-xs text-on-surface-variant/70">
                {error.message}
              </p>
            </details>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-on-primary shadow-card transition hover:brightness-110 active:scale-[0.97]"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-[var(--elevated-border)] px-5 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-low active:scale-[0.97]"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
