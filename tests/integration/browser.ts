// Run after the API integration test, with the portal and API running locally.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
if (!process.env.DATABASE_URL?.includes('deck_test'))
  throw new Error('Use a disposable deck_test database');
await mkdir('test-results/portal', { recursive: true });
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const email = (
  await pool.query(
    'SELECT email FROM "user" WHERE name=$1 AND "emailVerified"=true ORDER BY "createdAt" DESC LIMIT 1',
    ['bob'],
  )
).rows[0].email;
await pool.query(
  'DELETE FROM deck_workspaces WHERE user_id=(SELECT id FROM "user" WHERE email=$1)',
  [email],
);
await pool.query(
  'DELETE FROM deck_revisions WHERE user_id=(SELECT id FROM "user" WHERE email=$1)',
  [email],
);
await pool.end();
const browser = await chromium.launch();
const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await desktop.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:1432/app');
await page.getByRole('heading', { name: 'Welcome back.' }).waitFor();
await page.screenshot({ path: 'test-results/portal/signin-desktop.png', fullPage: true });
await page.getByLabel('Email', { exact: true }).fill(email);
await page.getByLabel('Password', { exact: true }).fill('Correct-horse-deck-2026!');
await page.getByRole('button', { name: 'Open my Deck' }).click();
await page.getByRole('button', { name: 'Connect & merge safely' }).click();
await page.getByText('Synced', { exact: true }).waitFor();
await page.keyboard.press('Control+n');
await page.getByRole('textbox', { name: 'New task' }).fill('Phone test tomorrow');
await page.getByRole('textbox', { name: 'New task' }).press('Enter');
await page.getByText('Synced', { exact: true }).waitFor();
await page.screenshot({ path: 'test-results/portal/desktop-app.png', fullPage: true });
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const phone = await mobile.newPage();
phone.on('pageerror', (e) => errors.push(e.message));
await phone.goto('http://localhost:1432/app');
await phone.getByRole('heading', { name: 'Welcome back.' }).waitFor();
await phone.screenshot({ path: 'test-results/portal/signin-mobile.png', fullPage: true });
await phone.getByLabel('Email', { exact: true }).fill(email);
await phone.getByLabel('Password', { exact: true }).fill('Correct-horse-deck-2026!');
await phone.getByRole('button', { name: 'Open my Deck' }).click();
await phone.getByRole('button', { name: 'Connect & merge safely' }).click();
await phone.getByText('Synced', { exact: true }).waitFor();
await phone
  .getByRole('navigation', { name: 'Main navigation' })
  .getByRole('button', { name: 'On Deck', exact: true })
  .click();
await phone.getByRole('button', { name: 'Open Phone test', exact: true }).waitFor();
await phone.getByRole('button', { name: 'Quick add card' }).click();
await phone.getByRole('textbox', { name: 'New task' }).fill('Mobile capture today');
await phone.getByRole('textbox', { name: 'New task' }).press('Enter');
await phone
  .getByRole('navigation', { name: 'Main navigation' })
  .getByRole('button', { name: 'Today', exact: true })
  .click();
await phone.getByRole('button', { name: 'Open Mobile capture', exact: true }).waitFor();
await phone.screenshot({ path: 'test-results/portal/mobile-app.png', fullPage: true });
await page
  .getByRole('button', { name: 'Open Mobile capture', exact: true })
  .waitFor({ timeout: 20000 });
await mobile.setOffline(true);
await phone.getByRole('button', { name: 'Quick add card' }).click();
await phone.getByRole('textbox', { name: 'New task' }).fill('Offline capture today');
await phone.getByRole('textbox', { name: 'New task' }).press('Enter');
await phone.getByRole('button', { name: 'Open Offline capture', exact: true }).waitFor();
await mobile.setOffline(false);
await page
  .getByRole('button', { name: 'Open Offline capture', exact: true })
  .waitFor({ timeout: 20000 });
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth);
if (overflow) throw new Error('Mobile layout overflows horizontally');
if (errors.length) throw new Error(errors.join('\n'));
console.log(
  'PASS: desktop/mobile sign-in, two-browser automatic sync, quick add, offline edits and reconnection; no UI errors or mobile overflow.',
);
const secondTab = await desktop.newPage();
await secondTab.goto('http://localhost:1432/app');
await secondTab.getByText('Synced', { exact: true }).waitFor();
await desktop.setOffline(true);
for (const [tab, title] of [
  [page, 'Tab one offline'],
  [secondTab, 'Tab two offline'],
] as const) {
  await tab.keyboard.press('Control+n');
  await tab.getByRole('textbox', { name: 'New task' }).fill(title + ' today');
  await tab.getByRole('textbox', { name: 'New task' }).press('Enter');
  await tab.getByText('Offline', { exact: true }).waitFor();
}
await page.close();
await secondTab.close();
await desktop.setOffline(false);
const recovered = await desktop.newPage();
await recovered.goto('http://localhost:1432/app');
await recovered.getByRole('button', { name: 'Open Tab one offline', exact: true }).waitFor();
await recovered.getByRole('button', { name: 'Open Tab two offline', exact: true }).waitFor();
console.log('PASS: offline changes in separate tabs survive closing both tabs and reopening.');
await browser.close();
