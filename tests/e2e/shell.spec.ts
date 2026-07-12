import { expect, test } from '@playwright/test';

test('exposes an installable manifest', async ({ page, request }) => {
  await page.goto('/');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();

  const response = await request.get(manifestHref!);
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    name: string;
    display: string;
    icons: { purpose?: string }[];
  };
  expect(manifest.name).toBe('Planibly');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
});

test('uses side navigation on a wider screen', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('desktop'), 'Desktop-only layout assertion');
  await page.goto('/');
  await expect(page.locator('.side-navigation')).toBeVisible();
  await expect(page.locator('.bottom-navigation')).toBeHidden();
  await page.getByRole('link', { name: 'Plan', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Shape time with intention' })).toBeVisible();
});

test('uses bottom navigation on a mobile viewport', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only layout assertion');
  await page.goto('/');
  await expect(page.locator('.bottom-navigation')).toBeVisible();
  await expect(page.locator('.side-navigation')).toBeHidden();
  await page.locator('.bottom-navigation').getByRole('link', { name: 'Lists' }).click();
  await expect(page.getByRole('heading', { name: 'Keep life gently organised' })).toBeVisible();
});

test('reloads the application shell while offline', async ({ page, context }) => {
  await page.goto('/');
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
