import { expect, test } from '@playwright/test';

const githubPagesBasePath = '/planibly/';

test('exposes an installable manifest', async ({ page, request }) => {
  await page.goto(githubPagesBasePath);
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();

  const response = await request.get(manifestHref!);
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    name: string;
    display: string;
    id: string;
    scope: string;
    start_url: string;
    icons: { purpose?: string; src: string }[];
  };
  expect(manifest.name).toBe('Planibly');
  expect(manifest.display).toBe('standalone');
  expect(manifest.id).toBe('/planibly/');
  expect(manifest.start_url).toBe('/planibly/');
  expect(manifest.scope).toBe('/planibly/');
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

  const manifestUrl = new URL(manifestHref!, page.url());
  for (const icon of manifest.icons) {
    const iconUrl = new URL(icon.src, manifestUrl);
    expect(iconUrl.pathname.startsWith('/planibly/icons/')).toBe(true);
    expect((await request.get(iconUrl.toString())).ok()).toBe(true);
  }
});

test('loads, refreshes, and navigates routes below the GitHub Pages base path', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Desktop-only routing assertion');

  await page.goto('/planibly/plan');
  await expect(page).toHaveURL(/\/planibly\/plan$/);
  await expect(page.getByRole('heading', { name: 'Shape time with intention' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Shape time with intention' })).toBeVisible();

  const homeLink = page.getByRole('link', { name: 'Planibly home' });
  await expect(homeLink).toHaveCount(1);
  await homeLink.click();
  await expect(page).toHaveURL(/\/planibly\/$/);
});

test('registers the service worker within the GitHub Pages scope', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Desktop-only service-worker assertion');
  await page.goto(githubPagesBasePath);

  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return { scope: ready.scope, scriptUrl: ready.active?.scriptURL ?? null };
  });

  expect(registration.scope).toBe(`${new URL(page.url()).origin}/planibly/`);
  expect(registration.scriptUrl).toBe(`${new URL(page.url()).origin}/planibly/sw.js`);
});

test('ships a GitHub Pages route fallback', async ({ request }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Desktop-only deployment assertion');

  const response = await request.get('/planibly/404.html');
  expect(response.ok()).toBe(true);
  await expect(response.text()).resolves.toContain('_ghp_route');
});

test('uses side navigation on a wider screen', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Desktop-only layout assertion');
  await page.goto(githubPagesBasePath);
  await expect(page.locator('.side-navigation')).toBeVisible();
  await expect(page.locator('.bottom-navigation')).toBeHidden();
  await page.getByRole('link', { name: 'Plan', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Shape time with intention' })).toBeVisible();
});

test('uses bottom navigation on a mobile viewport', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only layout assertion');
  await page.goto(githubPagesBasePath);
  await expect(page.locator('.bottom-navigation')).toBeVisible();
  await expect(page.locator('.side-navigation')).toBeHidden();
  await page.locator('.bottom-navigation').getByRole('link', { name: 'Lists' }).click();
  await expect(page.getByRole('heading', { name: 'Your lists' })).toBeVisible();
});

test('persists a mobile calendar event through reload and offline reopening', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only Phase 3A flow');
  await page.goto(githubPagesBasePath);
  await page.locator('.bottom-navigation').getByRole('link', { name: 'Calendar' }).click();
  await expect(page.getByRole('heading', { name: 'Appointments, kept local' })).toBeVisible();
  await page.getByRole('button', { name: 'Create event' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create event' });
  await dialog.getByLabel('Title').fill('Offline appointment');
  await dialog.getByLabel('All day').check();
  await dialog.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('button', { name: /Offline appointment/ }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Offline appointment/ }).first()).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Appointments, kept local' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Offline appointment/ }).first()).toBeVisible();
  await context.setOffline(false);
});

