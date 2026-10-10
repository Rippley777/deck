import { test, expect } from './fixtures';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
});
test('checkbox selection deletes multiple cards with undo and persists deletion', async ({
  page,
}) => {
  const first = page.getByRole('checkbox', { name: 'Select Call insurance', exact: true });
  const second = page.getByRole('checkbox', { name: 'Select Deploy Repo Reaper', exact: true });
  await first.check();
  await second.focus();
  await second.press('Space');
  await expect(second).toBeChecked();
  await expect(page.locator('.bulk-toolbar')).toContainText('2 selected');
  await expect(page.getByRole('textbox', { name: 'Task title' })).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Complete Deploy Repo Reaper', exact: true }),
  ).toBeVisible();
  await first.uncheck();
  await expect(page.locator('.bulk-toolbar')).toContainText('1 selected');
  await first.check();
  await page.getByRole('button', { name: 'Delete 2 selected cards', exact: true }).click();
  await expect(first).not.toBeVisible();
  await expect(second).not.toBeVisible();
  await expect(page.locator('.bulk-toolbar')).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open Order groceries', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect(first).not.toBeChecked();
  await first.check();
  await second.check();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(first).not.toBeChecked();
  await expect(second).not.toBeChecked();
  await first.check();
  await second.check();
  await page.getByRole('button', { name: 'Delete 2 selected cards', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
  await expect(first).not.toBeVisible();
  await expect(second).not.toBeVisible();
});
test('capture, edit, checklist, complete, undo, and persist a card', async ({ page }) => {
  await page.getByRole('button', { name: 'Add card ⌘ N' }).click();
  await page
    .getByRole('textbox', { name: 'New task' })
    .fill('Prepare launch notes #Oddware @writing');
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  const card = page.getByRole('button', { name: 'Open Prepare launch notes', exact: true });
  await expect(card).toBeVisible();
  await card.click();
  await page
    .getByRole('textbox', { name: 'Task notes', exact: true })
    .fill('Remember the **release checklist**.');
  await page.getByRole('textbox', { name: 'Add checklist item' }).fill('Read it once more');
  await page.getByRole('textbox', { name: 'Add checklist item' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Toggle Read it once more' })).toBeVisible();
  await page.getByRole('button', { name: 'Close task details' }).click();
  await page.getByRole('button', { name: 'Complete Prepare launch notes', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Reopen Prepare launch notes', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Complete Prepare launch notes', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await expect(
    page.getByRole('button', { name: 'Open Prepare launch notes', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open Prepare launch notes', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Task notes', exact: true })).toHaveValue(
    'Remember the **release checklist**.',
  );
  await expect(page.getByRole('button', { name: 'Toggle Read it once more' })).toBeVisible();
});
test('quick add natural language, search, and planning', async ({ page }) => {
  await page.keyboard.press('Control+n');
  await page
    .getByRole('textbox', { name: 'New task' })
    .fill('Schedule review tomorrow at 3pm #Work @planning');
  await expect(page.locator('.parsed-metadata')).toContainText('Tomorrow');
  await page.getByRole('textbox', { name: 'New task' }).press('Enter');
  await page.getByRole('button', { name: 'On Deck', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open Schedule review', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Control+k');
  await page
    .getByRole('textbox', { name: 'Search tasks and commands' })
    .fill('tag:planning project:Work');
  await page
    .locator('.command-results')
    .getByRole('button', { name: /Schedule review/ })
    .click();
  await expect(page.getByRole('textbox', { name: 'Task title' })).toHaveValue('Schedule review');
  await page.getByRole('button', { name: 'Close task details' }).click();
  await page
    .getByRole('button', { name: /^Today/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Deal your day', exact: true }).click();
  await page
    .locator('.planning-item')
    .filter({ hasText: 'Schedule review' })
    .getByRole('button', { name: 'Add to Deck' })
    .click();
  await page.getByRole('button', { name: 'That feels right' }).click();
  await expect(
    page.getByRole('button', { name: 'Open Schedule review', exact: true }),
  ).toBeVisible();
});
test('graph layouts, filters, and local navigation share task data', async ({ page }) => {
  await page.getByRole('button', { name: 'Graph' }).click();
  await expect(page.getByRole('heading', { name: 'Your work, connected.' })).toBeVisible();
  await expect(page.locator('.graph-canvas canvas').first()).toBeVisible();
  for (const layout of ['Hierarchy', 'Radial', 'Timeline', 'Force']) {
    await page.getByRole('button', { name: layout, exact: true }).click();
    await expect(page.getByRole('button', { name: layout, exact: true })).toHaveClass('selected');
  }
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Filter graph by stack').selectOption('deck');
  await expect(page.locator('.graph-footer')).toContainText('nodes');
  await page.getByLabel('Search graph nodes').fill('Explore graph');
  await page.getByLabel('Search graph nodes').press('Enter');
  await expect(page.locator('.graph-focus-pill')).toContainText('Explore graph interactions');
  await page.getByRole('button', { name: 'Clear graph focus' }).click();
  await page
    .getByRole('button', { name: /^Today/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Open Deploy Repo Reaper', exact: true }).click();
  await page.getByRole('button', { name: 'Open local graph', exact: true }).first().click();
  await expect(page.locator('.graph-focus-pill')).toContainText('Deploy Repo Reaper');
});
test('create a stack and move a card by dragging', async ({ page }) => {
  await page.getByRole('button', { name: 'Create stack', exact: true }).click();
  await page.getByPlaceholder('A project, a place, a part of life…').fill('Quiet projects');
  await page.getByRole('button', { name: 'Create stack', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Quiet projects' })).toBeVisible();
  await page
    .getByRole('button', { name: /^Today/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Open Call insurance', exact: true })
    .dragTo(
      page
        .getByRole('navigation', { name: 'Stacks' })
        .getByRole('button', { name: 'Quiet projects stack', exact: true }),
    );
  await page
    .getByRole('navigation', { name: 'Stacks' })
    .getByRole('button', { name: 'Quiet projects stack', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Open Call insurance', exact: true }),
  ).toBeVisible();
});
test('theme, export, backups, and narrow screen', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Daylight', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^deck-.*\.json$/);
  await page.getByRole('button', { name: 'Backups', exact: true }).click();
  await page.getByRole('button', { name: 'Back up now', exact: true }).click();
  await expect(page.locator('.backup-list')).toContainText('.db');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
