import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
});

test('create and edit stack appearance, keep the selected preview, and persist valid colors', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Create stack', exact: true }).click();
  await page.getByPlaceholder('A project, a place, a part of life…').fill('Garden plans');
  const picker = page.locator('.stack-icon-picker');
  await expect(picker.locator('.stack-icon-current svg.lucide-layers')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Stack icon Layers', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Search stack icons').fill('flower');
  const flower = page.getByRole('button', { name: 'Stack icon Flower', exact: true });
  await expect(flower.locator('svg')).toBeVisible();
  await flower.click();
  await page.getByRole('button', { name: 'Stack color #91b49a', exact: true }).click();
  await expect(flower).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Search stack icons').fill('');
  await page.getByLabel('Stack icon category').selectOption('Projects');
  await expect(picker.locator('.stack-icon-current svg.lucide-flower')).toBeVisible();
  await expect(picker.locator('.stack-icon-current svg')).toHaveCSS('color', 'rgb(145, 180, 154)');
  await page.getByRole('dialog').getByRole('button', { name: 'Create stack', exact: true }).click();
  const stack = page.getByRole('button', { name: 'Garden plans stack', exact: true });
  await expect(stack.locator('svg.lucide-flower')).toBeVisible();
  await expect(stack.locator('svg.lucide-flower')).toHaveCSS('color', 'rgb(145, 180, 154)');
  await page.getByRole('button', { name: 'Edit stack', exact: true }).click();
  await page.getByLabel('Search stack icons').fill('bike');
  await page.getByRole('button', { name: 'Stack icon Bike', exact: true }).click();
  const hex = page.getByLabel('Stack color hex');
  await hex.fill('123ABC');
  await hex.press('Tab');
  await expect(hex).toHaveValue('#123abc');
  await expect(picker.locator('.stack-icon-current svg.lucide-bike')).toHaveCSS(
    'color',
    'rgb(18, 58, 188)',
  );
  await hex.fill('#12');
  await hex.press('Tab');
  await expect(hex).toHaveValue('#123abc');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload();
  await expect(stack.locator('svg.lucide-bike')).toBeVisible();
  await expect(stack.locator('svg.lucide-bike')).toHaveCSS('color', 'rgb(18, 58, 188)');
  await stack.click();
  await expect(page.locator('.page-eyebrow svg.lucide-bike')).toBeVisible();
  await page.getByRole('button', { name: 'Edit stack', exact: true }).click();
  await expect(hex).toHaveValue('#123abc');
});

test('all icon groups load and the picker fits a narrow screen in both themes', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Oddware stack', exact: true }).click();
  await page.getByRole('button', { name: 'Edit stack', exact: true }).click();
  await expect(page.locator('.stack-icon-current .stack-glyph-fallback')).toBeVisible();
  await page.getByRole('button', { name: /Show more icons/ }).click();
  await page.getByRole('button', { name: /Show more icons/ }).click();
  await expect(page.locator('.stack-icon-grid button svg')).toHaveCount(429);
  await page.getByLabel('Search stack icons').fill('no-such-icon');
  await expect(page.getByText('No icons match that search.')).toBeVisible();
  await page.getByLabel('Search stack icons').fill('');
  await page.getByLabel('Stack icon category').selectOption('Home & life');
  const bike = page.getByRole('button', { name: 'Stack icon Bike', exact: true });
  await bike.focus();
  await page.keyboard.press('Enter');
  await expect(bike).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(page.getByLabel('Stack color hex')).toBeVisible();
    expect(
      await page.locator('.modal').evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    const swatch = page.locator('.stack-color-swatches button').last();
    await swatch.click();
    await expect(swatch).toHaveAttribute('aria-pressed', 'true');
  }
});
