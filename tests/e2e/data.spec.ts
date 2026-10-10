import { test, expect } from './fixtures';
test('a recurring completion creates exactly one next occurrence and undo removes it', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await page.getByRole('button', { name: 'Open Water the plants', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Complete Water the plants', exact: true }).click();
  await page.getByRole('button', { name: 'On Deck', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open Water the plants', exact: true }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open Water the plants', exact: true }),
  ).toHaveCount(0);
});
test('restore a SQLite backup and preserve a before-restore snapshot', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Today’s Deck' }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Backups', exact: true }).click();
  await page.getByRole('button', { name: 'Back up now', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('fresh backup');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.keyboard.press('Control+n');
  await page.getByRole('textbox', { name: 'New task' }).fill('Only after the snapshot');
  await page.getByRole('textbox', { name: 'New task' }).press('Enter');
  await expect(
    page.getByRole('button', { name: 'Open Only after the snapshot', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Backups', exact: true }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click();
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Workspace restored');
  await expect(page.locator('.backup-list')).toContainText('before-restore.db');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open Only after the snapshot', exact: true }),
  ).toHaveCount(0);
  const header = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('deck-local');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const r = db.transaction('files').objectStore('files').get('deck.db');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return new TextDecoder().decode(bytes.slice(0, 15));
  });
  expect(header).toBe('SQLite format 3');
});
test('link suggestions and dependency validation are reflected in a local graph', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await page.getByRole('button', { name: 'Open Deploy Repo Reaper', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Task notes', exact: true })
    .fill('Make room for [[Order');
  await page
    .locator('.wiki-picker')
    .getByRole('button', { name: /Order groceries/ })
    .click();
  await expect(page.getByRole('textbox', { name: 'Task notes', exact: true })).toHaveValue(
    'Make room for [[Order groceries]] ',
  );
  await page.getByRole('button', { name: 'Open local graph', exact: true }).first().click();
  await expect(page.locator('.graph-focus-pill')).toContainText('Deploy Repo Reaper');
  await expect(page.locator('.graph-canvas canvas').first()).toBeVisible();
  await page.waitForFunction(() => !document.querySelector('.layout-status'));
  const count = await page
    .locator('.graph-canvas')
    .evaluate((e: any) => e._cyreg.cy.nodes().length);
  expect(count).toBeLessThan(15);
  await page.getByLabel('Relationship depth').selectOption('3');
  await page.waitForFunction(() => !document.querySelector('.layout-status'));
  const expanded = await page
    .locator('.graph-canvas')
    .evaluate((e: any) => e._cyreg.cy.nodes().length);
  expect(expanded).toBeGreaterThan(count);
});
