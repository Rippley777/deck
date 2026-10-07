import { test, expect } from './fixtures';

for (const entry of ['stack menu', 'section quick add', 'global picker'] as const) {
  test(`task template added from ${entry} gets a top-level stack heading`, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
    if (entry === 'global picker') {
      await page.keyboard.press('Control+Shift+n');
    } else {
      await page.getByRole('button', { name: 'Oddware stack', exact: true }).click();
      if (entry === 'stack menu') {
        await page
          .getByRole('button', { name: 'Oddware stack', exact: true })
          .click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'New card from template', exact: true }).click();
      } else {
        await page.getByRole('button', { name: 'Add task to Cards', exact: true }).click();
        await page.getByRole('button', { name: /Start from template/ }).click();
      }
    }
    await page.getByLabel('Search templates').fill('New Feature');
    await page.locator('.template-card-main').filter({ hasText: 'New Feature' }).click();
    await page.getByLabel('Project name').fill('Header test');
    await page.getByLabel('Template task title').fill('Feature section');
    await page.getByLabel('Template destination stack').selectOption('oddware');
    await page.getByRole('button', { name: 'Add to stack', exact: true }).click();
    await page.getByRole('button', { name: 'Close task details', exact: true }).click();
    const section = page.locator('.task-section').filter({
      has: page.getByRole('heading', { name: 'Feature section', exact: true }),
    });
    await expect(section).toBeVisible();
    await expect(section.locator('.task-row')).toHaveCount(10);
    await expect(
      section.getByRole('button', { name: 'Open Define requirements', exact: true }),
    ).toBeVisible();
    const defaultSection = page.locator('.task-section').filter({
      has: page.getByRole('heading', { name: 'Cards', exact: true }),
    });
    await expect(
      defaultSection.getByRole('button', { name: 'Open Define requirements', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText('All changes saved')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
    await page.getByRole('button', { name: 'Oddware stack', exact: true }).click();
    await expect(section.locator('.task-row')).toHaveCount(10);
  });
}

test('stack template can be added to an existing stack from the global picker', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
  await page.keyboard.press('Control+Shift+n');
  await page.getByLabel('Search templates').fill('Software Project');
  await page.locator('.template-card-main').filter({ hasText: 'Software Project' }).click();
  await page.getByLabel('Project name').fill('Existing project');
  await page.getByLabel('Template destination stack').selectOption('oddware');
  await page.getByRole('button', { name: 'Add to stack', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Oddware', exact: true })).toBeVisible();
  const section = page.locator('.task-section').filter({
    has: page.getByRole('heading', { name: 'Existing project', exact: true }),
  });
  await expect(
    section.getByRole('button', {
      name: 'Open Create repository for Existing project',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Infrastructure', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Existing project stack', exact: true }),
  ).toHaveCount(0);
});
