import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
  await page.getByRole('button', { name: 'Oddware stack', exact: true }).click();
});

test('delete a stack heading keeps its cards, supports undo, and persists', async ({ page }) => {
  const section = (name: string) =>
    page.locator('.task-section').filter({
      has: page.getByRole('heading', { name, exact: true }),
    });
  const development = section('Development');
  const card = page.getByRole('button', { name: 'Open Deploy Repo Reaper', exact: true });
  await card.dragTo(development);
  await expect(
    development.getByRole('button', { name: 'Open Deploy Repo Reaper', exact: true }),
  ).toBeVisible();
  await page.getByRole('heading', { name: 'Development', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Heading actions' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Delete heading', exact: true }).click();
  await expect(development).not.toBeVisible();
  await expect(
    section('Cards').getByRole('button', { name: 'Open Deploy Repo Reaper', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Launch', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    development.getByRole('button', { name: 'Open Deploy Repo Reaper', exact: true }),
  ).toBeVisible();
  await page.getByRole('heading', { name: 'Development', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete heading', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
  await page.getByRole('button', { name: 'Oddware stack', exact: true }).click();
  await expect(development).not.toBeVisible();
  await expect(
    section('Cards').getByRole('button', { name: 'Open Deploy Repo Reaper', exact: true }),
  ).toBeVisible();
});

test('heading context menu supports keyboard access and dismissing without deletion', async ({
  page,
}) => {
  const heading = page.getByRole('heading', { name: 'Launch', exact: true });
  const button = page.locator('.section-heading button').filter({ has: heading });
  await button.focus();
  await button.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Heading actions' });
  await expect(menu).toBeVisible();
  const action = page.getByRole('menuitem', { name: 'Delete heading', exact: true });
  await expect(action).toBeFocused();
  await action.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(button).toBeFocused();
  await expect(heading).toBeVisible();
  await button.press('Shift+F10');
  await action.press('Enter');
  await expect(heading).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cards', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(heading).toBeVisible();
});
