import { chromium } from '@playwright/test';

const navCases = [
  { label: '新建分析任务', path: '/workspace' },
  { label: '数据源管理', path: '/data-sources' },
  { label: '模板库', path: '/templates' },
  { label: '异步工作台沙箱', path: '/workspace-async' },
  { label: '历史任务', path: '/history' },
];

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();

  await page.goto('http://127.0.0.1:5174/workspace');
  await page.waitForLoadState('networkidle');

  for (const item of navCases) {
    await page.getByRole('button', { name: item.label }).click();
    await page.waitForTimeout(800);

    const url = page.url();
    const heading = await page.locator('h2').first().textContent();
    console.log(JSON.stringify({ label: item.label, expectedPath: item.path, url, heading }, null, 2));
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
