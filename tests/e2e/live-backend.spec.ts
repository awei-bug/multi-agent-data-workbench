import { expect, test } from '@playwright/test';

test('async workspace talks to the live PostgreSQL backend', async ({ page, request }) => {
  await request.post('http://127.0.0.1:8787/api/active-task/reset');

  await page.goto('/workspace-async');
  await page.waitForLoadState('networkidle');

  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Async Workspace Sandbox' })).toBeVisible();

  await page.getByRole('button', { name: 'Load Active Task' }).click();
  await expect(page.locator('.summary-card').nth(1)).toContainText('Current Workspace Session');

  await page.locator('#async-summary').fill('Live PostgreSQL E2E summary');
  await page.getByRole('button', { name: 'Update Summary' }).click();
  await expect(page.getByText('Live PostgreSQL E2E summary').first()).toBeVisible();

  await page.locator('.workspace-grid > section').nth(5).locator('button').first().click();
  await expect(page.locator('.workflow-node-running')).toHaveCount(1);

  await page.getByRole('button', { name: 'Save To History' }).click();
  await expect.poll(async () => await page.locator('.topbar-task-meta').innerText()).toContain('running');
});
