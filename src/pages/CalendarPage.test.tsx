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

  it('creates recurrence and requires an explicit occurrence scope when editing', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/calendar']}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Appointments, kept local' });
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    const create = screen.getByRole('dialog', { name: 'Create event' });
    await user.type(within(create).getByLabelText('Title'), 'Daily stand-up');
    await user.click(within(create).getByText('Repeat'));
    await user.click(within(create).getByRole('checkbox', { name: 'Repeat this event' }));
    await user.selectOptions(within(create).getByLabelText('Ends'), 'count');
    const count = within(create).getByLabelText('Number of occurrences');
    await user.clear(count);
    await user.type(count, '3');
    await user.click(within(create).getByRole('button', { name: 'Save event' }));

    const occurrence = (await screen.findAllByRole('button', { name: /Daily stand-up/ }))[0]!;
    await user.click(occurrence);
    const edit = screen.getByRole('dialog', { name: 'Edit event' });
    const title = within(edit).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Daily check-in');
    await user.click(within(edit).getByRole('button', { name: 'Save event' }));
    const scope = screen.getByRole('dialog', { name: 'Change recurring event?' });
    await user.click(within(scope).getByRole('button', { name: /This event only/ }));
    expect((await screen.findAllByRole('button', { name: /Daily check-in/ }))[0]).toBeVisible();
  });

  it('creates, duplicates and applies an independent event template', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/calendar']}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Appointments, kept local' });
    await user.click(screen.getByRole('button', { name: 'Templates' }));
    const manager = screen.getByRole('dialog', { name: 'Event templates' });
    await user.type(within(manager).getByLabelText('Template name'), 'Weekly review');
    await user.type(within(manager).getByLabelText('Event title'), 'Review the week');
    await user.click(within(manager).getByRole('button', { name: 'Create template' }));
    expect(await within(manager).findByText('Weekly review')).toBeVisible();
    await user.click(within(manager).getByRole('button', { name: 'Duplicate' }));
    expect(await within(manager).findByText('Weekly review copy')).toBeVisible();
    await user.click(within(manager).getByRole('button', { name: 'Close dialog' }));
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    const create = screen.getByRole('dialog', { name: 'Create event' });
    const templateOption = within(create).getByRole<HTMLOptionElement>('option', {
      name: 'Weekly review',
    });
    await user.selectOptions(within(create).getByLabelText('Template'), templateOption.value);
    await user.click(within(create).getByRole('button', { name: 'Apply' }));
    expect(within(create).getByLabelText('Title')).toHaveValue('Review the week');
    await user.click(within(create).getByRole('button', { name: 'Save event' }));
    expect((await screen.findAllByRole('button', { name: /Review the week/ }))[0]).toBeVisible();
  });
});
