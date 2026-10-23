import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'playwright-core';
import { DETAIL, openFollowFeed } from './follow-fixture.ts';
import { launch, layout, settle, VIEWPORTS } from './harness.ts';

/** 合成标题、标签与来源说明属于内容，不参与界面翻译。 */
async function gaps(page: Page, selector: string) {
  return page.locator(selector).evaluateAll(roots => {
    const missing = new Set<string>();
    const content = '[data-media-title],[data-media-who],[data-follow-title],[data-follow-detail-name],[data-follow-detail-summary],[data-id-name],[data-follow-tag],[data-tag],[data-follow-queue-item] b,[data-follow-media-item] b';
    for (const root of roots) for (const node of [root, ...root.querySelectorAll('*')]) {
      if (!(node instanceof HTMLElement) || !node.getClientRects().length || node.closest(content)) continue;
      const values = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent || '');
      values.push(...['aria-label', 'title', 'placeholder', 'label'].map(key => node.getAttribute(key) || ''));
      for (const value of values) if (/\p{Script=Han}/u.test(value) && !/演示更新|帖子|合集|同一条|Private 中文 ไทย|片段|张图/.test(value)) missing.add(value.trim());
    }
    return [...missing];
  });
}

describe('关注、详情与播放器三语界面', () => {
  let browser: Browser;
  before(async () => { browser = await launch() });
  after(async () => { await browser?.close() });
  for (const viewport of VIEWPORTS) it(`${viewport.name}: localized feed, details, settings and subtitles`, { timeout: 120_000 }, async () => {
    const opened = await openFollowFeed(browser, '/follow', viewport);
    const { page } = opened;
    try {
      await page.route('**/api/feeds', route => route.fulfill({ json: { unread: 0, sources: [{
        id: 1, kind: 'javdb_actor', kind_label: 'JAV 订阅', name: 'Synthetic Creator',
        url: 'https://example.invalid/creator', entity_id: null, entity_name: null,
        enabled: true, interval_minutes: 60, last_fetched_at: null, last_error: null, last_new_count: 0, seen: 0,
      }] } }));
      await page.route('**/follow-stream**', async route => {
        const response = await route.fetch({ url: new URL('/stream?id=1', page.url()).href });
        await route.fulfill({ response });
      });
      const missing: Record<string, string[]> = {};
      for (const locale of ['th', 'en', 'zh-CN']) {
        await page.evaluate(value => localStorage.setItem('peach.language.v1', value), locale);
        await page.goto(new URL('/follow', page.url()).href);
        await page.locator('[data-follow-list] > [data-follow-item]').first().waitFor();
        await settle(page);
        assert.equal(await page.locator('html').getAttribute('lang'), locale);
        if (locale !== 'zh-CN') missing[`${locale} feed`] = await gaps(page, '#stats,#grid,[data-follow-root]');
        await page.goto(new URL('/subscriptions', page.url()).href);
        await page.locator('#stats [role="tab"]').first().waitFor();
        const tabs = page.locator('#stats [role="tab"]');
        for (let index = 0; index < await tabs.count(); index += 1) {
          await tabs.nth(index).click();
          await settle(page, '#stats');
          if (locale !== 'zh-CN') missing[`${locale} following management ${index}`] = await gaps(page, '#stats');
          if (index === 0) {
            await page.getByRole('button', { name: locale === 'th' ? 'มุมมองตาราง' : locale === 'en' ? 'Table view' : '表格视图', exact: true }).click();
            await settle(page, '#stats');
            if (locale !== 'zh-CN') missing[`${locale} following table`] = await gaps(page, '#stats');
          }
        }
        for (const id of [DETAIL.bare, DETAIL.collection, DETAIL.media]) {
          await page.goto(new URL(`/posts/${id}`, page.url()).href);
          await page.locator('#stage[open] [data-follow-detail-side]').waitFor();
          await settle(page, '#stage');
          if (locale !== 'zh-CN') missing[`${locale} post ${id}`] = await gaps(page, '#stage');
        }
        await page.goto(new URL('/assets/1', page.url()).href);
        const player = page.locator('#stage .video-js');
        await player.locator('[data-player-quality]').waitFor();
        assert.equal(await player.getAttribute('lang'), locale);
        await page.waitForFunction(() => {
          const video = document.querySelector<HTMLVideoElement>('#stage video');
          return !!video && video.readyState >= 1;
        });
        assert.equal(await player.locator('video.vjs-tech').evaluate((video: HTMLVideoElement) => video.paused), true);
        await player.getByRole('button', { name: locale === 'th' ? 'เล่น' : locale === 'en' ? 'Play' : '播放', exact: true }).first().waitFor();
        if (locale !== 'zh-CN') missing[`${locale} video detail`] = await gaps(page, '#stage');
        await player.locator('.vjs-peach-settings-toggle').click();
        if (locale !== 'zh-CN') missing[`${locale} player settings`] = await gaps(page, '.vjs-peach-settings-menu');
        await player.locator('[data-player-speed]').click();
        await player.locator('[data-player-speed-range]').waitFor();
        if (locale !== 'zh-CN') missing[`${locale} speed`] = await gaps(page, '.vjs-peach-settings-menu');
        await player.locator('[data-player-menu-back]').click();
        await player.locator('[data-player-quality-view]').click();
        await player.locator('[data-player-quality-option]').first().waitFor();
        if (locale !== 'zh-CN') missing[`${locale} quality`] = await gaps(page, '.vjs-peach-settings-menu');
        await player.locator('[data-player-menu-back]').click();
        await player.locator('[data-player-subtitles]').click();
        await player.locator('[data-subtitle-options]').waitFor();
        if (locale !== 'zh-CN') missing[`${locale} subtitles`] = await gaps(page, '.vjs-peach-settings-menu');
        await player.locator('[data-subtitle-options]').click();
        await player.locator('[data-subtitle-reset]').waitFor();
        if (locale !== 'zh-CN') missing[`${locale} subtitle options`] = await gaps(page, '.vjs-peach-settings-menu');
        await player.locator('[data-subtitle-style="color"]').click();
        if (locale !== 'zh-CN') missing[`${locale} subtitle colors`] = await gaps(page, '.vjs-peach-settings-menu');
        assert.deepEqual((await layout(page)).offenders, []);
        for (const failed of [false, true]) {
          const match = (url: URL) => url.pathname === '/api/follow' && !url.searchParams.has('item');
          await page.route(match, route => route.fulfill({ json: {
            ok: true, groups: [], counts: {}, facets: {}, offset: 0, limit: 300, has_more: false,
            author_aliases: [], providers: [], sources: failed ? [{ id: 1, provider: 'kemono', label: 'Test source',
              author_name: 'Test creator', author_key: 'name:test', enabled: true, last_status: 'error' }] : [],
          } }));
          await page.goto(new URL('/follow', page.url()).href);
          await page.locator('[data-follow-empty]').waitFor();
          await settle(page);
          if (locale !== 'zh-CN') missing[`${locale} follow empty ${failed}`] = await gaps(page, '#stats,#grid');
          await page.unroute(match);
        }
      }
      assert.deepEqual(Object.fromEntries(Object.entries(missing).filter(([, rows]) => rows.length)), {});
      assert.deepEqual(opened.stub.writes, []);
      assert.deepEqual(opened.problems, []);
    } finally { await opened.close() }
  });
});
