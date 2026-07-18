import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { App } from '../App';
import { database, initializeDatabase } from '../data/database';
import { addCalendarDays, localDateFromDate } from '../data/planning';
import { plannerRepository } from '../data/plannerRepository';

async function resetDatabase() {
  database.close();
  await database.delete();
  await initializeDatabase(database);
}

describe('Phase 4C Reviews workspace', () => {
  beforeEach(resetDatabase);

  afterEach(async () => {
    database.close();
    await database.delete();
  });

  it('opens a controlled-date Morning Summary and keeps earlier plans distinct from deadlines', async () => {
    const today = localDateFromDate(new Date());
    await plannerRepository.createTask('Earlier intention', undefined, {
      plannedDate: addCalendarDays(today, -1),
    });
    await plannerRepository.createTask('Genuine deadline', undefined, {
      deadlineDate: addCalendarDays(today, -1),
    });
    await plannerRepository.createTask('Today task', undefined, { plannedDate: today });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/reviews']}>
        <App />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Start Morning Summary review' }));
    expect(await screen.findByRole('heading', { name: 'Morning Summary', level: 1 })).toBeVisible();
    const earlier = screen.getByText('Previously planned, still incomplete').closest('summary')!;
    const overdue = screen.getByText('Genuine overdue deadlines').closest('summary')!;
    expect(earlier).toHaveTextContent('1');
    expect(overdue).toHaveTextContent('1');
    await user.click(earlier);
    expect(screen.getByRole('button', { name: 'Earlier intention' })).toBeVisible();
    expect(screen.getByText(/Currently/)).toBeVisible();
    expect(screen.queryByText(/Earlier intention.*overdue/i)).not.toBeInTheDocument();
  });

  it('previews, cancels, approves, and persists a planning change', async () => {
    const today = localDateFromDate(new Date());
    const tomorrow = addCalendarDays(today, 1);
    const task = await plannerRepository.createTask('Move deliberately', undefined, {
      plannedDate: addCalendarDays(today, -1),
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/reviews']}>
        <App />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Start Morning Summary review' }));
    await screen.findByRole('heading', { name: 'Morning Summary', level: 1 });
    await user.click(screen.getByText('Previously planned, still incomplete'));
    await user.selectOptions(screen.getByLabelText('Choice for Move deliberately'), 'move');
    await user.clear(screen.getByLabelText('Destination date'));
    await user.type(screen.getByLabelText('Destination date'), tomorrow);
    await user.click(screen.getByRole('button', { name: 'Preview changes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Preview planning changes' });
    expect(within(dialog).getByText('Move deliberately')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect((await database.tasks.get(task.id))?.plannedDate).toBe(addCalendarDays(today, -1));
    await user.click(screen.getByRole('button', { name: 'Preview changes' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Preview planning changes' })).getByRole(
        'button',
        { name: 'Approve changes' },
      ),
    );
    await waitFor(() =>
      expect(database.tasks.get(task.id)).resolves.toMatchObject({ plannedDate: tomorrow }),
    );
  });

  it('dismisses only for the session, resumes unfinished work, and finishes deliberately', async () => {
    const user = userEvent.setup();
    const view = render(
      <MemoryRouter initialEntries={['/reviews?type=evening']}>
        <App />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Start Evening Review review' }));
    await screen.findByRole('heading', { name: 'Evening Review', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Dismiss for now' }));
    expect(await screen.findByText('Dismissed this session')).toBeVisible();
    expect(await database.reviewRecords.count()).toBe(1);
    view.unmount();

    render(
      <MemoryRouter initialEntries={['/reviews?type=evening']}>
        <App />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Continue Evening Review review' }));
    await screen.findByRole('heading', { name: 'Evening Review', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Save and finish' }));
    await waitFor(async () => {
      const record = await database.reviewRecords.toCollection().first();
      expect(record?.finishedAt).toBeDefined();
    });
    expect(await screen.findByText('Finished for today')).toBeVisible();
  });
});
