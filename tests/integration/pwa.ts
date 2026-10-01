// Requires VITE_DECK_PORTAL=true build served by the API at localhost:3001, with APP_URL matching.
import { chromium } from '@playwright/test';
if (!process.env.DATABASE_URL?.includes('deck_test'))
  throw new Error('Use a disposable deck_test database');
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const email = (
  await pool.query(
    'SELECT email FROM "user" WHERE name=$1 AND "emailVerified"=true ORDER BY "createdAt" DESC LIMIT 1',
    ['bob'],
  )
).rows[0].email;
await pool.end();
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const title = `PWA offline ${Date.now()}`;
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:3001/app');
await page.getByLabel('Email', { exact: true }).fill(email);
await page.getByLabel('Password', { exact: true }).fill('Correct-horse-deck-2026!');
await page.getByRole('button', { name: 'Open my Deck' }).click();
await page.getByRole('button', { name: 'Connect & merge safely' }).click();
await page.getByText('Synced', { exact: true }).waitFor();
await page.evaluate(async () => {
  await navigator.serviceWorker.ready;
});
await page.reload();
await page.getByRole('heading', { name: 'Today’s Deck' }).waitFor();
await context.setOffline(true);
await page.reload();
await page.getByRole('heading', { name: 'Today’s Deck' }).waitFor();
await page.getByRole('button', { name: 'Quick add card' }).click();
await page.getByRole('textbox', { name: 'New task' }).fill(title + ' today');
await page.getByRole('textbox', { name: 'New task' }).press('Enter');
await page.getByText('Offline', { exact: true }).waitFor();
await page.reload();
await page.getByRole('button', { name: `Open ${title}`, exact: true }).waitFor();
await context.setOffline(false);
await page.getByText('Synced', { exact: true }).waitFor({ timeout: 20000 });
if (errors.length) throw new Error(errors.join('\n'));
console.log(
  'PASS: built PWA shell reloads offline, retains a new offline task across another reload, and synchronizes when reconnected.',
);
await browser.close();
