import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'playwright-core';
import { launch, layout, settle, visit, VIEWPORTS } from './harness.ts';

const translations = [
  { locale: 'th', home: 'หน้าแรก', appearance: 'หน้าตาและการนำทาง', settings: 'ตั้งค่า Peach', library: 'คลังและการนำเข้า', list: 'รายการ', cards: 'การ์ด' },
  { locale: 'en', home: 'Home', appearance: 'Appearance and navigation', settings: 'Peach settings', library: 'Library and importing', list: 'List', cards: 'Cards' },
  { locale: 'zh-CN', home: '首页', appearance: '外观与导航', settings: 'Peach 配置', library: '媒体库与入库', list: '列表', cards: '卡片' },
];

/** 系统界面文案与控件名称；作品名、路径、账号输入和可复制配置由各自的数据契约管理。 */
async function untranslated(page: import('playwright-core').Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll(roots => {
    const texts = new Set<string>();
    const excluded = 'option,code,pre,[data-media-title],[data-media-who],[data-entity-name],[data-sidebar-chip-label],[data-media-path]';
    for (const root of roots) {
      for (const node of [root, ...root.querySelectorAll('*')]) {
        if (!(node instanceof HTMLElement) || !node.getClientRects().length || node.closest(excluded)) continue;
        for (const child of node.childNodes) {
          const text = child.nodeType === Node.TEXT_NODE ? child.textContent?.trim() : '';
          if (text && !text.includes('Private 中文 ไทย.mp4') && /\p{Script=Han}/u.test(text)) texts.add(text);
        }
        for (const attribute of ['aria-label', 'title', 'placeholder']) {
          const text = node.getAttribute(attribute);
          if (text && !text.includes('Private 中文 ไทย.mp4') && /\p{Script=Han}/u.test(text)) texts.add(`${attribute}: ${text}`);
        }
      }
    }
    return [...texts];
  });
}

describe('界面语言与浏览器持久保存', () => {
  let browser: Browser;
  before(async () => { browser = await launch() });
  after(async () => { await browser?.close() });

  for (const viewport of VIEWPORTS) it(`${viewport.name}：三种语言切换、刷新、配置与馆藏`, { timeout: 120_000 }, async () => {
    const opened = await visit(browser, '/', viewport, async page => {
      // 站点图标来自外网，与语言无关；使用合成图标让目录验收不依赖第三方站点。
      await page.route('**/source-icon?provider=*', route => route.fulfill({
        contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6"/></svg>',
      }));
    });
    const { page } = opened;
    try {
      await page.locator('#grid [data-media-card]').first().waitFor();
      const names = await page.locator('#grid [data-media-title]').first().textContent();
      const gaps: Record<string, string[]> = {};
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
        if (text.locale !== 'zh-CN') {
          const tabs = page.locator('#settingsPanel [role="tab"]');
          for (let index = 0; index < await tabs.count(); index += 1) {
            await tabs.nth(index).click();
            const missing = await untranslated(page, '#settingsPanel');
            if (missing.length) gaps[`${text.locale} preferences ${index}`] = missing;
          }
        }
        assert.equal(await page.locator('#grid [data-media-title]').first().textContent(), names);
        await page.keyboard.press('Escape');
        await page.goto(new URL('/settings/library', page.url()).href);
        await page.getByRole('heading', { name: text.settings, exact: true }).waitFor();
        await page.getByRole('tab', { name: text.library, exact: true }).waitFor();
        await settle(page);
        if (text.locale !== 'zh-CN') {
          const tabs = page.locator('#stats [role="tab"]');
          for (let index = 0; index < await tabs.count(); index += 1) {
            await tabs.nth(index).click();
            await settle(page, '#stats');
            // 展开只读说明，覆盖折叠后隐藏的解释文字；不提交表单或启动任务。
            const summaries = page.locator('#stats details:not([open]) > summary:visible');
            while (await summaries.count()) await summaries.first().click();
            const missing = await untranslated(page, '#stats');
            if (missing.length) gaps[`${text.locale} configuration ${index}`] = missing;
          }
        }
        assert.deepEqual((await layout(page)).offenders, []);
        await page.goto(new URL('/', page.url()).href);
        await page.getByRole('radio', { name: text.list, exact: true }).waitFor();
        await page.locator('#grid [data-media-card]').first().waitFor();
        if (text.locale !== 'zh-CN') {
          const missing = await untranslated(page, 'header,#drawer,#brandHome,[data-catalog-root],#grid,#toasts');
          if (missing.length) gaps[`${text.locale} library`] = missing;
        }
        await page.getByRole('radio', { name: text.list, exact: true }).press('Space');
        await page.locator('#grid [data-list-name]').first().waitFor();
        assert.equal(await page.locator('#grid [data-list-name]').first().textContent(), names);
        if (text.locale !== 'zh-CN') {
          const missing = await untranslated(page, '#grid');
          if (missing.length) gaps[`${text.locale} library list`] = missing;
        }
        await page.getByRole('radio', { name: text.cards, exact: true }).press('Space');
        await page.locator('#grid [data-media-card]').first().waitFor();
        await page.reload();
        assert.equal(await page.locator('html').getAttribute('lang'), text.locale);
      }
      assert.deepEqual(gaps, {}, `Untranslated interface text: ${JSON.stringify(gaps, null, 2)}`);
      assert.deepEqual(opened.problems, []);
    } finally { await opened.close() }
  });
});
