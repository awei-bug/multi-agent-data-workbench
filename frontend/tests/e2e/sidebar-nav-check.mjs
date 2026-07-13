import { chromium } from '@playwright/test';

const navCases = [
  { label: '数据源', path: '/data-sources' },
  { label: '数据洞察', path: '/chat-analysis' },
  { label: '报告中心', path: '/reports' },
  { label: '输入准备', path: '/workspace/input' },
  { label: '执行监控', path: '/workspace/execution' },
  { label: '报告交付', path: '/workspace/output' },
];

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();

  await page.goto('http://127.0.0.1:5174/data-sources');
  await page.waitForLoadState('networkidle');

  for (const item of navCases) {
    await page.getByRole('link', { name: item.label }).click();
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
