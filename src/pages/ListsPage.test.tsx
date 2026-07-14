import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { App } from '../App';
import { database, initializeDatabase } from '../data/database';
import { plannerRepository } from '../data/plannerRepository';

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
  });

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
      'This will also remove 1 task',
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
});
