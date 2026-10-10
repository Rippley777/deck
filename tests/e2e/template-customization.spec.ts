import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Today’s Deck' })).toBeVisible();
  await page.keyboard.press('Control+Shift+n');
});

test('customize from a preview, preserve setup, persist changes, and keep created cards independent', async ({
  page,
}) => {
  await page.getByRole('button', { name: /Software Project From an empty/ }).click();
  await page.getByLabel('Project name', { exact: false }).fill('Custom workflow');
  await page.getByLabel('Template stack name').fill('Keep this title');
  await page.getByRole('button', { name: 'Clear All', exact: true }).click();
  await page.getByRole('checkbox', { name: /Create repository for Custom workflow/ }).check();
  await page.getByRole('button', { name: 'Customize template', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('My software starter');
  await page.getByLabel('Description', { exact: true }).fill('A small personal workflow.');
  await page
    .getByLabel('Item 1 title', { exact: true })
    .fill('Create private repository for {{project_name}}');
  await page.getByLabel('Default', { exact: true }).fill('Default project');
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page
    .getByRole('textbox', { name: /^Item \d+ title$/ })
    .last()
    .fill('Write the project journal');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'My software starter', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Project name', { exact: false })).toHaveValue('Custom workflow');
  await expect(page.getByLabel('Template stack name')).toHaveValue('Keep this title');
  await expect(
    page.getByRole('checkbox', { name: /^Create private repository for Custom workflow/ }),
  ).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Initialize project/ })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Write the project journal/ })).toBeChecked();
  await page.getByRole('button', { name: 'Create stack', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep this title', exact: true })).toBeVisible();
  await expect(page.locator('.task-row')).toHaveCount(2);
  await expect(
    page.getByRole('button', {
      name: 'Open Create private repository for Custom workflow',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'Customize My software starter', exact: true }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
    'A small personal workflow.',
  );
  await expect(page.getByLabel('Item 1 title', { exact: true })).toHaveValue(
    'Create private repository for {{project_name}}',
  );
  await expect(page.getByLabel('Default', { exact: true })).toHaveValue('Default project');
  await page.getByLabel('Item 1 title', { exact: true }).fill('A new first step');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Keep this title stack', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: 'Open Create private repository for Custom workflow',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open A new first step', exact: true }),
  ).toHaveCount(0);
});

test('save a customized copy, leave the original intact, and discard canceled edits', async ({
  page,
}) => {
  await page.getByRole('button', { name: /Software Project From an empty/ }).click();
  await page.getByLabel('Project name', { exact: false }).fill('Copy project');
  await page.getByRole('button', { name: 'Customize template', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save as copy', exact: true }).click();
  await expect(page.locator('.template-builder')).toBeVisible();
  expect(
    await page
      .getByLabel('Name', { exact: true })
      .evaluate((element) => (element as HTMLInputElement).validity.valid),
  ).toBe(false);
  await page.getByLabel('Name', { exact: true }).fill('Software Project');
  await page.getByLabel('Search stack icons').fill('coffee');
  await page.getByRole('button', { name: 'Stack icon Coffee', exact: true }).click();
  await page.getByLabel('Stack color hex').fill('#91b49a');
  await page.getByLabel('Item 1 title', { exact: true }).fill('Plan the first release');
  await page.getByRole('button', { name: 'Save as copy', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Software Project (copy)', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Project name', { exact: false })).toHaveValue('Copy project');
  await expect(page.locator('.template-preview-title svg.lucide-coffee')).toHaveCSS(
    'color',
    'rgb(145, 180, 154)',
  );
  await page.getByRole('button', { name: 'All templates', exact: true }).click();
  await page.getByRole('button', { name: /Software Project From an empty/ }).click();
  await expect(page.getByRole('checkbox', { name: /^Create repository for/ })).toBeVisible();
  await page.getByLabel('Project name', { exact: false }).fill('Retain this value');
  await page.getByRole('button', { name: 'Clear All', exact: true }).click();
  await page.getByRole('button', { name: 'Customize template', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Discard this edit');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Software Project', exact: true })).toBeVisible();
  await expect(page.getByLabel('Project name', { exact: false })).toHaveValue('Retain this value');
  await expect(page.locator('.template-selection-bar')).toContainText('0 of');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Customize Software Project', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Customize Discard this edit', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Customize Software Project (copy)', exact: true })
    .click();
  await expect(page.getByLabel('Item 1 title', { exact: true })).toHaveValue(
    'Plan the first release',
  );
  await expect(page.getByLabel('Stack color hex')).toHaveValue('#91b49a');
});

test('customize directly from the picker and use the editor on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Customize Deploy Checklist', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Customize template', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('My deploy checklist');
  await page.getByLabel('Item 1 title', { exact: true }).fill('Run the release checks');
  await page.getByLabel('Include item 2 by default').uncheck();
  await page.getByRole('button', { name: 'Remove item 3', exact: true }).click();
  expect(
    await page
      .locator('.templates-modal')
      .evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'My deploy checklist', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Run the release checks/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Build production/ })).not.toBeChecked();
});

test('customized template appearance carries through the new-stack flow', async ({ page }) => {
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Create stack', exact: true }).click();
  await page.getByPlaceholder('A project, a place, a part of life…').fill('Custom launch');
  await page.getByRole('button', { name: /Start from template/ }).click();
  await page.getByRole('button', { name: /Software Project From an empty/ }).click();
  await page.getByRole('button', { name: 'Customize template', exact: true }).click();
  await page.getByLabel('Search stack icons').fill('flower');
  await page.getByRole('button', { name: 'Stack icon Flower', exact: true }).click();
  await page.getByLabel('Stack color hex').fill('#91b49a');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('.template-preview-title svg.lucide-flower')).toHaveCSS(
    'color',
    'rgb(145, 180, 154)',
  );
  await page.getByRole('button', { name: 'Create stack', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Custom launch', exact: true })).toBeVisible();
  const glyph = page
    .getByRole('button', { name: 'Custom launch stack', exact: true })
    .locator('svg.lucide-flower');
  await expect(glyph).toBeVisible();
  await expect(glyph).toHaveCSS('color', 'rgb(145, 180, 154)');
});
