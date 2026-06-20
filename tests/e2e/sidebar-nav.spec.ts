import { expect, test } from '@playwright/test';

const navCases = [
  { label: '新建分析任务', path: '/workspace', title: '多 Agent 主流程' },
  { label: '数据源管理', path: '/data-sources', title: '数据源管理' },
  { label: '模板库', path: '/templates', title: '模板库' },
  { label: '异步工作台沙箱', path: '/workspace-async', title: '异步工作台沙箱' },
  { label: '历史任务', path: '/history', title: '历史任务' },
];

test('sidebar navigation switches routes immediately', async ({ page }) => {
  await page.goto('/workspace');
  await page.waitForLoadState('networkidle');

  for (const item of navCases) {
    await page.getByRole('link', { name: item.label }).click();
    await expect(page).toHaveURL(new RegExp(`${item.path.replace('/', '\\/')}$`));
    await expect(page.getByRole('heading', { level: 2, name: item.title })).toBeVisible();
  }
});
