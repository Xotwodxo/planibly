import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { App } from '../App';
import { database, initializeDatabase } from '../data/database';
import { localDateFromDate } from '../data/planning';
import { plannerRepository } from '../data/plannerRepository';
import { calendarRepository } from '../data/calendarRepository';
import { DEFAULT_CALENDAR_ID } from '../data/plannerTypes';
import { routineRepository } from '../data/routineRepository';

async function resetDatabase() {
  database.close();
  await database.delete();
  await initializeDatabase(database);
}

describe('Phase 2B Home dashboard', () => {
  beforeEach(resetDatabase);

  afterEach(async () => {
    vi.restoreAllMocks();
    database.close();
    await database.delete();
  });

  it('shows useful empty cards and opens the reused title-only Quick Add', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'A calm view of what matters' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Today' })).toBeVisible();
    expect(screen.getByText('Nothing is planned for today.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Recently Completed' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Add a task' }));
    const dialog = screen.getByRole('dialog', { name: 'Quick Add' });
    expect(within(dialog).getByLabelText('Task title')).toBeRequired();
    await within(dialog).findByRole('option', { name: 'Inbox' });
    expect(within(dialog).getByLabelText('Destination list')).toHaveValue(
      '10000000-0000-4000-8000-000000000001',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
  });

  it('includes visible appointments in the existing Today card and opens the event editor', async () => {
    const today = localDateFromDate(new Date());
    await calendarRepository.saveEventWithRecurrence(
      {
        calendarId: DEFAULT_CALENDAR_ID,
        title: 'Check-up',
        startDate: today,
        endDate: today,
        allDay: false,
        startTime: '10:00',
        endTime: '10:30',
      },
      { frequency: 'daily', interval: 1, endMode: 'count', occurrenceCount: 2 },
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    const todayCard = await screen.findByRole('region', { name: 'Today' });
    expect(within(todayCard).getByText(/Repeats/)).toBeVisible();
    expect(within(todayCard).getByText(/Appointment · 10:00–10:30 · Personal/)).toBeVisible();
    await user.click(within(todayCard).getByRole('button', { name: 'Check-up' }));
    expect(screen.getByRole('dialog', { name: 'Edit event' })).toBeVisible();
  });

  it('renders live task data, explains blocking, and opens the existing editor', async () => {
    const today = localDateFromDate(new Date());
    const predecessor = await plannerRepository.createTask('Prepare first', undefined, {
      plannedDate: today,
    });
    const blocked = await plannerRepository.createTask('Then continue', undefined, {
      plannedDate: today,
    });
    await plannerRepository.addRelationship(predecessor.id, blocked.id);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    const todayCard = await screen.findByRole('region', { name: 'Today' });
    expect(within(todayCard).getByText('Blocked by Prepare first')).toBeVisible();
    expect(
      within(todayCard).getByRole('checkbox', { name: 'Complete Then continue' }),
    ).toBeDisabled();
    await user.click(within(todayCard).getByRole('button', { name: 'Then continue' }));
    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeVisible();
  });

  it('keeps customization in a draft, discards on confirmation, and persists a saved copy', async () => {
    const user = userEvent.setup();
    const view = render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'A calm view of what matters' });

    await user.click(screen.getByRole('button', { name: 'Customise dashboard' }));
    await user.click(screen.getByRole('checkbox', { name: 'Today' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Discard dashboard changes?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Customise dashboard' }));
    await user.click(screen.getByRole('checkbox', { name: 'Today' }));
    await user.selectOptions(screen.getByLabelText('Size for Quick Add'), 'wide');
    await user.click(screen.getByRole('button', { name: 'Move Quick Add down' }));
    await user.click(screen.getByRole('button', { name: 'Save dashboard' }));

    await screen.findByRole('heading', { name: 'A calm view of what matters' });
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLSelectElement>('Dashboard layout').selectedOptions[0]
          ?.textContent,
      ).toContain('Overview custom'),
    );
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument();
    view.unmount();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'A calm view of what matters' });
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Quick Add' })).toHaveAttribute(
      'data-card-size',
      'wide',
    );
  });

  it('warns before in-app navigation while customization is unsaved', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'A calm view of what matters' });
    await user.click(screen.getByRole('button', { name: 'Customise dashboard' }));
    await user.click(screen.getByRole('checkbox', { name: 'Today' }));
    await user.click(screen.getAllByRole('link', { name: 'Plan' })[0]!);

    expect(confirm).toHaveBeenCalledWith('Discard unsaved dashboard changes?');
    expect(screen.getByRole('heading', { name: 'Customise dashboard' })).toBeVisible();
  });

  it('creates a layout and requires confirmation before deleting it', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'A calm view of what matters' });

    await user.click(screen.getByText('Layout options'));
    await user.click(screen.getByRole('button', { name: 'New layout' }));
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLSelectElement>('Dashboard layout').selectedOptions[0]
          ?.textContent,
      ).toBe('New layout'),
    );

    await user.click(screen.getByText('Layout options'));
    await user.click(screen.getByRole('button', { name: 'Delete layout' }));
    expect(screen.getByRole('dialog', { name: 'Delete New layout?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Keep current' }));
    expect(
      screen.getByLabelText<HTMLSelectElement>('Dashboard layout').selectedOptions[0]?.textContent,
    ).toBe('New layout');

    await user.click(screen.getByRole('button', { name: 'Delete layout' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete New layout?' })).getByRole('button', {
        name: 'Delete layout',
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLSelectElement>('Dashboard layout').selectedOptions[0]
          ?.textContent,
      ).toContain('Overview'),
    );
  });

  it('renders the optional Current Routine card with a start action', async () => {
    await routineRepository.saveRoutine({
      name: 'Dashboard routine',
      color: '#5B67C8',
      isActive: true,
      presentationStyle: 'checklist',
      scheduleKind: 'daily',
      selectedWeekdays: [],
      defaultSection: 'morning',
      items: [
        {
          id: crypto.randomUUID(),
          title: 'First routine item',
          order: 0,
          isActive: true,
        },
      ],
      variants: [],
    });
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    const card = await screen.findByRole('region', { name: 'Current Routine' });
    expect(within(card).getByText('Dashboard routine')).toBeVisible();
    expect(within(card).getByText('First routine item')).toBeVisible();
    expect(within(card).getByRole('link', { name: 'Start' })).toHaveAttribute(
      'href',
      expect.stringContaining('/routines?start='),
    );
  });
});
