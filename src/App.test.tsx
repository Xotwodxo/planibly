import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { App } from './App';

describe('application shell', () => {
  it('renders the Phase 0 home and all primary destinations', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Make room for what matters.' })).toBeVisible();
    const primaryNavigation = screen.getAllByRole('navigation', { name: 'Primary navigation' });
    expect(primaryNavigation).toHaveLength(2);
    for (const name of ['Home', 'Plan', 'Calendar', 'Lists', 'Insights']) {
      expect(screen.getAllByRole('link', { name })).toHaveLength(2);
    }
  });

  it('navigates to a shell destination without adding product behavior', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    await user.click(screen.getAllByRole('link', { name: 'Calendar' })[0]!);
    expect(screen.getByRole('heading', { name: 'See the shape of your days' })).toBeVisible();
    expect(screen.getByText('Outside Phase 0')).toBeVisible();
  });
});
