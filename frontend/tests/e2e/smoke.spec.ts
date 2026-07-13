import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { authHeaders, installAuthSession, registerE2ESession } from './auth';

const root = path.dirname(fileURLToPath(import.meta.url));
const fixtureCsv = path.resolve(root, 'fixtures/sales-mvp.csv');

test('hard path: upload -> run -> export -> history', async ({ page, request }) => {
  const session = await registerE2ESession(request);
  await installAuthSession(page, session);
  await request.post('http://127.0.0.1:8787/api/active-task/reset', {
    headers: authHeaders(session),
  });

  await page.goto('/data-sources');
  await page.setInputFiles('input[type="file"]', fixtureCsv);
  await expect(page.getByText('sales-mvp.csv').first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: '用于新分析' }).first().click();
  await expect(page.getByText('已绑定 sales-mvp.csv')).toBeVisible({ timeout: 15000 });

  await page.goto('/workspace/input');
  await page.locator('#analysis-request').fill('按区域汇总销售额并输出管理层简报');
  await page.getByRole('button', { name: '解析意图' }).click();
  await expect(page.getByText('需求已解析')).toBeVisible({ timeout: 20000 });

  await page.goto('/workspace/execution');
  await page.getByRole('button', { name: '启动任务' }).click();
  await expect(page.getByText(/工作流已结束|已完成|等待人工复核/)).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('metric_result')).toBeVisible();

  await page.goto('/workspace/output');
  await page.getByRole('button', { name: '导出 Markdown' }).first().click();
  await expect(page.getByText(/已生成真实导出文件|导出前请先完成工作流审核/)).toBeVisible({ timeout: 20000 });

  await page.getByRole('button', { name: '保存为模板' }).first().click();
  await expect(page.getByText('当前任务已保存为模板。')).toBeVisible({ timeout: 15000 });

  const saveHistory = await request.post('http://127.0.0.1:8787/api/history/save-active-task', {
    headers: authHeaders(session),
  });
  expect(saveHistory.ok()).toBeTruthy();

  await page.goto('/history');
  await expect(page.getByRole('heading', { name: '最近任务', level: 3 })).toBeVisible();
  await expect(page.locator('.history-card').first()).toBeVisible({ timeout: 15000 });
});