test('keeps the calendar month and event dialog contained at large text', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only Phase 3A responsive check');
  await page.goto('/planibly/calendar');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect(page.getByRole('grid')).toBeVisible();
  const overflow = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    return {
      clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((element) => {
          const rectangle = element.getBoundingClientRect();
          return rectangle.right > clientWidth + 1 || rectangle.left < -1;
        })
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
        .slice(0, 10),
    };
  });
  expect(overflow.offenders, JSON.stringify(overflow)).toEqual([]);
  await page.getByRole('button', { name: 'Create event' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create event' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.height ?? 0).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test('persists the primary mobile organisation flow through reload and offline use', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only Phase 1A flow');
  await page.goto(githubPagesBasePath);
  await page.locator('.bottom-navigation').getByRole('link', { name: 'Lists' }).click();
  await expect(page.getByRole('heading', { name: 'Your lists' })).toBeVisible();

  const areas = page.getByRole('region', { name: 'Areas' });
  await areas.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Errands');
  await page
    .getByRole('dialog', { name: 'New area' })
    .getByRole('button', { name: 'Save' })
    .click();
  await expect(areas.getByRole('button', { name: 'Errands', exact: true })).toBeVisible();

  const lists = page.getByRole('region', { name: 'Lists' });
  await lists.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Weekend');
  await page
    .getByRole('dialog', { name: 'New list' })
    .getByRole('button', { name: 'Save' })
    .click();
  await expect(lists.getByRole('button', { name: 'Weekend', exact: true })).toBeVisible();

  await page.locator('.quick-add-fab').click();
  const quickAdd = page.getByRole('dialog', { name: 'Quick Add' });
  await quickAdd.getByRole('textbox', { name: 'Task title' }).fill('Book haircut');
  await quickAdd
    .getByRole('combobox', { name: 'Destination list' })
    .selectOption({ label: 'Errands — Weekend' });
  await quickAdd.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Book haircut', exact: true })).toBeVisible();

  await page.reload();
  await areas.getByRole('button', { name: 'Errands', exact: true }).click();
  await lists.getByRole('button', { name: 'Weekend', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Book haircut', exact: true })).toBeVisible();
  await page.evaluate(async () => navigator.serviceWorker.ready);

  await context.setOffline(true);
  try {
    await page.getByRole('checkbox', { name: 'Complete Book haircut' }).check();
    await expect(
      page.getByRole('checkbox', { name: 'Mark incomplete Book haircut' }),
    ).toBeChecked();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await areas.getByRole('button', { name: 'Errands', exact: true }).click();
    await lists.getByRole('button', { name: 'Weekend', exact: true }).click();
    await expect(
      page.getByRole('checkbox', { name: 'Mark incomplete Book haircut' }),
    ).toBeChecked();
    await page.getByRole('button', { name: 'Clear Completed' }).click();
    await expect(page.getByRole('button', { name: 'Book haircut', exact: true })).toBeHidden();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await areas.getByRole('button', { name: 'Errands', exact: true }).click();
    await lists.getByRole('button', { name: 'Weekend', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Book haircut', exact: true })).toBeHidden();
  } finally {
    await context.setOffline(false);
  }
});

test('persists mobile steps, tags, and blocking through reload and offline use', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only Phase 1B flow');
  await page.goto('/planibly/lists');

  async function quickAdd(title: string) {
    await page.locator('.quick-add-fab').click();
    const quickAddDialog = page.getByRole('dialog', { name: 'Quick Add' });
    await quickAddDialog.getByRole('textbox', { name: 'Task title' }).fill(title);
    await quickAddDialog.getByRole('button', { name: 'Save', exact: true }).click();
  }

  await quickAdd('Pack bag');
  await quickAdd('Leave home');
  await page.getByRole('button', { name: 'Edit Pack bag' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit task' });

  const stepInput = editor.getByRole('textbox', { name: 'New step title' });
  await stepInput.fill('Add charger');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await stepInput.fill('Add keys');
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await editor.getByRole('checkbox', { name: 'Complete Add charger' }).click();
  await expect(editor.getByRole('checkbox', { name: 'Mark incomplete Add charger' })).toBeChecked();

  await editor.getByRole('textbox', { name: 'New tag' }).fill('Out');
  await editor.getByRole('button', { name: 'Create tag' }).click();
  await editor.getByRole('checkbox', { name: 'Out' }).click();
  await expect(editor.getByRole('checkbox', { name: 'Out' })).toBeChecked();

  await editor
    .getByRole('combobox', { name: 'Task that happens after this task' })
    .selectOption({ label: 'Leave home' });
  await editor.getByRole('button', { name: 'Add after' }).click();
  await expect(
    editor.getByRole('heading', { name: 'After this task' }).locator('..'),
  ).toContainText('Leave home');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();

  await expect(page.getByText('1 of 2 steps')).toBeVisible();
  await expect(page.getByText('Out')).toBeVisible();
  await expect(page.getByText('Blocked by Pack bag')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Complete Leave home' })).toBeDisabled();

  await page.reload();
  await expect(page.getByText('1 of 2 steps')).toBeVisible();
  await expect(page.getByText('Out')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Complete Leave home' })).toBeDisabled();
  await page.evaluate(async () => navigator.serviceWorker.ready);

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('1 of 2 steps')).toBeVisible();
    await expect(page.getByText('Out')).toBeVisible();
    await page.getByRole('checkbox', { name: 'Complete Pack bag' }).check();
    await expect(page.getByRole('checkbox', { name: 'Complete Leave home' })).toBeEnabled();
    await page.getByRole('checkbox', { name: 'Mark incomplete Pack bag' }).uncheck();
    await expect(page.getByRole('checkbox', { name: 'Complete Leave home' })).toBeDisabled();
  } finally {
    await context.setOffline(false);
  }
});

test('persists the mobile Phase 1C project, search, undo, and recovery flow offline', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only Phase 1C flow');
  await page.goto('/planibly/lists');
  const areas = page.getByRole('region', { name: 'Areas' });
  const lists = page.getByRole('region', { name: 'Lists' });
  const activeProject = lists.locator('.list-group-label + .entity-list .entity-row', {
    hasText: 'Garden project',
  });
  await areas.getByRole('button', { name: 'Personal', exact: true }).click();
  await lists.getByRole('button', { name: 'Add' }).click();
  const listDialog = page.getByRole('dialog', { name: 'New list' });
  await listDialog.getByRole('textbox', { name: 'Name' }).fill('Garden project');
  await listDialog.getByRole('radio', { name: 'Project' }).check();
  await listDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Garden project' })).toBeVisible();

  await lists.getByRole('button', { name: 'Project details' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'Project details' });
  await projectDialog
    .getByRole('textbox', { name: 'Outcome or description' })
    .fill('A calm place to sit outside');
  await projectDialog.getByLabel('Optional target date').fill('2026-09-15');
  await projectDialog.getByRole('button', { name: 'Save project' }).click();

  async function quickAddToProject(title: string) {
    await page.locator('.quick-add-fab').click();
    const quickAdd = page.getByRole('dialog', { name: 'Quick Add' });
    await quickAdd.getByRole('textbox', { name: 'Task title' }).fill(title);
    await quickAdd
      .getByRole('combobox', { name: 'Destination list' })
      .selectOption({ label: 'Personal — Garden project' });
    await quickAdd.getByRole('button', { name: 'Save', exact: true }).click();
  }

  await quickAddToProject('Sketch garden layout');
  await quickAddToProject('Choose garden bench');
  await expect(page.getByText('0 completed of 2')).toBeVisible();
  await expect(
    page.locator('.project-summary p', { hasText: 'Next available action:' }),
  ).toContainText('Sketch garden layout');
  await page.getByRole('checkbox', { name: 'Complete Sketch garden layout' }).check();
  await expect(page.getByText('1 completed of 2')).toBeVisible();
  await expect(
    page.locator('.project-summary p', { hasText: 'Next available action:' }),
  ).toContainText('Choose garden bench');

  await page.getByRole('button', { name: 'Search' }).click();
  const search = page.getByRole('dialog', { name: 'Search Planibly' });
  await search.getByRole('searchbox', { name: 'Search' }).fill('bench');
  await search.getByRole('button', { name: /Choose garden bench/ }).click();
  const editor = page.getByRole('dialog', { name: 'Edit task' });
  await editor.getByRole('button', { name: 'Delete task' }).click();
  await editor.getByRole('button', { name: 'Confirm delete task' }).click();
  await expect(page.getByText('Choose garden bench moved to Recently Deleted.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();

  await activeProject.click();
  await expect(
    page.getByRole('button', { name: 'Choose garden bench', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit Choose garden bench', exact: true }).click();
  const restoredEditor = page.getByRole('dialog', { name: 'Edit task' });
  await restoredEditor.getByRole('button', { name: 'Delete task' }).click();
  await restoredEditor.getByRole('button', { name: 'Confirm delete task' }).click();
  await lists.getByRole('button', { name: 'Recently Deleted', exact: true }).click();
  const deletedTask = page.locator('.recovery-list li', { hasText: 'Choose garden bench' });
  await expect(deletedTask).toBeVisible();
  await deletedTask.getByRole('button', { name: 'Restore' }).click();
  await activeProject.click();
  await expect(
    page.getByRole('button', { name: 'Choose garden bench', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Archive project' }).click();
  await expect(page.getByText('Garden project archived.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(activeProject).toBeVisible();

  await page.reload();
  await areas.getByRole('button', { name: 'Personal', exact: true }).click();
  await activeProject.click();
  await expect(page.getByText('A calm place to sit outside')).toBeVisible();
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await areas.getByRole('button', { name: 'Personal', exact: true }).click();
    await activeProject.click();
    await expect(page.getByText('A calm place to sit outside')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Choose garden bench', exact: true }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test('keeps the mobile task editor contained and scrollable at 200% text size', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only large-text assertion');
  await page.goto('/planibly/lists');
  await page.locator('.quick-add-fab').click();
  const quickAdd = page.getByRole('dialog', { name: 'Quick Add' });
  await quickAdd.getByRole('textbox', { name: 'Task title' }).fill('Read instructions');
  await quickAdd.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Read instructions' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit task' });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });

  const geometry = await editor.evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const style = getComputedStyle(dialog);
    return {
      bottom: rect.bottom,
      clientHeight: dialog.clientHeight,
      left: rect.left,
      overflowY: style.overflowY,
      right: rect.right,
      scrollHeight: dialog.scrollHeight,
      top: rect.top,
      viewportHeight: innerHeight,
      viewportWidth: innerWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.overflowY).toBe('auto');
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  await editor.getByRole('button', { name: 'Close', exact: true }).scrollIntoViewIfNeeded();
  await expect(editor.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
});

test('persists the mobile Phase 2A plan through reload and offline reopening', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only Phase 2A flow');
  await page.goto('/planibly/plan');
  await expect(page.getByRole('heading', { name: 'Shape time with intention' })).toBeVisible();

  await page.locator('.quick-add-fab').click();
  const quickAdd = page.getByRole('dialog', { name: 'Quick Add' });
  await quickAdd.getByRole('textbox', { name: 'Task title' }).fill('Review tomorrow plan');
  await quickAdd.getByRole('radio', { name: 'Today' }).check();
  await quickAdd.getByRole('button', { name: 'Save', exact: true }).click();

  const todaySection = page.getByRole('region', { name: 'Today' });
  await expect(
    todaySection.getByRole('button', { name: 'Review tomorrow plan', exact: true }),
  ).toBeVisible();
  await todaySection.getByRole('button', { name: 'Review tomorrow plan', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit task' });
  const tomorrow = await page.evaluate(() => {
    const value = new Date();
    value.setDate(value.getDate() + 1);
    return [
      String(value.getFullYear()).padStart(4, '0'),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0'),
    ].join('-');
  });
  await editor.getByLabel('Genuine deadline').fill(tomorrow);
  await editor.getByLabel('Time').selectOption('morning');
  await editor.getByRole('button', { name: '30 min' }).click();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(todaySection.getByText(/Morning/)).toBeVisible();
  await expect(todaySection.getByText(/30 min/)).toBeVisible();

  await page.reload();
  await expect(
    todaySection.getByRole('button', { name: 'Review tomorrow plan', exact: true }),
  ).toBeVisible();
  await expect(todaySection.getByText(/Morning/)).toBeVisible();
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      todaySection.getByRole('button', { name: 'Review tomorrow plan', exact: true }),
    ).toBeVisible();
    await expect(todaySection.getByText(/30 min/)).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test('persists the mobile Phase 2B dashboard through reload and offline reopening', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only Phase 2B flow');
  await page.goto(githubPagesBasePath);
  await expect(page.getByRole('heading', { name: 'A calm view of what matters' })).toBeVisible();

  const quickAddCard = page.getByRole('region', { name: 'Quick Add' });
  await quickAddCard.getByRole('button', { name: 'Add a task' }).click();
  const quickAdd = page.getByRole('dialog', { name: 'Quick Add' });
  await quickAdd.getByRole('textbox', { name: 'Task title' }).fill('Dashboard mobile task');
  await quickAdd.getByRole('radio', { name: 'Today' }).check();
  await quickAdd.getByRole('button', { name: 'Save', exact: true }).click();

  const todayCard = page.getByRole('region', { name: 'Today' });
  await expect(todayCard.getByRole('button', { name: 'Dashboard mobile task' })).toBeVisible();
  await todayCard.getByRole('checkbox', { name: 'Complete Dashboard mobile task' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Recently Completed' })
      .getByRole('button', { name: 'Dashboard mobile task' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Customise dashboard' }).click();
  const customizer = page.getByRole('region', { name: /Editing Overview/ });
  await customizer.getByRole('checkbox', { name: 'Overdue' }).uncheck();
  await customizer.getByLabel('Size for Quick Add').selectOption('wide');
  await customizer.getByRole('button', { name: 'Move Quick Add down' }).click();
  await customizer.getByRole('button', { name: 'Save dashboard' }).click();
  await expect(page.getByLabel('Dashboard layout')).toHaveValue(/.+/);
  await expect(page.getByRole('region', { name: 'Overdue' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('region', { name: 'Overdue' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Quick Add' })).toHaveAttribute(
    'data-card-size',
    'wide',
  );
  await expect(
    page
      .getByRole('region', { name: 'Recently Completed' })
      .getByRole('button', { name: 'Dashboard mobile task' }),
  ).toBeVisible();

  await page.evaluate(async () => navigator.serviceWorker.ready);
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'A calm view of what matters' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Overdue' })).toHaveCount(0);
    await expect(
      page
        .getByRole('region', { name: 'Recently Completed' })
        .getByRole('button', { name: 'Dashboard mobile task' }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test('persists mobile Phase 2C capacity and bulk agenda moves through offline reopening', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only Phase 2C flow');
  await page.goto('/planibly/plan');
  await expect(page.getByRole('heading', { name: 'Shape time with intention' })).toBeVisible();

  for (const title of ['Phase 2C first', 'Phase 2C second']) {
    await page.locator('.quick-add-fab').click();
    const quickAdd = page.getByRole('dialog', { name: 'Quick Add' });
    await quickAdd.getByRole('textbox', { name: 'Task title' }).fill(title);
    await quickAdd.getByRole('radio', { name: 'Today' }).check();
    await quickAdd.getByRole('button', { name: 'Save', exact: true }).click();
  }

  await page.getByText('Adjust capacity').click();
  const weekdayCapacity = page.getByRole('group', { name: 'Weekday default' });
  await weekdayCapacity.getByLabel('Minutes').fill('120');
  await weekdayCapacity.getByRole('button', { name: 'Save default' }).click();
  await expect(page.getByText('2 hrs available')).toBeVisible();

  const horizon = page.getByRole('region', { name: 'Plan the week ahead' });
  await horizon.getByRole('checkbox', { name: 'Select Phase 2C first' }).check();
  await horizon.getByRole('checkbox', { name: 'Select Phase 2C second' }).check();
  const tomorrow = await page.evaluate(() => {
    const value = new Date();
    value.setDate(value.getDate() + 1);
    return [
      String(value.getFullYear()).padStart(4, '0'),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0'),
    ].join('-');
  });
  const selection = page.getByRole('group', { name: 'Selected task actions' });
  await selection.getByLabel('Move to').fill(tomorrow);
  await selection.getByRole('button', { name: 'Move selected' }).click();
  await page.getByLabel('Agenda date', { exact: true }).fill(tomorrow);
  const agenda = page.locator('.agenda-focus');
  await expect(agenda.getByRole('button', { name: 'Phase 2C first', exact: true })).toBeVisible();
  await expect(agenda.getByRole('button', { name: 'Phase 2C second', exact: true })).toBeVisible();

  await page.reload();
  await page.getByLabel('Agenda date', { exact: true }).fill(tomorrow);
  await expect(agenda.getByRole('button', { name: 'Phase 2C first', exact: true })).toBeVisible();
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByLabel('Agenda date', { exact: true }).fill(tomorrow);
    await expect(
      agenda.getByRole('button', { name: 'Phase 2C second', exact: true }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test('Phase 2C plan remains usable at large text without page overflow', async ({ page }) => {
  await page.goto('/planibly/plan');
  await expect(page.getByRole('heading', { name: 'Shape time with intention' })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const overflow = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    return {
      clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .map((element) => {
          const rectangle = element.getBoundingClientRect();
          return {
            element: `${element.tagName.toLowerCase()}.${element.className}`,
            left: Math.round(rectangle.left),
            right: Math.round(rectangle.right),
            width: Math.round(rectangle.width),
          };
        })
        .filter((element) => element.right > clientWidth + 1 || element.left < -1)
        .slice(0, 12),
    };
  });
  expect(overflow.scrollWidth, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
  await expect(page.getByLabel('Agenda date', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Plan the week ahead' })).toBeVisible();
});

test('dashboard cards respond without horizontal overflow at large text', async ({
  page,
}, testInfo) => {
  await page.goto(githubPagesBasePath);
  await expect(page.getByRole('heading', { name: 'A calm view of what matters' })).toBeVisible();

  const widths = await page.locator('.dashboard-card').evaluateAll((cards) => {
    const result: Record<string, number> = {};
    for (const card of cards) {
      const size = card.getAttribute('data-card-size');
      if (size) result[size] = card.getBoundingClientRect().width;
    }
    return result;
  });
  const compactWidth = widths.compact ?? 0;
  const standardWidth = widths.standard ?? 0;
  const wideWidth = widths.wide ?? 0;
  if (testInfo.project.name.includes('desktop')) {
    expect(wideWidth).toBeGreaterThan(standardWidth);
    expect(standardWidth).toBeGreaterThan(compactWidth);
  } else {
    expect(Math.abs(wideWidth - compactWidth)).toBeLessThan(2);
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  await expect(page.getByRole('button', { name: 'Customise dashboard' })).toBeVisible();
});

test('reloads the application shell while offline', async ({ page, context }) => {
  await page.goto(githubPagesBasePath);
  await expect(page.getByRole('heading', { name: 'A calm view of what matters' })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'A calm view of what matters' })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
