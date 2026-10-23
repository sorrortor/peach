import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'playwright-core';
import { launch, layout, settle, visit, VIEWPORTS } from './harness.ts';

const translations = [
  { locale: 'th', home: 'หน้าแรก', appearance: 'หน้าตาและการนำทาง', settings: 'ตั้งค่า Peach', library: 'คลังและการนำเข้า', list: 'รายการ' },
  { locale: 'en', home: 'Home', appearance: 'Appearance and navigation', settings: 'Peach settings', library: 'Library and importing', list: 'List' },
  { locale: 'zh-CN', home: '首页', appearance: '外观与导航', settings: 'Peach 配置', library: '媒体库与入库', list: '列表' },
];

describe('界面语言与浏览器持久保存', () => {
  let browser: Browser;
  before(async () => { browser = await launch() });
  after(async () => { await browser?.close() });

  for (const viewport of VIEWPORTS) it(`${viewport.name}：三种语言切换、刷新、配置与馆藏`, { timeout: 120_000 }, async () => {
    const opened = await visit(browser, '/', viewport);
    const { page } = opened;
    try {
      await page.locator('#grid [data-media-card]').first().waitFor();
      const names = await page.locator('#grid [data-media-title]').first().textContent();
      for (const text of translations) {
        await page.locator('#settingsBtn').evaluate((button: HTMLElement) => button.click());
        const panel = page.locator('#settingsPanel:not([hidden])');
        await panel.waitFor();
        const picker = panel.locator('[data-language-picker]');
        if (await picker.inputValue() !== text.locale) {
          await Promise.all([page.waitForEvent('load'), picker.selectOption(text.locale)]);
        } else {
          await page.reload({ waitUntil: 'load' });
        }
        await page.goto(new URL('/', page.url()).href);
        await page.locator('#grid [data-media-card]').first().waitFor();
        assert.equal(await page.locator('html').getAttribute('lang'), text.locale);
        assert.equal(await page.evaluate(() => localStorage.getItem('peach.language.v1')), text.locale);
        assert.equal(await page.locator('[data-nav=""]').getAttribute('aria-label'), text.home);
        await page.locator('#settingsBtn').evaluate((button: HTMLElement) => button.click());
        await page.locator('#settingsPanel').getByRole('tab', { name: text.appearance, exact: true }).waitFor();
        assert.equal(await page.locator('#grid [data-media-title]').first().textContent(), names);
        await page.keyboard.press('Escape');
        await page.goto(new URL('/settings/library', page.url()).href);
        await page.getByRole('heading', { name: text.settings, exact: true }).waitFor();
        await page.getByRole('tab', { name: text.library, exact: true }).waitFor();
        await settle(page);
        assert.deepEqual((await layout(page)).offenders, []);
        await page.goto(new URL('/', page.url()).href);
        await page.getByRole('radio', { name: text.list, exact: true }).waitFor();
        await page.reload();
        assert.equal(await page.locator('html').getAttribute('lang'), text.locale);
      }
      assert.deepEqual(opened.problems, []);
    } finally { await opened.close() }
  });
});
