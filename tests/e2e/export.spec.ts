import { readFile } from 'node:fs/promises';
import Papa from 'papaparse';
import { test, expect } from './fixtures';

const emptyStack = {
  id: 'export-empty',
  name: 'Empty, "future" stack 🧭',
  icon: 'lucide:Archive',
  color: '#abcdef',
  notes: 'No cards yet.\nKeep the details.',
  deadline: '2026-12-31',
  headings: ['First, "steps"'],
  links: ['oddware'],
};
const completedCard = {
  id: 'export-unstacked',
  title: 'Completed, "unstacked" card 🧭',
  notes: 'First line\nSecond line, with "quotes".',
  tags: ['work;design', 'café'],
  completedAt: '2026-10-03T12:00:00.000Z',
  checklist: [{ id: 'export-check', title: 'Keep, "checklist"', done: true }],
  links: ['export-empty'],
};

for (const format of ['json', 'csv'] as const) {
  test(`${format.toUpperCase()} downloads every stack and card and can be reimported`, async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
    await page.getByRole('button', { name: 'Oddware stack', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await page.locator('.settings-modal input[type=file]').setInputFiles({
      name: 'export-fixture.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({ version: 1, stacks: [emptyStack], tasks: [completedCard] }),
      ),
    });
    await page.getByRole('button', { name: 'Import workspace', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Import complete');
    await expect(page.locator('.settings-content')).toContainText(
      'Export all 6 stacks and 23 cards',
    );

    const pendingDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: format.toUpperCase(), exact: true }).click();
    const download = await pendingDownload;
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^deck-\\d{4}-\\d{2}-\\d{2}\\.${format}$`),
    );
    const path = await download.path();
    const content = await readFile(path!, 'utf8');

    if (format === 'json') {
      const exported = JSON.parse(content);
      expect(exported.stacks).toHaveLength(6);
      expect(exported.tasks).toHaveLength(23);
      expect(exported.stacks.find((stack: { id: string }) => stack.id === emptyStack.id)).toEqual(
        emptyStack,
      );
      expect(
        exported.tasks.find((card: { id: string }) => card.id === completedCard.id),
      ).toMatchObject({
        ...completedCard,
        stackId: null,
      });
    } else {
      const parsed = Papa.parse<Record<string, string>>(content, { header: true });
      expect(parsed.errors).toEqual([]);
      expect(parsed.data.filter((row) => row.recordType === 'stack')).toHaveLength(6);
      expect(parsed.data.filter((row) => row.recordType === 'card')).toHaveLength(23);
      const stack = parsed.data.find((row) => row.id === emptyStack.id)!;
      expect(stack).toMatchObject({
        recordType: 'stack',
        name: emptyStack.name,
        notes: emptyStack.notes,
        deadline: emptyStack.deadline,
        icon: emptyStack.icon,
        color: emptyStack.color,
      });
      expect(JSON.parse(stack.headings)).toEqual(emptyStack.headings);
      expect(JSON.parse(stack.links)).toEqual(emptyStack.links);
      const card = parsed.data.find((row) => row.id === completedCard.id)!;
      expect(card).toMatchObject({
        recordType: 'card',
        title: completedCard.title,
        notes: completedCard.notes,
        completedAt: completedCard.completedAt,
        stackId: '',
      });
      expect(JSON.parse(card.tags)).toEqual(completedCard.tags);
      expect(JSON.parse(card.checklist)).toEqual(completedCard.checklist);
    }

    await page.locator('.settings-modal input[type=file]').setInputFiles({
      name: download.suggestedFilename(),
      mimeType: format === 'json' ? 'application/json' : 'text/csv',
      buffer: Buffer.from(content),
    });
    await expect(page.locator('.import-preview')).toContainText('23 cards in 6 stacks');
    await page.getByRole('button', { name: 'Import workspace', exact: true }).click();
    await expect(page.locator('.import-preview')).not.toBeVisible();
    const pendingJson = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    const json = await pendingJson;
    const restored = JSON.parse(await readFile((await json.path())!, 'utf8'));
    expect(restored.stacks).toHaveLength(6);
    expect(restored.tasks).toHaveLength(23);
    expect(restored.stacks.find((stack: { id: string }) => stack.id === emptyStack.id)).toEqual(
      emptyStack,
    );
    expect(
      restored.tasks.find((card: { id: string }) => card.id === completedCard.id),
    ).toMatchObject({
      ...completedCard,
      stackId: null,
    });
  });
}
