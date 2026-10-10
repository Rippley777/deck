import { test, expect, type Page } from '@playwright/test';
import type { Repository, RepositorySnapshot, CommandSnapshot } from '../../shared/command-center';
const date = new Date().toISOString();
const repositories: Repository[] = ['Deck', 'Pit Boss', 'Shuffle'].map((name, i) => ({
  id: String(i + 1),
  owner: 'fixture-user',
  name,
  url: `https://github.com/fixture-user/project-${i + 1}`,
  defaultBranch: 'main',
  description: 'Fixture project',
  language: 'TypeScript',
  topics: [],
  visibility: i === 1 ? 'private' : 'public',
  archived: false,
  pushedAt: date,
}));
function synced(repository: Repository): RepositorySnapshot {
  return {
    repository,
    work:
      repository.id === '3'
        ? [
            {
              id: '3:workflow:1',
              provider: 'github',
              repositoryId: '3',
              type: 'workflow',
              title: 'Build failed',
              url: repository.url + '/actions/runs/1',
              state: 'failure',
              assignees: [],
              createdAt: date,
              updatedAt: date,
              syncedAt: date,
              defaultBranch: true,
            },
            {
              id: '3:issue:1',
              provider: 'github',
              repositoryId: '3',
              type: 'issue',
              title: 'Repair build',
              url: repository.url + '/issues/1',
              state: 'open',
              assignees: ['fixture-user'],
              createdAt: date,
              updatedAt: date,
              syncedAt: date,
              priority: 'high',
            },
          ]
        : [],
    activity: [
      {
        id: `${repository.id}:commit:abc`,
        repositoryId: repository.id,
        type: 'commit',
        title: 'Progress committed',
        url: repository.url + '/commit/abc',
        occurredAt: date,
      },
    ],
    status: 'ready',
    lastSuccess: date,
    lastAttempt: date,
  };
}
async function account(page: Page) {
  await page.evaluate(async () => {
    const module = '/src/lib/cloud.ts';
    const { useCloud } = await import(/* @vite-ignore */ module);
    useCloud.setState({
      user: { id: 'fixture-account', name: 'Fixture user', email: 'fixture@example.test' },
    });
  });
}
async function mock(page: Page) {
  let snapshots: RepositorySnapshot[] = [];
  await page.route('**/api/v1/command-center**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const respond = (value: unknown) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    const snapshot: () => CommandSnapshot = () => ({
      configured: true,
      connected: true,
      login: 'fixture-user',
      repositories: snapshots,
    });
    if (path.endsWith('/repositories')) return respond(repositories);
    if (path.endsWith('/import')) {
      const ids = route.request().postDataJSON().repositoryIds as string[];
      snapshots = Array.from(
        new Map(
          [...snapshots, ...repositories.filter((r) => ids.includes(r.id)).map(synced)].map((s) => [
            s.repository.id,
            s,
          ]),
        ).values(),
      );
    }
    return respond(snapshot());
  });
}
test('opens locally with an accessible empty state and preserves task management', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Command Center', exact: true })).toBeVisible();
  await expect(page.getByText('Give your next project a place on deck.')).toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
  await page.getByRole('button', { name: 'Command Center', exact: true }).click();
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'New task' })).toBeFocused();
});
test('imports three repositories, explains urgency, drills down, persists and refuses unsupported Pit Boss execution', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mock(page);
  await page.goto('/');
  await account(page);
  await page.getByRole('button', { name: 'Import repositories', exact: true }).click();
  await page.getByRole('button', { name: 'Discover accessible repositories' }).click();
  for (const repo of repositories)
    await page
      .getByRole('combobox', { name: `Import ${repo.name}`, exact: true })
      .selectOption('new');
  await page.getByRole('button', { name: 'Import selected repositories' }).click();
  await expect(
    page.getByText('Repositories linked. Initial synchronization is queued.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(async () => {
    const module = '/src/stores/deck.ts';
    const { useDeck } = await import(/* @vite-ignore */ module);
    useDeck
      .getState()
      .addTask('Overdue release', { stackId: 'github:3', deadline: '2000-01-01', priority: 3 });
  });
  const focus = page.locator('.cc-focus-list');
  await expect(focus.locator('li').first()).toContainText('Shuffle');
  await expect(focus.locator('li').first()).toContainText('55 points');
  await expect(focus.getByRole('link', { name: 'Investigate failing workflow' })).toHaveAttribute(
    'href',
    /actions\/runs\/1$/,
  );
  const card = page
    .locator('.cc-card')
    .filter({ has: page.getByRole('button', { name: 'Shuffle', exact: true }) });
  await card.getByRole('button', { name: '1GitHub issues' }).click();
  await expect(page.getByRole('link', { name: 'Repair build' })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Link Repair build' })
    .selectOption({ label: 'Overdue release' });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(focus.locator('li').first()).toContainText('45 points');
  await card.getByRole('button', { name: 'Health & settings' }).click();
  await page.getByLabel('Pit Boss project ID').fill('pit-project-3');
  await page.getByLabel('Configured action references').fill('test: Test');
  await page.getByRole('button', { name: 'Save Pit Boss link' }).click();
  await expect(page.getByText('Execution unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('combobox', { name: 'Sort projects' }).selectOption('name');
  await expect(page.locator('.cc-card').first()).toContainText('Deck');
  await page.screenshot({ path: 'test-results/command-center-desktop.png' });
  await page.reload();
  await account(page);
  await expect(page.locator('.cc-card')).toHaveCount(3);
  await expect(page.getByRole('combobox', { name: 'Sort projects' })).toHaveValue('name');
  await page.getByRole('button', { name: 'Import repositories', exact: true }).click();
  await page.getByRole('button', { name: 'Discover accessible repositories' }).click();
  for (const repo of repositories)
    await page
      .getByRole('combobox', { name: `Import ${repo.name}`, exact: true })
      .selectOption(`github:${repo.id}`);
  await page.getByRole('button', { name: 'Import selected repositories' }).click();
  await expect(
    page.getByText('Repositories linked. Initial synchronization is queued.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.cc-card')).toHaveCount(3);
  await expect(page.locator('.cc-timeline li')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Today’s Focus' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/command-center-mobile.png' });
  expect(errors).toEqual([]);
});
test('shows loading, integration errors, and clears private snapshots after account changes', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/api/v1/command-center', async (route) => {
    await gate;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        configured: true,
        connected: true,
        login: 'fixture-user',
        repositories: [synced(repositories[0])],
      }),
    });
  });
  await page.goto('/');
  await account(page);
  await expect(page.getByRole('status').filter({ hasText: 'Loading GitHub status' })).toBeVisible();
  release();
  await expect(page.locator('.cc-timeline li')).toHaveCount(1);
  await page.evaluate(async () => {
    const module = '/src/lib/cloud.ts';
    const { useCloud } = await import(/* @vite-ignore */ module);
    useCloud.setState({ user: null });
  });
  await expect(page.locator('.cc-timeline li')).toHaveCount(0);
  await page.unroute('**/api/v1/command-center');
  await page.route('**/api/v1/command-center', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'GitHub authorization revoked. Reconnect.' }),
    }),
  );
  await account(page);
  await expect(page.getByRole('alert')).toContainText('revoked');
  await expect(page.getByRole('button', { name: 'Create task', exact: true })).toBeEnabled();
});
