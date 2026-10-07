import { test, expect } from '@playwright/test';

test('a new Deck opens empty, works without an account, and persists on reload', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nothing on deck.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/local-first-desktop.png', animations: 'disabled' });
  await expect(page.locator('.task-row')).toHaveCount(0);
  await expect(page.getByText('No Stacks yet.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account and sync settings' })).toContainText(
    'Local only',
  );
  for (const view of ['Inbox', 'On Deck', 'Anytime', 'Someday', 'Logbook']) {
    await page.getByRole('button', { name: view, exact: true }).first().click();
    await expect(page.locator('.task-row')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No templates yet.' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add Task', exact: true }).click();
  await page.getByRole('textbox', { name: 'New task' }).fill('My first task today @important');
  await page.getByRole('textbox', { name: 'New task' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Open My first task', exact: true })).toBeVisible();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open My first task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Complete My first task', exact: true }).click();
  await page.getByRole('button', { name: 'Logbook', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open My first task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Account and sync settings' }).click();
  await expect(
    page.getByText('You’re currently using Deck locally. Your data is stored only on this device.'),
  ).toBeVisible();
});

test('separate local profiles preserve their own tasks and backups', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('heading', { name: 'Today’s Deck' }).waitFor();
  await page.keyboard.press('Control+n');
  await page.getByRole('textbox', { name: 'New task' }).fill('Default profile task today');
  await page.getByRole('textbox', { name: 'New task' }).press('Enter');
  await page.getByRole('button', { name: 'Account and sync settings' }).click();
  await page.getByRole('button', { name: 'Create a separate local profile' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing on deck.' })).toBeVisible();
  await page.keyboard.press('Control+n');
  await page.getByRole('textbox', { name: 'New task' }).fill('Separate profile task today');
  await page.getByRole('textbox', { name: 'New task' }).press('Enter');
  await page.getByRole('button', { name: 'Account and sync settings' }).click();
  await page.getByRole('button', { name: 'Default Deck', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open Default profile task', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open Separate profile task', exact: true }),
  ).toHaveCount(0);
});
