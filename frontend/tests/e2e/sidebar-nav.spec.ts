import { expect, test } from '@playwright/test';

import { installFakeAuthSession } from './auth';

const navigation = [
  ['总览', '/dashboard', '总览仪表盘'],
  ['输入准备', '/workspace/input', '输入准备'],
  ['执行监控', '/workspace/execution', '执行监控'],
  ['报告交付', '/workspace/output', '报告交付'],
  ['数据源', '/data-sources', '数据源管理'],
  ['数据洞察', '/chat-analysis', '数据洞察'],
  ['报告中心', '/reports', '报告中心'],
  ['历史任务', '/history', '历史任务'],
  ['模板库', '/templates', '模板库'],
  ['设置', '/settings', '系统设置'],
] as const;

test('sidebar navigation exposes every delivered MVP page', async ({ page }) => {
  await installFakeAuthSession(page);
  await page.goto('/dashboard');
  for (const [label, path, heading] of navigation) {
    await page.getByRole('link', { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
    await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible();
  }
});

test('retired async workspace path redirects to canonical workspace', async ({ page }) => {
  await installFakeAuthSession(page);
  await page.goto('/workspace-async');
  await expect(page).toHaveURL(/\/workspace\/execution$/);
  await expect(page.getByRole('heading', { name: '执行监控', level: 2 })).toBeVisible();
});
