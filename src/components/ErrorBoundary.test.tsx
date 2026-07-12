import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

function BrokenComponent(): never {
  throw new Error('Expected render failure');
}

describe('ErrorBoundary', () => {
  it('shows a recoverable, local-only error state', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Planibly needs a fresh start');
    expect(screen.getByRole('button', { name: 'Reload Planibly' })).toBeVisible();
  });
});
