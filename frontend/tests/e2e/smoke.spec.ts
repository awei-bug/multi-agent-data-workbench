import { expect, test } from '@playwright/test';

const gotoWorkspace = async (page: any) => {
  await page.goto('/workspace');
  await page.waitForLoadState('networkidle');
};

const gotoAsyncWorkspace = async (page: any) => {
  await page.goto('/workspace-async');
  await page.waitForLoadState('networkidle');
};

const gotoHistory = async (page: any) => {
  await page.goto('/history');
  await page.waitForLoadState('networkidle');
};

const gotoTemplates = async (page: any) => {
  await page.goto('/templates');
  await page.waitForLoadState('networkidle');
};

const navToWorkspace = (page: any) => page.locator('a[href="/workspace"]').first();
const syncLoadButton = (page: any) => page.locator('.history-detail-panel .actions-row button').first();
const asyncLoadButton = (page: any) => page.locator('.history-detail-panel .actions-row button').nth(1);
const replaySection = (page: any) => page.locator('section[aria-label]').first();
const timelineButtons = (page: any) => page.locator('.workspace-grid > section').nth(5).locator('button');
const exportButtons = (page: any) => page.locator('.workspace-grid > section').last().locator('button');

test('workspace route renders shell and primary controls', async ({ page }) => {
  await gotoWorkspace(page);

  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('#report-summary')).toBeVisible();
  await expect(navToWorkspace(page)).toBeVisible();
});

test('history route loads details and can enter async workspace', async ({ page }) => {
  await gotoHistory(page);

  const firstCard = page.locator('.history-card').first();
  await firstCard.getByRole('button').click();
  await expect(page.locator('.history-detail-panel')).toBeVisible();

  await asyncLoadButton(page).click();

  await expect(page).toHaveURL(/\/workspace-async$/);
  await expect(page.getByRole('heading', { name: '异步工作台沙箱' })).toBeVisible();
});

test('async workspace replay can create a new task and save it to history', async ({ page, request }) => {
  await gotoHistory(page);

  await page.locator('.history-card').nth(1).getByRole('button').click();
  await asyncLoadButton(page).click();
  await page.getByRole('button', { name: '基于回放新建' }).click();
  await page.locator('#async-summary').fill('E2E async replay smoke summary');
  await page.getByRole('button', { name: '更新摘要' }).click();
  await page.getByRole('button', { name: '保存到历史' }).click();
  await expect
    .poll(async () => {
      const response = await request.get('http://127.0.0.1:8787/api/history/tasks');
      const tasks = await response.json();
      return tasks.some((task: any) => task.summary === 'E2E async replay smoke summary');
    })
    .toBe(true);
  await gotoHistory(page);

  await expect(page.locator('.history-card').filter({ hasText: 'E2E async replay smoke summary' }).first()).toBeVisible();
});

test('workspace replay can exit replay mode and reset the session', async ({ page }) => {
  await gotoHistory(page);

  await page.locator('.history-card').nth(1).getByRole('button').click();
  await syncLoadButton(page).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await expect(replaySection(page)).toBeVisible();
  await replaySection(page).locator('button').first().click();

  await expect(page.locator('.topbar-task-meta')).toContainText('当前工作台会话');
  await expect(page.locator('.topbar-task-meta')).toContainText('等待启动');
});

test('async workspace can load sample data and control workflow status', async ({ page }) => {
  await gotoAsyncWorkspace(page);

  await page.locator('.upload-dropzone').getByRole('button', { name: '加载示例数据' }).click();
  await expect(page.locator('.preview-grid')).toBeVisible();

  await timelineButtons(page).nth(0).click();
  await expect(page.locator('.workflow-node-running')).toHaveCount(1);

  await timelineButtons(page).nth(1).click();
  await expect(timelineButtons(page).nth(1)).toBeDisabled();
  await expect(timelineButtons(page).nth(2)).toBeEnabled();

  await timelineButtons(page).nth(2).click();
  await expect(page.locator('.workflow-node-running')).toHaveCount(1);

  await expect(timelineButtons(page).nth(4)).toBeDisabled();
  await expect(timelineButtons(page).nth(5)).toBeDisabled();
});

test('workspace export updates the saved history card', async ({ page, request }) => {
  await gotoWorkspace(page);

  await page.locator('#report-summary').fill('E2E export summary for history card');
  await exportButtons(page).nth(0).click();
  await expect
    .poll(async () => {
      const response = await request.get('http://127.0.0.1:8787/api/history/tasks');
      const tasks = await response.json();
      return tasks.some((task: any) => task.summary === 'E2E export summary for history card' && task.exports?.[0]?.format === 'PDF');
    })
    .toBe(true);
  await gotoHistory(page);
  await expect(page.locator('.history-card').first()).toBeVisible();

  await expect(page.locator('.history-card').filter({ hasText: 'E2E export summary for history card' }).first()).toContainText('PDF');
});

test('history route can load the same replay task into sync and async workspaces separately', async ({ page }) => {
  await gotoHistory(page);

  await page.locator('.history-card').first().getByRole('button').click();
  await syncLoadButton(page).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await gotoHistory(page);
  await expect(page.locator('.history-card').first()).toBeVisible();
  await page.locator('.history-card').first().getByRole('button').click();
  await asyncLoadButton(page).click();

  await expect(page).toHaveURL(/\/workspace-async$/);
  await expect(page.getByRole('heading', { name: '异步工作台沙箱' })).toBeVisible();
});

