import { expect, test, type Page } from '@playwright/test';

type NavigationGeometry = {
  bodyScrollWidth: number;
  iconSizes: {
    height: number;
    heightAttribute: string | null;
    width: number;
    widthAttribute: string | null;
  }[];
  links: {
    bottom: number;
    iconBottom: number;
    iconRight: number;
    iconTop: number;
    iconLeft: number;
    left: number;
    right: number;
    top: number;
  }[];
  navigationWidth: number;
  viewportWidth: number;
};

async function readNavigationGeometry(
  page: Page,
  navigationSelector: string,
): Promise<NavigationGeometry> {
  return page.locator(navigationSelector).evaluate((navigation) => {
    const links = Array.from(navigation.querySelectorAll('.navigation-link'));
    const icons = Array.from(navigation.querySelectorAll('svg.icon'));

    return {
      bodyScrollWidth: document.documentElement.scrollWidth,
      iconSizes: icons.map((icon) => {
        const rect = icon.getBoundingClientRect();
        return {
          height: rect.height,
          heightAttribute: icon.getAttribute('height'),
          width: rect.width,
          widthAttribute: icon.getAttribute('width'),
        };
      }),
      links: links.map((link) => {
        const linkRect = link.getBoundingClientRect();
        const icon = link.querySelector<SVGElement>('svg.icon');
        if (!icon) throw new Error('Navigation link is missing its icon.');
        const iconRect = icon.getBoundingClientRect();
        return {
          bottom: linkRect.bottom,
          iconBottom: iconRect.bottom,
          iconLeft: iconRect.left,
          iconRight: iconRect.right,
          iconTop: iconRect.top,
          left: linkRect.left,
          right: linkRect.right,
          top: linkRect.top,
        };
      }),
      navigationWidth: navigation.getBoundingClientRect().width,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
}

function expectContainedNavigation(geometry: NavigationGeometry, maximumIconSize: number) {
  expect(geometry.iconSizes).toHaveLength(5);
  for (const icon of geometry.iconSizes) {
    expect(icon.widthAttribute).toBe('24');
    expect(icon.heightAttribute).toBe('24');
    expect(icon.width).toBeGreaterThan(0);
    expect(icon.width).toBeLessThanOrEqual(maximumIconSize);
    expect(icon.height).toBeGreaterThan(0);
    expect(icon.height).toBeLessThanOrEqual(maximumIconSize);
  }
  for (const link of geometry.links) {
    expect(link.iconLeft).toBeGreaterThanOrEqual(link.left);
    expect(link.iconRight).toBeLessThanOrEqual(link.right);
    expect(link.iconTop).toBeGreaterThanOrEqual(link.top);
    expect(link.iconBottom).toBeLessThanOrEqual(link.bottom);
  }
  expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.navigationWidth).toBeLessThanOrEqual(geometry.viewportWidth);
}

test('development CSS bounds navigation icons on desktop and mobile', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const isMobile = testInfo.project.name.includes('mobile');
  const navigationSelector = isMobile ? '.bottom-navigation' : '.side-navigation';
  const hiddenSelector = isMobile ? '.side-navigation' : '.bottom-navigation';

  await expect(page.locator(navigationSelector)).toBeVisible();
  await expect(page.locator(hiddenSelector)).toBeHidden();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 247, 244)');

  const geometry = await readNavigationGeometry(page, navigationSelector);
  expectContainedNavigation(geometry, 24);
});

test('navigation remains contained at 200% text size', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });

  const isMobile = testInfo.project.name.includes('mobile');
  const navigationSelector = isMobile ? '.bottom-navigation' : '.side-navigation';
  const geometry = await readNavigationGeometry(page, navigationSelector);

  expect(await page.locator('html').evaluate((element) => getComputedStyle(element).fontSize)).toBe(
    '32px',
  );
  expectContainedNavigation(geometry, 48);
});
