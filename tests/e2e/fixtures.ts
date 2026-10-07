import { test as base, expect } from '@playwright/test';
// Existing behavior tests explicitly load their fixture through Vite. Production
// initialization has no seed branch or test hook.
export const test = base.extend<{ demoWorkspace: void }>({
  demoWorkspace: [
    async ({ page }, use) => {
      await page.goto('/');
      await page.getByRole('heading', { name: 'Today’s Deck' }).waitFor();
      await page.evaluate(async () => {
        const path = '/src/stores/deck.ts';
        const { useDeck, flushPersistence } = await import(/* @vite-ignore */ path);
        const seeds = '/src/lib/seed.ts';
        const { seedData } = await import(/* @vite-ignore */ seeds);
        const presets = '/src/lib/template-presets.ts';
        const { builtinTemplates } = await import(/* @vite-ignore */ presets);
        useDeck.getState().commit({ ...seedData(), templates: builtinTemplates() });
        await flushPersistence();
      });
      await use();
    },
    { auto: true },
  ],
});
export { expect };
export type { Page } from '@playwright/test';
