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

test('reloads the application shell while offline', async ({ page, context }) => {
  await page.goto(githubPagesBasePath);
  await expect(page.getByRole('heading', { name: 'Make room for what matters.' })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Make room for what matters.' })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
