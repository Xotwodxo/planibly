import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';

import { logDiagnostic } from '../diagnostics/logger';
import { Button } from './ui/Button';

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    void logDiagnostic('error', 'react.render_error', error, {
      componentStack: info.componentStack ?? undefined,
    });
  }

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="fatal-error" id="main-content">
          <div className="fatal-error__panel" role="alert">
            <span className="eyebrow">Something went wrong</span>
            <h1>Planibly needs a fresh start</h1>
            <p>
              The error was recorded only on this device. Reload the app to try again; your local
              database has not been cleared.
            </p>
            <Button onClick={() => window.location.reload()}>Reload Planibly</Button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
