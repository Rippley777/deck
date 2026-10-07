import { test, expect, type Page } from '@playwright/test';
import { emptyDeck } from '../../../shared/sync';
import { defaultSettings, type DeckData } from '../../../src/types';
import { makeTask } from '../../../src/lib/seed';

async function mockCloud(page: Page, initial = emptyDeck(defaultSettings)) {
  let signedIn: { id: string; name: string; email: string; emailVerified: boolean } | null = null;
  const decks = new Map<string, { version: number; data: DeckData }>();
  const uploads: { uid: string; data: DeckData }[] = [];
  decks.set('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', {
    version: initial.tasks.length ? 3 : 0,
    data: initial,
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const body = route.request().postDataJSON();
    const respond = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path.endsWith('/config')) return respond({ google: true, entra: false, email: true });
    if (path.endsWith('/get-session'))
      return respond(
        signedIn
          ? {
              user: signedIn,
              session: {
                id: 'session',
                token: 'session-token',
                userId: signedIn.id,
                expiresAt: new Date(Date.now() + 86400000).toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }
          : null,
      );
    if (path.endsWith('/sign-in/email')) {
      signedIn = {
        id: body.email.startsWith('b')
          ? 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
          : 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        name: 'Deck User',
        email: body.email,
        emailVerified: true,
      };
      return respond({ user: signedIn, token: 'session-token', redirect: false });
    }
    if (path.endsWith('/sign-out')) {
      signedIn = null;
      return respond({ success: true });
    }
    if (path.endsWith('/sign-up/email'))
      return respond({
        token: null,
        user: { id: 'new-user', name: body.name, email: body.email, emailVerified: false },
      });
    if (path.endsWith('/sync')) {
      if (!signedIn) return respond({ error: 'Sign in' }, 401);
      const current = decks.get(signedIn.id) || { data: emptyDeck(defaultSettings), version: 0 };
      if (route.request().method() === 'POST') {
        uploads.push({ uid: signedIn.id, data: body.data });
        const next = { data: body.data, version: current.version + 1 };
        decks.set(signedIn.id, next);
        return respond(next);
      }
      return respond({ ...current, updated_at: '2026-10-03T10:00:00Z' });
    }
    if (
      path.endsWith('/devices') ||
      path.endsWith('/history') ||
      path.endsWith('/list-sessions') ||
      path.endsWith('/list-accounts')
    )
      return respond([]);
    return respond({ success: true });
  });
  return { uploads };
}
async function signin(page: Page, email = 'a@example.test') {
  await page.getByRole('button', { name: 'Account and sync settings' }).click();
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('long-test-password');
  await page.getByRole('button', { name: 'Continue with Email', exact: true }).click();
}
async function localTask(page: Page, title: string) {
  await page.getByRole('heading', { name: 'Today’s Deck' }).waitFor();
  await page.keyboard.press('Control+n');
  await page.getByRole('textbox', { name: 'New task' }).fill(`${title} today`);
  await page.getByRole('textbox', { name: 'New task' }).press('Enter');
}
test('the portal starts locally with no account prompt and sign-in has a Not now action', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Nothing on deck.' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Account and sync settings' }).click();
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take your Deck anywhere' })).toBeVisible();
  await page.screenshot({ path: 'test-results/optional-sign-in.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Take your Deck anywhere' })).toHaveCount(0);
});
test('email sign-in asks before uploading local content and sign-out keeps it by default', async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.goto('/app');
  await localTask(page, 'My private task');
  await signin(page);
  await expect(page.getByRole('heading', { name: 'Back up this Deck?' })).toBeVisible();
  expect(cloud.uploads).toHaveLength(0);
  await page.getByRole('button', { name: 'Sync This Deck' }).click();
  await expect(page.getByText('Synced', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account and sync settings' })).toContainText(
    'Synced',
  );
  expect(cloud.uploads[0].data.tasks[0].title).toBe('My private task');
  await page.getByRole('button', { name: 'Account and sync settings' }).click();
  await page.getByRole('button', { name: 'Sign out of Deck', exact: true }).click();
  await expect(page.getByLabel('Keep data on this device', { exact: false })).toBeChecked();
  await page.getByRole('button', { name: 'Keep data and sign out' }).click();
  await expect(
    page.getByRole('button', { name: 'Open My private task', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Open My private task', exact: true }),
  ).toBeVisible();
});
test('a new device offers cloud restoration without replacing data before confirmation', async ({
  page,
}) => {
  const initial = {
    ...emptyDeck(defaultSettings),
    tasks: [makeTask('From my other device', { scheduled: new Date().toISOString().slice(0, 10) })],
  };
  const cloud = await mockCloud(page, initial);
  await page.goto('/app');
  await signin(page);
  await expect(page.getByRole('heading', { name: 'Restore your Deck' })).toBeVisible();
  expect(cloud.uploads).toHaveLength(0);
  await page.getByRole('button', { name: 'Restore and Sync' }).click();
  await expect(
    page.getByRole('button', { name: 'Open From my other device', exact: true }),
  ).toBeVisible();
});
test('different accounts require separate local profiles and never upload the previous account’s tasks', async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.goto('/app');
  await localTask(page, 'Only account A');
  await signin(page);
  await page.getByRole('button', { name: 'Sync This Deck' }).click();
  await expect(page.getByText('Synced', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account and sync settings' })).toContainText(
    'Synced',
  );
  await page.getByRole('button', { name: 'Account and sync settings' }).click();
  await page.getByRole('button', { name: 'Sign out of Deck', exact: true }).click();
  await page.getByRole('button', { name: 'Keep data and sign out' }).click();
  await signin(page, 'b@example.test');
  await expect(
    page.getByRole('heading', { name: 'This Deck belongs to another account' }),
  ).toBeVisible();
  expect(cloud.uploads.filter((v) => v.uid.startsWith('b'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Switch to this account’s Deck' }).click();
  await expect(page.getByRole('heading', { name: 'Nothing on deck.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account and sync settings' })).toContainText(
    'Synced',
  );
  expect(
    cloud.uploads.filter((v) => v.uid.startsWith('b')).every((v) => v.data.tasks.length === 0),
  ).toBe(true);
});
