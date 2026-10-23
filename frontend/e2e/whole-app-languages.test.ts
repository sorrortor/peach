/** 全站三语展示巡检；只读临时账本，禁止业务写请求。 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'playwright-core';
import { launch, layout, settle, VIEWPORTS, visit } from './harness.ts';

const ROUTES = ['/', '/?browse=folders', '/?jav=1', '/jav?tab=discover', '/jav?tab=wants',
  '/performers', '/performers?scope=online', '/creators', '/studios', '/agencies', '/tags', '/tags?scope=online',
  '/playlists', '/junk-files', '/junk-files?view=dismissed', '/quality-goals', '/sources',
  '/unseen', '/watch-later', '/flagged', '/follow', '/subscriptions', '/subscriptions?tab=feeds',
  '/tasks', '/review', '/duplicates', '/trash', '/data-cleanup', '/stats', '/taste',
  '/settings/appearance', '/settings/playback', '/settings/jav', '/settings/search', '/settings/content',
  '/settings/library', '/settings/subscriptions', '/settings/downloads', '/settings/network', '/settings/maintenance', '/settings/diagnostics'];

async function untranslated(page: Page, originals: string[]) {
  return page.locator('body').evaluate((root, originals) => {
    const gaps = new Set<string>();
    for (const node of [root, ...root.querySelectorAll('*')]) {
      if (!node.getClientRects().length || node.closest('script,style,[aria-hidden="true"],[inert]')) continue;
      const values = [...node.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent || '');
      values.push(...['aria-label', 'title', 'placeholder', 'label'].map(k => node.getAttribute(k) || ''));
      for (const value of values) {
        const copy = originals.reduce((text, original) => text.replaceAll(original, ''), value);
        if (/\p{Script=Han}/u.test(copy)) gaps.add(value.trim());
      }
    }
    return [...gaps];
  }, originals);
}

describe('全站三语界面', () => {
  let browser: Browser;
  before(async () => { browser = await launch() });
  after(async () => { await browser?.close() });
  for (const viewport of VIEWPORTS) it(`${viewport.name}: all routes keep the selected language`, { timeout: 240_000 }, async () => {
    const { page, problems, close } = await visit(browser, '/', viewport, async page => {
      // 图标是合成夹具，不依赖来源图标缓存。
      await page.route('**/source-icon?*', route => route.fulfill({ contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
      await page.addInitScript(() => {
        localStorage.setItem('peach.post-setup-tutorial.v1', 'complete');
        if (!localStorage.getItem('peach.language.v1')) localStorage.setItem('peach.language.v1', 'en');
      });
    });
    const gaps: Record<string, string[]> = {};
    const writes: string[] = [];
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() === 'GET') return route.continue();
      // 这两条任务接口以 POST + status_only 读取状态；启动与写入仍拒绝。
      if (request.method() === 'POST' && ['/api/resource-sync/scan', '/api/links/check'].includes(path)) {
        const body = request.postDataJSON();
        if (body?.status_only === true && Object.keys(body).every(key => ['status_only', 'background'].includes(key))) return route.continue();
      }
      writes.push(request.method() + ' ' + path);
      return route.fulfill({ status: 409, json: { detail: 'Read-only language audit' } });
    });
    try {
      const origin = new URL(page.url()).origin;
      // 资产资料属于内容；同一用例也可在通用的中文演示馆藏中运行。
      const inventory = await (await page.request.get(origin + '/api/items?limit=200')).json();
      const originals = new Set(['Private 中文 ไทย']);
      const collect = (value: unknown) => {
        if (typeof value === 'string') {
          if (/\p{Script=Han}/u.test(value)) {
            originals.add(value);
            for (const part of value.split(/[\\/]/)) if (/\p{Script=Han}/u.test(part)) originals.add(part);
          }
        } else if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === 'object') Object.values(value).forEach(collect);
      };
      for (const item of inventory.items ?? []) for (const field of ['name', 'title', 'display_title', 'original_title', 'path', 'creator', 'performers', 'studio', 'series', 'tags']) collect(item[field]);
      const content = [...originals].sort((a, b) => b.length - a.length);
      for (const locale of ['en', 'th', 'zh-CN']) {
        await page.evaluate(locale => localStorage.setItem('peach.language.v1', locale), locale);
        for (const path of ROUTES) {
          await page.goto(origin + path, { waitUntil: 'load' });
          const scope = /^\/settings\/(?:appearance|playback|jav|search|content)$/.test(path) ? '#settingsPanel' : '#main';
          await page.locator(scope).waitFor({ state: 'visible' });
          await page.waitForFunction(selector => Boolean(document.querySelector<HTMLElement>(selector)?.innerText.trim()), scope);
          await settle(page, scope);
          assert.equal(await page.locator('html').getAttribute('lang'), locale, path);
          assert.ok((await page.locator(scope).innerText()).trim().length > 0, path);
          if (locale !== 'zh-CN') {
            const missing = await untranslated(page, content);
            if (missing.length) gaps[`${locale} ${path}`] = missing;
          }
          const geometry = await layout(page);
          assert.ok(geometry.scrollWidth <= geometry.viewportWidth + 1, `${locale} ${path}: ${JSON.stringify(geometry)}`);
        }
      }
      assert.deepEqual(gaps, {});
      assert.deepEqual(writes, []);
      assert.deepEqual(problems, []);
    } finally { await close() }
  });
});
