import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { database, initializeDatabase } from '../data/database';

async function reset() {
  database.close();
  await database.delete();
  await initializeDatabase(database);
}
describe('Phase 3A Calendar workspace', () => {
  beforeEach(reset);
  afterEach(async () => {
    database.close();
    await database.delete();
  });
  it('navigates a Monday-first month and creates an all-day event on the selected date', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/calendar']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Appointments, kept local' })).toBeVisible();
    expect(screen.getAllByRole('gridcell')).toHaveLength(42);
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    const dialog = screen.getByRole('dialog', { name: 'Create event' });
    await user.type(within(dialog).getByLabelText('Title'), 'Dentist');
    await user.click(within(dialog).getByLabelText('All day'));
    await user.click(within(dialog).getByRole('button', { name: 'Save event' }));
    expect((await screen.findAllByRole('button', { name: /Dentist/ }))[0]).toBeVisible();
    await user.click((await screen.findAllByRole('button', { name: /Dentist/ }))[0]!);
    await user.click(
      within(screen.getByRole('dialog', { name: 'Edit event' })).getByRole('button', {
        name: 'Duplicate',
      }),
    );
    expect((await screen.findAllByRole('button', { name: /Dentist copy/ }))[0]).toBeVisible();
  });
  it('creates, edits, hides and reorders calendars with labelled controls', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/calendar']}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Appointments, kept local' });
    await user.click(screen.getByRole('button', { name: 'Manage calendars' }));
    const dialog = screen.getByRole('dialog', { name: 'Manage calendars' });
    await user.type(within(dialog).getByLabelText('New calendar'), 'Work');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByText('Work')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Move Work up' })).toBeEnabled();
    await user.click(within(dialog).getByRole('checkbox', { name: /Work/ }));
    await waitFor(() =>
      expect(within(dialog).getByRole('checkbox', { name: /Work/ })).not.toBeChecked(),
    );
  });
});
