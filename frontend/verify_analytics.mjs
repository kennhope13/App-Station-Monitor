import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('C:/tmp/analytics_ss', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
});
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 860 });

const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

await page.goto('http://localhost:5173');
await page.waitForTimeout(1500);

if (page.url().includes('login')) {
  const u = page.locator('input[type=text]').first();
  const p = page.locator('input[type=password]').first();
  if (await u.isVisible()) {
    await u.fill('admin');
    await p.fill('admin');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
  }
}

await page.goto('http://localhost:5173/dashboard/analytics');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'C:/tmp/analytics_ss/tab1.png' });
console.log('TAB1_DONE url=' + page.url());

const t2 = page.getByText('Phân tích Chuyên sâu');
if (await t2.count() > 0) {
  await t2.click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'C:/tmp/analytics_ss/tab2.png' });
  console.log('TAB2_DONE');
} else {
  console.log('TAB2_NOT_FOUND');
}

const t3 = page.getByText('Tín hiệu & Sự kiện');
if (await t3.count() > 0) {
  await t3.click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'C:/tmp/analytics_ss/tab3.png' });
  console.log('TAB3_DONE');
} else {
  console.log('TAB3_NOT_FOUND');
}

console.log('CONSOLE_ERRORS:', JSON.stringify(errors.slice(0, 5)));
await browser.close();
