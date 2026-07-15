import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { App } from '../App';
import { database, initializeDatabase } from '../data/database';
import { addCalendarDays, localDateFromDate } from '../data/planning';
import { plannerRepository } from '../data/plannerRepository';
import { TaskEditorDialog } from '../features/planner/TaskEditorDialog';

async function resetDatabase() {
  database.close();
  await database.delete();
  await initializeDatabase(database);
}

describe('Phase 2A planning interface', () => {
  beforeEach(resetDatabase);

  afterEach(async () => {
    database.close();
    await database.delete();
  });

  it('renders the functional Plan sections and respects blocking while completing', async () => {
    const today = localDateFromDate(new Date());
    const predecessor = await plannerRepository.createTask('Prepare notes', undefined, {
      plannedDate: today,
    });
    const blocked = await plannerRepository.createTask('Send notes', undefined, {
      plannedDate: today,
      deadlineDate: addCalendarDays(today, 2),
    });
    const flexible = await plannerRepository.createTask('Visit shop', undefined, {
      flexibleStartDate: today,
      flexibleEndDate: addCalendarDays(today, 1),
    });
    await plannerRepository.addRelationship(predecessor.id, blocked.id);
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/plan']}>
        <App />
      </MemoryRouter>,
    );

    const todaySection = await screen.findByRole('region', { name: 'Today' });
    expect(within(todaySection).getByText('Prepare notes')).toBeVisible();
    expect(within(todaySection).getByText('Send notes')).toBeVisible();
    expect(within(todaySection).getByText('Blocked by Prepare notes')).toBeVisible();
    expect(
      within(todaySection).getByRole('checkbox', { name: 'Complete Send notes' }),
    ).toBeDisabled();
    expect(
      within(await screen.findByRole('region', { name: 'Flexible range tasks' })).getByText(
        flexible.title,
      ),
    ).toBeVisible();

    await user.click(
      within(todaySection).getByRole('checkbox', { name: 'Complete Prepare notes' }),
    );
    await waitFor(() =>
      expect(
        within(todaySection).getByRole('checkbox', { name: 'Complete Send notes' }),
      ).toBeEnabled(),
    );
  });

  it('saves and clears optional planning controls in the existing task editor', async () => {
    const task = await plannerRepository.createTask('Plan carefully');
    const user = userEvent.setup();
    const view = render(
      <TaskEditorDialog
        task={task}
        snapshot={await plannerRepository.getSnapshot()}
        onClose={() => undefined}
      />,
    );

    let dialog = screen.getByRole('dialog', { name: 'Edit task' });
    await user.type(within(dialog).getByLabelText('Planned day'), '2026-06-12');
    await user.type(within(dialog).getByLabelText('Genuine deadline'), '2026-06-14');
    await user.selectOptions(within(dialog).getByLabelText('Time'), 'exact');
    await user.type(within(dialog).getByLabelText('Exact start time'), '09:30');
    await user.type(within(dialog).getByLabelText('Estimated duration (minutes)'), '45');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(async () =>
      expect(await database.tasks.get(task.id)).toMatchObject({
        plannedDate: '2026-06-12',
        deadlineDate: '2026-06-14',
        exactStartTime: '09:30',
        estimatedDurationMinutes: 45,
      }),
    );
    view.unmount();
    const persisted = (await database.tasks.get(task.id))!;
    render(
      <TaskEditorDialog
        task={persisted}
        snapshot={await plannerRepository.getSnapshot()}
        onClose={() => undefined}
      />,
    );
    dialog = screen.getByRole('dialog', { name: 'Edit task' });
    await user.click(within(dialog).getByRole('button', { name: 'Clear planning' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(async () => {
      const cleared = await database.tasks.get(task.id);
      expect(cleared?.plannedDate).toBeUndefined();
      expect(cleared?.deadlineDate).toBeUndefined();
      expect(cleared?.exactStartTime).toBeUndefined();
      expect(cleared?.estimatedDurationMinutes).toBeUndefined();
    });
  });

  it('keeps Quick Add title-first while allowing an optional Today shortcut', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/plan']}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Shape time with intention' });
    await user.click(screen.getAllByRole('button', { name: 'Quick Add' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Quick Add' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Task title' }), 'Act today');
    await user.click(within(dialog).getByRole('radio', { name: 'Today' }));
    await user.click(within(dialog).getByRole('button', { name: /^Save$/ }));

    expect(await screen.findByText('Act today')).toBeVisible();
    await expect(
      database.tasks.filter((task) => task.title === 'Act today').first(),
    ).resolves.toMatchObject({
      plannedDate: localDateFromDate(new Date()),
    });
  });

  it('exposes date smart lists and never treats a past planned day as overdue', async () => {
    const today = localDateFromDate(new Date());
    await plannerRepository.createTask('Act today', undefined, { plannedDate: today });
    await plannerRepository.createTask('Past intention', undefined, {
      plannedDate: addCalendarDays(today, -1),
    });
    await plannerRepository.createTask('Genuine overdue item', undefined, {
      deadlineDate: addCalendarDays(today, -1),
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/lists']}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Your lists' });
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('button', { name: 'Act today' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Past intention' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Overdue' }));
    expect(await screen.findByRole('button', { name: 'Genuine overdue item' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Past intention' })).toBeNull();
  });
});