test('history route filters tasks by keyword', async ({ page }) => {
  await gotoHistory(page);

  await page.getByPlaceholder('搜索任务名称 / 摘要 / 需求 / 状态').fill('渠道');

  const recentTasksSection = page.locator('.workspace-grid > section').first();
  await expect(recentTasksSection.locator('.history-card').first()).toContainText('渠道投放复盘');
  await expect(recentTasksSection.locator('.history-card')).toHaveCount(1);
  await expect(recentTasksSection.locator('.history-card').filter({ hasText: '华东销售月报' })).toHaveCount(0);
});

test('template library can favorite a template and pin it to the top', async ({ page }) => {
  await gotoTemplates(page);

  await page.getByRole('button', { name: '收藏模板：异常波动排查模板' }).click();

  await expect(page.locator('.history-card').first()).toContainText('异常波动排查模板');
  await expect(page.locator('.history-card').first()).toContainText('已收藏');
});

test('workspace can save the current session as a reusable template', async ({ page, request }) => {
  await gotoWorkspace(page);

  await page.locator('#analysis-request').fill('Analyze East China order value changes and preserve it as a replay template');
  await page.locator('#report-summary').fill('Preserve a reusable template for order value fluctuation review.');
  await page.getByRole('button', { name: '保存为模板' }).click();
  await expect
    .poll(async () => {
      const response = await request.get('http://127.0.0.1:8787/api/templates');
      const templates = await response.json();
      return templates.some(
        (template: any) => template.name === 'Analyze East China order value changes and preserve it as a replay template',
      );
    })
    .toBe(true);
  await gotoTemplates(page);
  await expect(page.locator('.history-card').first()).toBeVisible();

  await expect(page.locator('.history-card').first()).toContainText(
    'Analyze East China order value changes and preserve it as a replay template',
  );
  await expect(page.locator('.history-card').first()).toContainText('来自工作台');
});

test('templates page can duplicate a template and keep the original card', async ({ page }) => {
  await gotoTemplates(page);

  await page.getByRole('button', { name: '复制模板：经营复盘模板' }).click();

  await expect(page.locator('.history-card').first()).toContainText('经营复盘模板 副本');
  await expect(page.locator('.history-card').first()).toContainText('已复制');
  await expect(page.locator('.history-card').filter({ hasText: '经营复盘模板' })).toHaveCount(2);
});

test('async workspace reset task returns to the default live session', async ({ page }) => {
  await gotoHistory(page);

  await page.locator('.history-card').first().getByRole('button').click();
  await asyncLoadButton(page).click();
  await expect(page.getByRole('heading', { name: '异步工作台沙箱' })).toBeVisible();

  await page.getByRole('button', { name: '重置任务' }).click();

  await expect(page.locator('.topbar-task-meta')).toContainText('等待启动');
});

test('async workspace reset bridge clears bridge state after task actions', async ({ page }) => {
  await gotoAsyncWorkspace(page);

  await page.getByRole('button', { name: '加载当前任务' }).click();
  await expect(page.locator('.summary-card').first()).toContainText('成功');

  await page.getByRole('button', { name: '重置桥接' }).click();
  const sandbox = page.getByRole('region', { name: '异步工作台沙箱' });

  await expect(sandbox).toContainText('空闲');
  await expect(sandbox).toContainText('无');
});

test('async workspace auto-advances to downstream agents over time', async ({ page }) => {
  await gotoAsyncWorkspace(page);

  await timelineButtons(page).nth(0).click();
  await expect(page.locator('.workflow-node-running')).toHaveCount(1);

  await expect
    .poll(async () => {
      const texts = await page.locator('.workflow-node-running strong').allInnerTexts();
      return texts.join(' | ');
    })
    .not.toContain('数据接入 Agent');
});

test('async workspace can terminate a failed task and freeze the session', async ({ page }) => {
  await gotoAsyncWorkspace(page);

  await timelineButtons(page).nth(0).click();
  await expect(timelineButtons(page).nth(6)).toBeEnabled();
  await timelineButtons(page).nth(6).click();

  await expect(page.locator('.topbar-task-meta')).toContainText('已终止');
});

test('workspace markdown and word export both update the saved history card', async ({ page, request }) => {
  await gotoWorkspace(page);

  await page.locator('#report-summary').fill('E2E markdown and word export summary');
  await exportButtons(page).nth(1).click();
  await exportButtons(page).nth(2).click();
  await expect
    .poll(async () => {
      const response = await request.get('http://127.0.0.1:8787/api/history/tasks');
      const tasks = await response.json();
      const matchedTasks = tasks.filter((task: any) => task.summary === 'E2E markdown and word export summary');
      const exportFormats = new Set(
        matchedTasks.flatMap((task: any) => (Array.isArray(task.exports) ? task.exports.map((item: any) => item.format) : [])),
      );
      return exportFormats.has('Word') && exportFormats.has('Markdown');
    })
    .toBe(true);
  await gotoHistory(page);
  await expect(page.locator('.history-card').first()).toBeVisible();

  const targetCard = page
    .locator('.history-card')
    .filter({ hasText: 'E2E markdown and word export summary' })
    .filter({ hasText: 'Word' })
    .first();
  await targetCard.getByRole('button', { name: '查看任务详情' }).click();
  await expect(page.locator('.history-detail-panel')).toContainText('Markdown 导出完成');
  await expect(page.locator('.history-detail-panel')).toContainText('Word 导出完成');
});
