import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { App } from '../App';
import { database, initializeDatabase } from '../data/database';
import { routineRepository } from '../data/routineRepository';

async function resetDatabase() {
  database.close();
  await database.delete();
  await initializeDatabase(database);
}

describe('Phase 4A routines workspace', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-18T12:00:00'));
    await resetDatabase();
  });

  afterEach(async () => {
    vi.useRealTimers();
    database.close();
    await database.delete();
  });

  it('creates an editable routine and runs it in all three presentation styles', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/routines']}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Support the day without making it rigid' }),
    ).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Create routine' })[0]!);
    const editor = screen.getByRole('dialog', { name: 'Create routine' });
    await user.type(within(editor).getByLabelText('Name'), 'Saturday reset');
    await user.type(within(editor).getByLabelText('Item title'), 'Open curtains');
    await user.click(within(editor).getByRole('button', { name: 'Add item' }));
    await user.type(within(editor).getAllByLabelText('Item title')[1]!, 'Drink water');
    await user.click(within(editor).getByRole('radio', { name: /Step by Step/ }));
    await user.click(within(editor).getByRole('button', { name: 'Add variant' }));
    await user.clear(within(editor).getByLabelText('Variant name'));
    await user.type(within(editor).getByLabelText('Variant name'), 'Saturday version');
    await user.click(within(editor).getByRole('checkbox', { name: 'Saturday' }));
    await user.click(within(editor).getByRole('button', { name: 'Save routine' }));

    const library = await screen.findByRole('region', { name: 'All Routines' });
    const row = (await within(library).findByText('Saturday reset')).closest('li');
    expect(row).not.toBeNull();
    await user.click(within(row!).getByRole('button', { name: 'Start' }));
    const run = await screen.findByRole('dialog', { name: 'Saturday reset' });
    expect(within(run).getByText(/Saturday version/)).toBeVisible();
    expect(within(run).getByRole('button', { name: 'Show Full Routine' })).toBeVisible();
    await user.click(within(run).getByRole('button', { name: 'Next' }));
    expect(within(run).getByRole('checkbox', { name: /Drink water/ })).toBeVisible();
    await user.click(within(run).getByRole('button', { name: 'Show Full Routine' }));
    expect(within(run).getAllByRole('checkbox')).toHaveLength(2);

    await user.selectOptions(within(run).getByLabelText('Presentation for this run'), 'compact');
    await waitFor(() =>
      expect(within(run).getByLabelText('Presentation for this run')).toHaveValue('compact'),
    );
    await user.selectOptions(within(run).getByLabelText('Presentation for this run'), 'checklist');
    await user.click(within(run).getByRole('checkbox', { name: /Open curtains/ }));
    await user.click(within(run).getByRole('checkbox', { name: /Drink water/ }));
    await waitFor(async () =>
      expect(
        (await database.routineRunItems.toArray()).filter((item) => item.completedAt),
      ).toHaveLength(2),
    );
    await waitFor(() => expect(within(run).getAllByText('2 of 2').length).toBeGreaterThan(0));
    await user.click(within(run).getByRole('button', { name: 'Mark routine complete' }));
    expect(await within(run).findByText('Completed')).toBeVisible();
    await user.click(within(run).getByRole('button', { name: 'Reopen run' }));
    await within(run).findByRole('button', { name: 'Skip routine' });
    await user.click(within(run).getByRole('button', { name: 'Skip routine' }));
    const skip = screen.getByRole('dialog', { name: 'Skip this routine?' });
    expect(within(skip).getByText(/neutral record/)).toBeVisible();
    await user.click(within(skip).getByRole('button', { name: 'Skip routine' }));
    expect(await within(run).findByText('Skipped')).toBeVisible();
  }, 10_000);

  it('requires explicit confirmation before soft-deleting a routine', async () => {
    await routineRepository.saveRoutine({
      name: 'Routine to recover',
      color: '#5B67C8',
      isActive: true,
      presentationStyle: 'checklist',
      scheduleKind: 'manual',
      selectedWeekdays: [],
      defaultSection: 'anyTime',
      items: [
        {
          id: crypto.randomUUID(),
          title: 'One item',
          order: 0,
          isActive: true,
        },
      ],
      variants: [],
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/routines']}>
        <App />
      </MemoryRouter>,
    );
    const library = await screen.findByRole('region', { name: 'All Routines' });
    const row = within(library).getByText('Routine to recover').closest('li');
    await user.click(within(row!).getByRole('button', { name: 'Delete' }));
    const confirmation = screen.getByRole('dialog', { name: 'Delete Routine to recover?' });
    expect(within(confirmation).getByText(/Historical runs remain intact/)).toBeVisible();
    await user.click(within(confirmation).getByRole('button', { name: 'Delete routine' }));
    await waitFor(() => expect(within(library).queryByText('Routine to recover')).toBeNull());
    expect((await database.routines.toArray())[0]?.deletedAt).toBeDefined();
  });

  it('changes a previously scheduled occurrence only after explicit approval', async () => {
    const routine = await routineRepository.saveRoutine({
      name: 'Daily review routine',
      color: '#5B67C8',
      isActive: true,
      presentationStyle: 'checklist',
      scheduleKind: 'daily',
      selectedWeekdays: [],
      defaultSection: 'anyTime',
      items: [{ id: crypto.randomUUID(), title: 'Review item', order: 0, isActive: true }],
      variants: [],
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/routines']}>
        <App />
      </MemoryRouter>,
    );
    const review = await screen.findByRole('region', { name: 'Choose only if it helps' });
    expect(within(review).getByText('Previously scheduled')).toBeVisible();
    await user.click(within(review).getByRole('button', { name: 'Start today' }));
    expect(await database.routineOccurrenceAdjustments.count()).toBe(0);
    const confirmation = screen.getByRole('dialog', { name: 'Start this routine today?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Confirm' }));
    await waitFor(async () =>
      expect(
        await database.routineOccurrenceAdjustments.where('routineId').equals(routine.id).first(),
      ).toMatchObject({ originalDate: '2026-07-17', destinationDate: '2026-07-18' }),
    );
    await waitFor(async () =>
      expect(await database.routineRuns.where('routineId').equals(routine.id).count()).toBe(1),
    );
    expect(await screen.findByRole('dialog', { name: 'Daily review routine' })).toBeVisible();
  });
});
