import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { App } from '../App';
import { database, initializeDatabase } from '../data/database';
import { focusRepository } from '../data/focusRepository';
import { plannerRepository } from '../data/plannerRepository';

async function resetDatabase() {
  database.close();
  await database.delete();
  await initializeDatabase(database);
}

function renderFocus(taskId: string) {
  return render(
    <MemoryRouter initialEntries={[`/focus/${taskId}`]}>
      <App />
    </MemoryRouter>,
  );
}

describe('Phase 4B focused start', () => {
  beforeEach(resetDatabase);

  afterEach(async () => {
    database.close();
    await database.delete();
  });

  it('uses Gentle Start to show why and prep before revealing the current task step', async () => {
    const task = await plannerRepository.createTask('Prepare the handoff');
    await plannerRepository.createStep(task.id, 'Write the summary');
    await focusRepository.createPrepItem(task.id, 'Open the shared folder');
    await focusRepository.saveStartingDetails(task.id, {
      whyItMatters: 'A clear handoff prevents uncertainty.',
      preferredStartStyle: 'gentle',
    });
    const user = userEvent.setup();
    renderFocus(task.id);

    expect(await screen.findByRole('heading', { name: 'Prepare the handoff' })).toBeVisible();
    expect(screen.getByText('A clear handoff prevents uncertainty.')).toBeVisible();
    expect(screen.getByText('Open the shared folder')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Begin Task' }));
    expect(await screen.findByRole('heading', { name: 'Write the summary' })).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Mark this step complete' }));
    expect(await screen.findByRole('dialog', { name: 'Complete this task?' })).toBeVisible();
    expect((await database.tasks.get(task.id))?.status).not.toBe('completed');
  });

  it('keeps One Thing narrow until Show Full Task is chosen', async () => {
    const task = await plannerRepository.createTask('Send the update');
    await plannerRepository.createStep(task.id, 'Open the draft');
    await focusRepository.createPrepItem(task.id, 'Put phone on silent');
    await focusRepository.saveStartingDetails(task.id, {
      whyItMatters: 'People are waiting for the decision.',
      preferredStartStyle: 'oneThing',
    });
    const user = userEvent.setup();
    renderFocus(task.id);

    await screen.findByRole('heading', { name: 'Send the update' });
    await waitFor(() => expect(screen.getByRole('radio', { name: /^One Thing/ })).toBeChecked());
    expect(screen.queryByText('People are waiting for the decision.')).not.toBeInTheDocument();
    expect(screen.queryByText('Put phone on silent')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Begin Task' }));
    expect(await screen.findByRole('heading', { name: 'Open the draft' })).toBeVisible();
    expect(screen.queryByText('People are waiting for the decision.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show Full Task' }));
    expect(await screen.findByText('People are waiting for the decision.')).toBeVisible();
    expect(screen.getByText('Put phone on silent')).toBeVisible();
  });

  it('shows Full View details together and never completes the task automatically', async () => {
    const task = await plannerRepository.createTask('Review the plan', undefined, {
      plannedDate: '2026-07-18',
      estimatedDurationMinutes: 25,
    });
    await plannerRepository.createStep(task.id, 'Read the first section');
    await focusRepository.saveStartingDetails(task.id, {
      whyItMatters: 'The plan needs a deliberate review.',
      preferredStartStyle: 'full',
    });
    const user = userEvent.setup();
    renderFocus(task.id);

    expect(await screen.findByText('The plan needs a deliberate review.')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Full View/ })).toBeChecked());
    expect(screen.getByRole('heading', { name: 'Task details' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Begin Task' }));
    await screen.findByRole('button', { name: 'Leave focus' });
    const fullDetails = await screen.findByRole('heading', { name: 'Task details' });
    const section = fullDetails.closest('section')!;
    await user.click(within(section).getByRole('checkbox'));
    expect(await screen.findByRole('dialog', { name: 'Complete this task?' })).toBeVisible();
    await waitFor(async () => {
      expect((await database.taskSteps.where('taskId').equals(task.id).first())?.completed).toBe(
        true,
      );
    });
    expect((await database.tasks.get(task.id))?.status).not.toBe('completed');
  });

  it('explains blockers and prevents beginning a blocked task', async () => {
    const predecessor = await plannerRepository.createTask('Receive the document');
    const blocked = await plannerRepository.createTask('Review the document');
    await plannerRepository.addRelationship(predecessor.id, blocked.id);
    renderFocus(blocked.id);

    expect(await screen.findByText('This task is blocked.')).toBeVisible();
    expect(screen.getByText(/Receive the document/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Begin Task' })).toBeDisabled();
    expect(await database.activeFocus.count()).toBe(0);
  });

  it('requires confirmation before switching the single active focus', async () => {
    const first = await plannerRepository.createTask('First focus');
    const second = await plannerRepository.createTask('Second focus');
    await focusRepository.startFocus(first.id, 'gentle');
    const user = userEvent.setup();
    renderFocus(second.id);

    expect(
      await screen.findByRole('heading', { name: 'First focus is currently focused' }),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Switch to Second focus' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Second focus' })).toBeVisible();
    expect(await focusRepository.getActiveFocus()).toMatchObject({ taskId: second.id });
    expect(await database.activeFocus.count()).toBe(1);
  });

  it('persists a paused countdown across a component reload', async () => {
    const task = await plannerRepository.createTask('Timed focus', undefined, {
      estimatedDurationMinutes: 15,
    });
    await focusRepository.startFocus(task.id, 'gentle');
    const user = userEvent.setup();
    const view = renderFocus(task.id);
    await screen.findByRole('heading', { level: 1, name: 'Timed focus' });
    await user.click(screen.getByRole('button', { name: /Use estimate/ }));
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    const paused = await focusRepository.getActiveFocus();
    expect(paused?.countdownState).toBe('paused');

    view.unmount();
    renderFocus(task.id);
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeVisible();
    expect(screen.getByLabelText(/Countdown paused/)).toBeVisible();
  });
});
