import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UpdatePrompt } from './components/UpdatePrompt';
import { initializeDatabase } from './data/database';
import { logDiagnostic } from './diagnostics/logger';
import './styles/index.css';

void initializeDatabase().catch((error: unknown) => {
  void logDiagnostic('error', 'database.initialization_failed', error);
});

window.addEventListener('unhandledrejection', (event) => {
  void logDiagnostic('error', 'window.unhandled_rejection', event.reason);
});

window.addEventListener('error', (event) => {
  void logDiagnostic('error', 'window.uncaught_error', event.error ?? event.message);
});

const rootElement = document.querySelector<HTMLElement>('#root');

if (!rootElement) {
  throw new Error('Planibly could not find its root element.');
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
        <UpdatePrompt />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
