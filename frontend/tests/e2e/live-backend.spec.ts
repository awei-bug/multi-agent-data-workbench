import { expect, test } from '@playwright/test';

import { installFakeAuthSession } from './auth';

test('data-source page renders its safe empty state', async ({ page }) => {
  await installFakeAuthSession(page);
  await page.goto('/data-sources');
  await expect(page.getByRole('heading', { name: '数据源管理', level: 2 })).toBeVisible();
  await expect(page.getByText('上传文件', { exact: true })).toBeVisible();
});
