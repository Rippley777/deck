import { test, expect, type Page } from './fixtures';

const headerRing = (page: Page) => page.locator('.deck-progress-summary .deck-progress');
async function importStack(page: Page, total: number, completed = 3) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Data', exact: true }).click();
  const workspace = {
    version: 1,
    stacks: [
      {
        id: 'progress-fixture',
        name: 'Progress study',
        icon: '◈',
        color: '#b5a0d5',
        headings: [],
        links: [],
      },
    ],
    tasks: Array.from({ length: total }, (_, i) => ({
      id: `progress-card-${i}`,
      title: `Study card ${i + 1}`,
      stackId: 'progress-fixture',
      order: i,
      completedAt: i < completed ? new Date().toISOString() : null,
      destination: i === total - 1 ? 'someday' : 'anytime',
      deadline: i === completed ? '2000-01-01' : null,
      blockedBy: i === completed ? ['auth'] : [],
    })),
  };
  await page.locator('input[type=file]').setInputFiles({
    name: 'progress.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(workspace)),
  });
  await page.getByRole('button', { name: 'Import workspace', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Import complete');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Progress study stack', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
});

test('one completion updates the exact card segment across Today, its section, and its stack', async ({
  page,
}) => {
  const ring = headerRing(page);
  await expect(ring).toHaveAttribute('aria-valuenow', '2');
  await expect(ring).toHaveAttribute('aria-valuemax', '9');
  await expect(ring.locator('[data-segment]')).toHaveCount(9);
  await page.getByRole('button', { name: 'Complete Deploy Repo Reaper', exact: true }).click();
  await expect(ring.locator('[data-segment="deploy"]')).toHaveAttribute('data-fill', '1');
  await expect(ring).toHaveAttribute('aria-valuenow', '3');
  const section = page
    .locator('.task-section')
    .filter({ has: page.getByRole('heading', { name: 'Focus today', exact: true }) });
  await expect(section.locator('.deck-progress')).toHaveAttribute('aria-valuenow', '2');
  await expect(
    page.getByRole('button', { name: 'Oddware stack', exact: true }).locator('.deck-progress'),
  ).toHaveAttribute('aria-valuenow', '3');
  await page
    .getByRole('button', { name: 'Show incomplete cards in Today’s Deck', exact: true })
    .click();
  await expect(ring).toHaveAttribute('aria-valuemax', '9');
  await expect(ring).toHaveAttribute('aria-valuenow', '3');
  await expect(
    page.getByRole('button', { name: 'Open Deploy Repo Reaper', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(ring).toHaveAttribute('aria-valuenow', '2');
  await expect(ring.locator('[data-segment="deploy"]')).toHaveAttribute('data-fill', '0');
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await expect(ring).toHaveAttribute('aria-valuemax', '9');
});

test('keyboard tooltips, stack navigation, and Graph use the same progress information', async ({
  page,
}) => {
  const stack = page.getByRole('button', { name: 'Oddware stack', exact: true });
  await stack.focus();
  await expect(page.getByRole('tooltip')).toContainText('4 tasks');
  await expect(
    page.getByRole('tooltip').locator('.progress-tooltip-row').filter({ hasText: 'Completed' }),
  ).toContainText('2');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Oddware', exact: true })).toBeVisible();
  await expect(headerRing(page)).toHaveAttribute('aria-valuenow', '2');
  await expect(headerRing(page)).toHaveAttribute('aria-valuemax', '4');
  await page.getByRole('button', { name: 'Show incomplete cards in Oddware', exact: true }).click();
  await expect(headerRing(page)).toHaveAttribute('aria-valuemax', '4');
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  const graph = page.locator('.graph-progress-summary .deck-progress');
  await expect(graph).toHaveAttribute('aria-valuenow', '4');
  await expect(graph).toHaveAttribute('aria-valuemax', '22');
});

test('adaptive rings preserve status and exact counts after importing larger stacks', async ({
  page,
}) => {
  await importStack(page, 13);
  await expect(headerRing(page)).toHaveAttribute('data-mode', 'grouped');
  await expect(headerRing(page).locator('[data-segment]')).toHaveCount(12);
  await expect(headerRing(page)).toHaveAttribute(
    'aria-valuetext',
    '3 of 13 tasks complete. 10 remaining. 1 deferred. 1 blocked. 1 overdue.',
  );
  await expect(headerRing(page).locator('.deck-progress-blocked')).toHaveCount(1);
  await expect(headerRing(page).locator('.deck-progress-overdue')).toHaveCount(1);
  await headerRing(page).hover();
  await expect(page.getByRole('tooltip')).toContainText('Of the remaining cards');
  await page.keyboard.press('Escape');
  await importStack(page, 41);
  await expect(headerRing(page)).toHaveAttribute('data-mode', 'percentage');
  await expect(headerRing(page).locator('[data-segment]')).toHaveCount(24);
  const tiny = page
    .getByRole('button', { name: 'Progress study stack', exact: true })
    .locator('.deck-progress');
  await expect(tiny.locator('[data-segment]')).toHaveCount(12);
  await expect(tiny.locator('text')).toHaveCount(0);
  await expect(headerRing(page)).toHaveAttribute('aria-valuenow', '3');
  await expect(headerRing(page)).toHaveAttribute('aria-valuemax', '41');
});

test('only the final completion briefly joins the ring, and undo reopens it', async ({ page }) => {
  await importStack(page, 2, 1);
  await headerRing(page).evaluate((element) => {
    (window as any).resolves = [];
    new MutationObserver(() => {
      (window as any).resolves.push(element.getAttribute('data-resolving'));
    }).observe(element, { attributes: true, attributeFilter: ['data-resolving'] });
  });
  await page.getByRole('button', { name: 'Complete Study card 2', exact: true }).click();
  await expect(headerRing(page)).toHaveAttribute('data-cleared', 'true');
  await expect.poll(() => page.evaluate(() => (window as any).resolves)).toContain('true');
  await expect(headerRing(page)).toHaveAttribute('data-resolving', 'false');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(headerRing(page)).toHaveAttribute('data-cleared', 'false');
  await expect(headerRing(page)).toHaveAttribute('aria-valuenow', '1');
});

test('reduced motion, light theme, empty states, and mobile retain accessible progress', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await importStack(page, 0, 0);
  await expect(headerRing(page)).toHaveAttribute('aria-valuetext', 'No tasks yet');
  await expect(headerRing(page)).toHaveAttribute('data-cleared', 'false');
  await importStack(page, 2, 1);
  await page.getByRole('button', { name: 'Complete Study card 2', exact: true }).click();
  await expect(headerRing(page)).toHaveAttribute('data-resolving', 'false');
  expect(
    await headerRing(page)
      .locator('.deck-progress-fill')
      .first()
      .evaluate((e) => getComputedStyle(e).transitionDuration),
  ).toBe('0s');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Daylight', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('button', { name: 'Show incomplete cards in Progress study', exact: true })
    .focus();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  const box = await tooltip.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
