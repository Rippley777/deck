import { test, expect } from './fixtures';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
});
test('new stack previews checked items and persists generated dependencies and recent use', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Create stack', exact: true }).click();
  await page.getByPlaceholder('A project, a place, a part of life…').fill('Template launch');
  await page.getByRole('button', { name: /Start from template/ }).click();
  await page.getByRole('button', { name: /Software Project From an empty/ }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Template launch');
  await page.getByRole('button', { name: 'Clear All', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create stack', exact: true })).toBeDisabled();
  await page.getByLabel('Create repository for Template launch', { exact: false }).check();
  await page.getByLabel('Initialize project', { exact: false }).check();
  await page.getByRole('button', { name: 'Create stack', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Template launch', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Create README', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Open Initialize project', exact: true }).click();
  await expect(page.locator('.detail-panel')).toContainText(
    'Create repository for Template launch',
  );
  await page.getByRole('button', { name: 'Close task details', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await page.keyboard.press('Control+Shift+n');
  await expect(page.getByRole('heading', { name: 'New from template', exact: true })).toBeVisible();
  await expect(page.locator('.template-card').first()).toContainText('Software Project');
  await expect(page.locator('.template-card').first()).toContainText('Recently used');
});
test('provider choices create only the matching deployment tasks', async ({ page }) => {
  await page.keyboard.press('Control+Shift+n');
  await page.getByLabel('Search templates').fill('app dep');
  await page.getByRole('button', { name: /App Deployment A short/ }).click();
  await page.getByLabel('Project name').fill('Cloud launch');
  await page.getByLabel('Deployment provider').selectOption('Cloudflare');
  await expect(page.locator('.template-item-preview')).not.toContainText('Azure');
  await expect(page.locator('.template-selection-bar')).toContainText('5 of 5 selected');
  await page.getByRole('button', { name: 'Create stack', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cloud launch', exact: true })).toBeVisible();
  await expect(page.locator('.task-row')).toHaveCount(5);
  await expect(
    page.getByRole('button', { name: 'Open Create Cloudflare project', exact: true }),
  ).toBeVisible();
});
test('task templates produce editable child cards and context menus insert checklists', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Add card ⌘ N' }).click();
  await page.getByRole('textbox', { name: 'New task', exact: true }).fill('Launch a small app');
  await page.getByRole('button', { name: /Start from template/ }).click();
  await page.getByRole('button', { name: /App Launch The last/ }).click();
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue(
    'Launch a small app',
  );
  await expect(page.locator('.detail-child-cards .checklist-row')).toHaveCount(12);
  await page.getByRole('button', { name: 'Close task details', exact: true }).click();
  await page
    .getByRole('button', { name: 'Open Deploy Repo Reaper', exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Insert checklist from template' }).click();
  await page.getByRole('button', { name: /Deploy Checklist A reusable/ }).click();
  await page.getByRole('button', { name: 'Clear All', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Check logs Checklist item', exact: true }).check();
  await page.getByRole('button', { name: 'Insert checklist', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue(
    'Deploy Repo Reaper',
  );
  await expect(page.getByRole('button', { name: 'Toggle Check logs', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Toggle Publish the release', exact: true }),
  ).toBeVisible();
});
test('library builder, duplicate, reorder, export, import, and delete survive reload', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'New template', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Quiet routine');
  await page.getByLabel('Search stack icons').fill('coffee');
  await page.getByRole('button', { name: 'Stack icon Coffee', exact: true }).click();
  await page.getByLabel('Stack color hex').fill('#83a9be');
  await page
    .getByRole('combobox', { name: 'Template type', exact: true })
    .selectOption('checklist');
  await page.getByRole('button', { name: 'Remove variable Project name', exact: true }).click();
  await page.getByLabel('Generated title', { exact: true }).fill('Weekly review');
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByLabel('Item 1 title', { exact: true }).fill('Review this week');
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByLabel('Item 2 title', { exact: true }).fill('Plan next week');
  await page.getByRole('button', { name: 'Move item 2 up', exact: true }).click();
  await expect(page.getByLabel('Item 1 title', { exact: true })).toHaveValue('Plan next week');
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await page.getByRole('button', { name: 'Favorite Quiet routine', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Quiet routine', exact: true }).click();
  const exported = await download;
  const path = await exported.path();
  await page.locator('.templates-modal input[type=file]').setInputFiles(path!);
  await expect(page.getByRole('status')).toContainText('1 template imported');
  await expect(page.locator('.template-card').filter({ hasText: 'Quiet routine' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete Quiet routine', exact: true }).last().click();
  await page.getByRole('button', { name: 'Duplicate Quiet routine template', exact: true }).click();
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await page.getByRole('button', { name: 'Move Quiet routine (copy) up', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Unfavorite Quiet routine', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Customize Quiet routine', exact: true }).click();
  await expect(page.locator('.stack-icon-current svg.lucide-coffee')).toBeVisible();
  await expect(page.getByLabel('Stack color hex')).toHaveValue('#83a9be');
  await expect(page.getByLabel('Item 1 title', { exact: true })).toHaveValue('Plan next week');
});
test('save stack from context menu and mobile picker fit the viewport', async ({ page }) => {
  await page.getByRole('button', { name: 'Oddware stack', exact: true }).focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Save stack as template', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Oddware');
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press('Control+Shift+n');
  await page.getByRole('button', { name: /Software Project From an empty/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const modal = await page.locator('.templates-modal').boundingBox();
  expect(modal!.x).toBeGreaterThanOrEqual(0);
  expect(modal!.x + modal!.width).toBeLessThanOrEqual(390);
});
