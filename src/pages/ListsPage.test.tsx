import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { App } from '../App';
import { database, initializeDatabase } from '../data/database';
import { plannerRepository } from '../data/plannerRepository';
import { calendarRepository } from '../data/calendarRepository';
import { DEFAULT_CALENDAR_ID } from '../data/plannerTypes';
import { routineRepository } from '../data/routineRepository';
import { focusRepository } from '../data/focusRepository';

async function resetDatabase() {
  database.close();
  await database.delete();
  await initializeDatabase(database);
}

describe('ListsPage', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    database.close();
    await database.delete();
  });

  it('includes deleted calendar events in recovery and restores them', async () => {
    const event = await calendarRepository.saveEvent({
      calendarId: DEFAULT_CALENDAR_ID,
      title: 'Recover appointment',
      startDate: '2026-07-16',
      endDate: '2026-07-16',
      allDay: true,
    });
    await calendarRepository.deleteEvent(event.id);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/lists?smart=recentlyDeleted']}>
        <App />
      </MemoryRouter>,
    );
    const recovery = await screen.findByText('Recover appointment');
    const row = recovery.closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.queryByText('Recover appointment')).not.toBeInTheDocument());
    expect((await database.calendarEvents.get(event.id))?.deletedAt).toBeUndefined();
  });

  it('restores soft-deleted event templates through the shared recovery interface', async () => {
    const template = await calendarRepository.saveTemplate({
      name: 'Recovery template',
      title: 'Recovered event',
      calendarId: DEFAULT_CALENDAR_ID,
      allDay: true,
    });
    await calendarRepository.deleteTemplate(template.id);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/lists?smart=recentlyDeleted']}>
        <App />
      </MemoryRouter>,
    );
    const row = (await screen.findByText('Recovery template')).closest('li')!;
    expect(within(row).getByText('Event template')).toBeVisible();
    await user.click(within(row).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.queryByText('Recovery template')).not.toBeInTheDocument());
    expect((await database.eventTemplates.get(template.id))?.deletedAt).toBeUndefined();
  });

  it('persists cleared completed tasks without deleting them and keeps newly completed tasks visible', async () => {
    const user = userEvent.setup();
    const view = render(
      <MemoryRouter initialEntries={['/lists']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Your lists' });
    await user.click(screen.getAllByRole('button', { name: 'Quick Add' })[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Quick Add' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Task title' }), 'Buy milk');
    await user.click(within(dialog).getByRole('button', { name: 'Save & Add Another' }));
    expect(
      await within(dialog).findByText('Task saved. Add another when you are ready.'),
    ).toBeVisible();
    await user.type(within(dialog).getByRole('textbox', { name: 'Task title' }), 'Call garage');
    await user.click(within(dialog).getByRole('button', { name: /^Save$/ }));

    expect(await screen.findByRole('button', { name: 'Buy milk' })).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Call garage' })).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Complete Buy milk' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Buy milk' }).closest('li')).toHaveClass(
        'is-completed',
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Clear Completed' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Buy milk' })).not.toBeInTheDocument(),
    );
    const completed = await database.tasks.filter((task) => task.title === 'Buy milk').first();
    expect(completed).toMatchObject({ status: 'completed' });
    expect(typeof completed?.completedClearedAt).toBe('string');
    expect(completed?.deletedAt).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Show completed' })).not.toBeInTheDocument();

    view.unmount();
    render(
      <MemoryRouter initialEntries={['/lists']}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Your lists' });
    expect(screen.queryByRole('button', { name: 'Buy milk' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit Call garage' }));
    const editDialog = screen.getByRole('dialog', { name: 'Edit task' });
    const title = within(editDialog).getByRole('textbox', { name: 'Task title' });
    await user.clear(title);
    await user.type(title, 'Call garage soon');
    await user.click(within(editDialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('button', { name: 'Call garage soon' })).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Complete Call garage soon' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Call garage soon' }).closest('li')).toHaveClass(
        'is-completed',
      ),
    );
    expect(screen.getByRole('button', { name: 'Call garage soon' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Clear Completed' })).toBeVisible();
  }, 10_000);

  it('shows explicit choices before deleting non-empty areas and lists', async () => {
    const area = (await plannerRepository.getSnapshot()).areas[0]!;
    const list = await plannerRepository.createList(area.id, 'Important', '#5B67C8');
    await plannerRepository.createTask('Keep this', list.id);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/lists']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Your lists' });
    await user.click(screen.getByRole('button', { name: 'Personal' }));
    await user.click(
      within(screen.getByLabelText('Actions for Important')).getByRole('button', {
        name: 'Delete',
      }),
    );
    expect(screen.getByRole('dialog', { name: 'Delete Important?' })).toHaveTextContent(
      'This will move the list and 1 task to Recently Deleted.',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(
      within(screen.getByLabelText('Actions for Personal')).getByRole('button', { name: 'Delete' }),
    );
    const areaDialog = screen.getByRole('dialog', { name: 'Delete Personal?' });
    expect(within(areaDialog).getByText('What should happen to its lists?')).toBeVisible();
    expect(within(areaDialog).getByRole('radio', { name: /Move lists to/ })).toBeChecked();
    await user.click(within(areaDialog).getByRole('button', { name: 'Move lists & delete' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Personal' })).not.toBeInTheDocument(),
    );
    const movedList = await database.lists.get(list.id);
    expect(typeof movedList?.areaId).toBe('string');
    expect(movedList?.areaId).not.toBe(area.id);
    await expect(database.tasks.where('listId').equals(list.id).first()).resolves.toMatchObject({
      title: 'Keep this',
    });
  });

  it('edits steps, tags, and before/after relationships without overcrowding quick add', async () => {
    const first = await plannerRepository.createTask('Assemble pack');
    const second = await plannerRepository.createTask('Leave home');
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/lists']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: first.title });
    await user.click(screen.getByRole('button', { name: `Edit ${first.title}` }));
    const dialog = screen.getByRole('dialog', { name: 'Edit task' });
    const stepInput = within(dialog).getByRole('textbox', { name: 'New step title' });
    await user.type(stepInput, 'Collect notes');
    await user.click(within(dialog).getByRole('button', { name: /^Add$/ }));
    await user.type(stepInput, 'Pack charger');
    await user.click(within(dialog).getByRole('button', { name: /^Add$/ }));
    await user.click(
      await within(dialog).findByRole('checkbox', { name: 'Complete Collect notes' }),
    );

    await user.type(within(dialog).getByRole('textbox', { name: 'New tag' }), 'Home');
    await user.click(within(dialog).getByRole('button', { name: 'Create tag' }));
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Home' }));

    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Task that happens after this task' }),
      second.id,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add after' }));
    expect(
      await within(dialog).findByRole('button', {
        name: `Remove relationship with ${second.title}`,
      }),
    ).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.getByText('1 of 2 steps')).toBeVisible());
    expect(
      screen.getAllByText('Home').find((element) => element.classList.contains('tag-chip')),
    ).toBeVisible();
    expect(screen.getByText(`Blocked by ${first.title}`)).toBeVisible();
    expect(screen.getByRole('checkbox', { name: `Complete ${second.title}` })).toBeDisabled();
  });

  it('shows project progress and supports reversible project archiving', async () => {
    const area = (await plannerRepository.getSnapshot()).areas[0]!;
    const project = await plannerRepository.createList(
      area.id,
      'Kitchen refresh',
      '#8C65B5',
      'project',
    );
    await plannerRepository.updateProjectDetails(
      project.id,
      'Make the room easier to use',
      '2026-08-01',
    );
    const first = await plannerRepository.createTask('Measure room', project.id);
    const second = await plannerRepository.createTask('Order materials', project.id);
    await plannerRepository.addRelationship(first.id, second.id);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/lists']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Your lists' });
    await user.click(screen.getByRole('button', { name: 'Personal' }));
    await user.click(screen.getByRole('button', { name: /^Kitchen refresh/ }));
    expect(screen.getByText('Make the room easier to use')).toBeVisible();
    expect(screen.getByText('0 completed of 2')).toBeVisible();
    expect(screen.getByText('Next available action:').parentElement).toHaveTextContent(
      'Measure room',
    );

    await user.click(screen.getByRole('checkbox', { name: 'Complete Measure room' }));
    await waitFor(() => expect(screen.getByText('1 completed of 2')).toBeVisible());
    expect(screen.getByText('Next available action:').parentElement).toHaveTextContent(
      'Order materials',
    );

    await user.click(screen.getByRole('button', { name: 'Archive project' }));
    expect(await screen.findByText('Kitchen refresh archived.')).toBeVisible();
    const activeAreaLists = screen
      .getByRole('region', { name: 'Lists' })
      .querySelector<HTMLElement>('.list-group-label + .entity-list')!;
    await waitFor(() =>
      expect(
        within(activeAreaLists).queryByRole('button', { name: /^Kitchen refresh/ }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Archived projects (1)')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () =>
      expect((await database.lists.get(project.id))?.archivedAt).toBeUndefined(),
    );
    await user.click(screen.getByRole('button', { name: 'Personal' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Lists' })).getByRole('button', {
          name: /^Kitchen refresh/,
        }),
      ).toBeVisible(),
    );
  });

  it('searches local records and restores a deleted task from Recently Deleted', async () => {
    const task = await plannerRepository.createTask('Book garden room');
    await plannerRepository.createStep(task.id, 'Compare garden quotes');
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/lists']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: 'Book garden room' });
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const searchDialog = screen.getByRole('dialog', { name: 'Search Planibly' });
    await user.type(within(searchDialog).getByRole('searchbox', { name: 'Search' }), 'garden');
    expect(await within(searchDialog).findByText('Book garden room')).toBeVisible();
    expect(await within(searchDialog).findByText('Compare garden quotes')).toBeVisible();
    await user.click(within(searchDialog).getByText('Book garden room').closest('button')!);

    const editor = await screen.findByRole('dialog', { name: 'Edit task' });
    await user.click(within(editor).getByRole('button', { name: 'Delete task' }));
    await user.click(within(editor).getByRole('button', { name: 'Confirm delete task' }));
    expect(await screen.findByText('Book garden room moved to Recently Deleted.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Recently Deleted' }));
    await screen.findByRole('heading', { name: 'Recently Deleted' });
    const deletedTask = await screen.findByText('Book garden room', {
      selector: '.recovery-list strong',
    });
    expect(deletedTask).toBeVisible();
    await user.click(within(deletedTask.closest('li')!).getByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Inbox' }));
    expect(await screen.findByRole('button', { name: 'Book garden room' })).toBeVisible();
  });

  it('includes routine definitions in Recently Deleted and restores their hierarchy', async () => {
    const routine = await routineRepository.saveRoutine({
      name: 'Recoverable routine',
      color: '#5B67C8',
      isActive: true,
      presentationStyle: 'checklist',
      scheduleKind: 'manual',
      selectedWeekdays: [],
      defaultSection: 'anyTime',
      items: [{ id: crypto.randomUUID(), title: 'Restored item', order: 0, isActive: true }],
      variants: [],
    });
    await routineRepository.deleteRoutine(routine.id);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/lists']}>
        <App />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Recently Deleted' }));
    const deleted = await screen.findByText('Recoverable routine', {
      selector: '.recovery-list strong',
    });
    const row = deleted.closest('li');
    expect(row).not.toBeNull();
    await user.click(within(row!).getByRole('button', { name: 'Restore' }));
    await waitFor(async () =>
      expect((await database.routines.get(routine.id))?.deletedAt).toBeUndefined(),
    );
    await waitFor(() =>
      expect(
        screen.queryByText('Recoverable routine', { selector: '.recovery-list strong' }),
      ).toBeNull(),
    );
    expect(
      (await database.routineItems.where('routineId').equals(routine.id).toArray()).every(
        (item) => !item.deletedAt,
      ),
    ).toBe(true);
  });

  it('edits optional starting details and a distinct prep checklist in the task editor', async () => {
    const task = await plannerRepository.createTask('Start supported task');
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/lists?task=${task.id}`]}>
        <App />
      </MemoryRouter>,
    );
    const editor = await screen.findByRole('dialog', { name: 'Edit task' });
    await user.type(within(editor).getByLabelText('Why this task matters'), 'It clears the path.');
    await user.selectOptions(within(editor).getByLabelText('Preferred start style'), 'oneThing');
    await user.type(within(editor).getByLabelText('Default countdown (minutes)'), '12');

    const prepSection = within(editor)
      .getByRole('heading', { name: 'Prep checklist' })
      .closest('section')!;
    await user.type(within(prepSection).getByPlaceholderText('Add preparation'), 'Open notes');
    await user.click(within(prepSection).getByRole('button', { name: 'Add prep' }));
    const prepCheckbox = await within(prepSection).findByRole('checkbox', {
      name: 'Mark ready Open notes',
    });
    await user.click(prepCheckbox);
    expect((await database.tasks.get(task.id))?.status).toBe('inbox');
    expect(await database.taskSteps.where('taskId').equals(task.id).count()).toBe(0);

    const taskForm = editor.querySelector<HTMLFormElement>('.task-core-form')!;
    await user.click(within(taskForm).getByRole('button', { name: 'Save' }));
    await waitFor(async () => {
      expect(
        await database.taskStartingDetails.where('taskId').equals(task.id).first(),
      ).toMatchObject({
        whyItMatters: 'It clears the path.',
        preferredStartStyle: 'oneThing',
        defaultCountdownMinutes: 12,
      });
    });
    expect(await focusRepository.resetPrepItems(task.id)).toBe(1);
  });
});
