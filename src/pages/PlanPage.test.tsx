import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { App } from '../App';
import { database, initializeDatabase } from '../data/database';
import { addCalendarDays, localDateFromDate } from '../data/planning';
import { plannerRepository } from '../data/plannerRepository';
import { calendarRepository } from '../data/calendarRepository';
import { DEFAULT_CALENDAR_ID } from '../data/plannerTypes';
import { routineRepository } from '../data/routineRepository';
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

  it('shows appointments separately, summarizes event time, and reports overlaps', async () => {
    const today = localDateFromDate(new Date());
    await plannerRepository.createTask('Timed task', undefined, {
      plannedDate: today,
      exactStartTime: '09:30',
      estimatedDurationMinutes: 60,
    });
    await calendarRepository.saveEventWithRecurrence(
      {
        calendarId: DEFAULT_CALENDAR_ID,
        title: 'Appointment',
        startDate: today,
        endDate: today,
        allDay: false,
        startTime: '09:00',
        endTime: '10:00',
      },
      { frequency: 'daily', interval: 1, endMode: 'count', occurrenceCount: 2 },
    );
    render(
      <MemoryRouter initialEntries={['/plan']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Appointments' })).toBeVisible();
    expect(screen.getByText('Repeats')).toBeVisible();
    expect(screen.getByText(/Scheduled events: 1 hr/)).toBeVisible();
    expect(screen.getByText('Appointment overlaps Timed task.')).toBeVisible();
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

    expect((await screen.findAllByText('Act today')).length).toBeGreaterThan(0);
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

  it('edits capacity and explicitly reviews an earlier plan', async () => {
    const today = localDateFromDate(new Date());
    const earlier = await plannerRepository.createTask('Bring forward', undefined, {
      plannedDate: addCalendarDays(today, -1),
      estimatedDurationMinutes: 30,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/plan']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Previously planned' });
    await user.click(screen.getByText('Adjust capacity'));
    const weekday = screen.getByRole('group', { name: 'Weekday default' });
    await user.clear(within(weekday).getByLabelText('Minutes'));
    await user.type(within(weekday).getByLabelText('Minutes'), '120');
    await user.click(within(weekday).getByRole('button', { name: 'Save default' }));
    await waitFor(async () => expect(await database.planningCapacities.count()).toBe(1));
    await screen.findByText('2 hrs available');

    const review = screen.getByRole('region', { name: 'Previously planned' });
    await user.click(within(review).getByRole('checkbox', { name: 'Bring forward' }));
    await user.click(within(review).getByRole('button', { name: 'Move to today' }));
    const dialog = screen.getByRole('dialog', { name: 'Review earlier plans' });
    expect(within(dialog).getByText(/Nothing happens until you confirm/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(async () =>
      expect(await database.tasks.get(earlier.id)).toMatchObject({ plannedDate: today }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Previously planned' })).toBeNull(),
    );
  });

  it('places a flexible task deliberately while preserving its range', async () => {
    const today = localDateFromDate(new Date());
    const task = await plannerRepository.createTask('Flexible placement', undefined, {
      flexibleStartDate: today,
      flexibleEndDate: addCalendarDays(today, 2),
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/plan']}>
        <App />
      </MemoryRouter>,
    );

    const source = await screen.findByRole('region', { name: 'Flexible range tasks' });
    await user.click(within(source).getByRole('button', { name: 'Plan' }));
    await waitFor(async () =>
      expect(await database.plannedPlacements.get(task.id)).toMatchObject({
        localDate: today,
        source: 'flexibleRange',
      }),
    );
    expect(await database.tasks.get(task.id)).toMatchObject({
      flexibleStartDate: today,
      flexibleEndDate: addCalendarDays(today, 2),
    });
    expect((await database.tasks.get(task.id))?.plannedDate).toBeUndefined();
    await waitFor(() => expect(within(source).queryByRole('button', { name: 'Plan' })).toBeNull());
  });

  it('shows routines separately without changing task capacity and opens a daily run', async () => {
    const today = localDateFromDate(new Date());
    await routineRepository.saveRoutine({
      name: 'Plan morning routine',
      color: '#5B67C8',
      isActive: true,
      expectedDurationMinutes: 20,
      presentationStyle: 'checklist',
      scheduleKind: 'daily',
      selectedWeekdays: [],
      defaultSection: 'morning',
      items: [
        {
          id: crypto.randomUUID(),
          title: 'Prepare the day',
          order: 0,
          isActive: true,
        },
      ],
      variants: [],
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/plan']}>
        <App />
      </MemoryRouter>,
    );
    const routines = await screen.findByRole('region', { name: 'Routines' });
    expect(within(routines).getByText('Plan morning routine')).toBeVisible();
    expect(within(routines).getByText(/20 min expected/)).toBeVisible();
    expect(within(routines).getByText(/does not change task capacity/)).toBeVisible();
    await user.click(within(routines).getByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('dialog', { name: 'Plan morning routine' })).toBeVisible();
    expect(await database.routineRuns.where('localDate').equals(today).count()).toBe(1);
  });
});
