import { test, expect } from './fixtures';

for (const width of [1440, 390]) {
  test(`bulk delete stays accessible while scrolling at ${width}px`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Today', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles({
      name: 'bulk-scroll.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          stacks: [
            {
              id: 'bulk-scroll',
              name: 'Bulk scroll',
              icon: '▱',
              color: '#b5a0d5',
              headings: [],
              links: [],
            },
          ],
          tasks: Array.from({ length: 45 }, (_, i) => ({
            id: `bulk-card-${i}`,
            title: `Bulk card ${i + 1}`,
            stackId: 'bulk-scroll',
            order: i,
            destination: 'anytime',
          })),
        }),
      ),
    });
    await page.getByRole('button', { name: 'Import workspace', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Import complete');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Bulk scroll stack', exact: true }).click();
    await page.setViewportSize({ width, height: 844 });
    const complete = page.getByRole('button', { name: 'Complete Bulk card 1', exact: true });
    await expect(complete).toHaveCSS('border-radius', '50%');
    await page.getByRole('checkbox', { name: 'Select Bulk card 1', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Select Bulk card 2', exact: true }).check();
    const scroll = page.locator('.workspace-scroll');
    await scroll.evaluate((element) => {
      element.scrollTop = 900;
    });
    const toolbar = page.locator('.bulk-toolbar');
    await expect
      .poll(async () => {
        const top = (await scroll.boundingBox())!.y;
        return Math.abs((await toolbar.boundingBox())!.y - top);
      })
      .toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.getByRole('button', { name: 'Delete 2 selected cards', exact: true }).click();
    await expect(toolbar).not.toBeVisible();
    await scroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(page.getByRole('button', { name: 'Open Bulk card 1', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: 'Open Bulk card 2', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: 'Open Bulk card 3', exact: true })).toBeVisible();
  });
}
