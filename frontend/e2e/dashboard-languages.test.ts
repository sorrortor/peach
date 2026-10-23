/** 三语图表与管理页验收。所有管理结果均为合成响应，不执行清理或读取浏览历史。 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'playwright-core';
import { launch, layout, settle, VIEWPORTS, visit } from './harness.ts';

const PRIVATE = 'Private 中文 ไทย';
const cleanup: Record<string, unknown> = {
  '/api/review?counts=1': { counts: { metadata_fields: 12, performer_avatars: 3, studio_logos: 2, creator_tags: 1 } },
  '/api/quality-goals?limit=200': { total: 7, items: [] },
  '/api/duplicates?limit=120': { total: 3, files: 8, reclaimable: 2147483648, groups: [] },
  '/api/ads?limit=1': { pending_total: 5, dismissed_total: 2, counts: { video: 4, url: 1 } },
  '/api/items?state=trash&limit=1': { total: 9, bytes: 3221225472 },
  '/api/sources': { sources: [{ location: 'local', online: true, roots: ['R:\\media'] }, { location: '115', online: false, roots: ['B:\\'] }] },
  '/api/library-processing': { status: 'idle' },
  '/api/media-repair': { status: 'complete', library: '', stage: '', checked: 3, total: 3, found: 3, repaired: 2, failed: 1, missing_tool: 1, skipped: 0, message: '' },
  '/api/libraries': { libraries: [] },
  '/api/organize': { status: 'idle', locations: [{ location: 'local', roots: ['R:\\media'] }], templates: { local: { file: '{number}', dir: '' } },
    presets: [{ label: '番号 标题', file: '{number}[ {title}]', dir: '{studio}' }],
    placeholders: [{ key: 'number', label: '番号' }, { key: 'year', label: '发行年' }], last_batch: '' },
  '/api/links': { total: 1, entities: 1, by_kind: { official: 1 }, top_hosts: [['example.invalid', 1]] },
  '/api/links/check': { status: 'complete', check_id: 'test', checked: 2, total: 2, gone: [{ id: 1, entity: PRIVATE, link_kind: 'official', label: PRIVATE, url: 'https://example.invalid/file', note: 'HTTP 404' }],
    unclear: [{ id: 2, entity: PRIVATE, link_kind: 'official', label: PRIVATE, url: 'https://example.invalid/retry', note: 'HTTP 403' }], scope: '' },
  '/api/links/prune': { status: 'idle' },
  '/api/orphan-records': { total: 1, items: [{ id: 7, name: PRIVATE, code: 'TEST-001', location: 'local', duration: 3600, size: 10,
    vanished_at: 200, has_thumb: false, records: { asset_preference: 1, activity_event: 3, rating: 4, play_count: 2 },
    candidates: [{ id: 9, location: 'local', name: PRIVATE, duration: 3590, size: 20 }] }] },
  '/api/resource-sync/scan': { status: 'complete', scan_id: 'test', missing: 2, vanish: 1, empty: 1, cache: { files: 2, bytes: 123 },
    sources: [{ location: 'local', online: true, total: 4, missing: 2, vanish: 1, empty: 1, unreadable: 0 }] },
  '/api/resource-sync/apply': { status: 'idle' },
};
const taste = {
  summary: { history_visits: 900, history_sources: 2, peach_items: 24, peach_seconds: 7200, liked: 6, disliked: 1, range_start: '2026-01-01', range_end: '2026-09-01' },
  coverage: { tagged: 18, identified: 12, untagged: 6, unidentified: 12 },
  rankings: { browser_categories: [{ name: '3D/动画', score: 40 }, { name: '制服/角色扮演', score: 25 }, { name: '口交', score: 10 }],
    browser_tags: [{ name: PRIVATE, web_visits: 12, peach_items: 3 }], browser_creators: [{ name: PRIVATE, web_visits: 8, peach_items: 2 }],
    domains: [{ name: 'example.invalid', visits: 30 }], peach_tags: [{ name: PRIVATE, score: 9, peach_items: 4 }], peach_creators: [], peach_performers: [] },
  gaps: [{ name: PRIVATE, web_visits: 4 }],
  sources: [{ source_key: 'a1', browser: 'browserexport', profile: PRIVATE, host: 'test', visits: 120 }],
  browsers: [{ id: 'test', name: PRIVATE, path: '/synthetic', enabled: true, available: true, profiles: 1, source_keys: ['a1'] }],
  analysis: { headline: `浏览兴趣以3D/动画为主，Peach 中稳定出现${PRIVATE}。`, confidence: { level: 'early', label: '仍在学习' },
    points: [{ label: '浏览主线', text: '3D/动画' }, { label: 'Peach 印证', text: PRIVATE }],
    explore: [{ tag: PRIVATE, title: `探索 ${PRIVATE}`, detail: '浏览信号 12 次 · 馆藏 3 部 · 尚无观看印证' }],
    next_steps: [{ route: '/review', title: '补齐馆藏证据', detail: '2 项待补 Tag · 3 项待补身份' }] },
  activity: { timezone: 'Asia/Shanghai', days: [{ date: '2026-09-01', count: 3 }], hours: [{ weekday: 0, hour: 21, count: 5 }] },
  creator_flows: [{ source: 'example.invalid', target: PRIVATE, value: 6 }], storage: { exports: 2, bytes: 1048576 }, window: 'all', updated_at: '2026-09-10T00:00:00Z',
};

async function gaps(page: Page) {
  return page.locator('#stats,[role="dialog"],dialog[open]').evaluateAll(roots => {
    const missing = new Set<string>();
    for (const root of roots) for (const node of [root, ...root.querySelectorAll('*')]) {
      if (!node.getClientRects().length) continue;
      const values = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent || '');
      values.push(...['aria-label', 'title', 'placeholder', 'label'].map(key => node.getAttribute(key) || ''));
      for (const value of values) if (/\p{Script=Han}/u.test(value.replaceAll('Private 中文 ไทย', 'Private'))) missing.add(value.trim());
    }
    return [...missing];
  });
}

describe('统计、口味与数据管理三语界面', () => {
  let browser: Browser;
  before(async () => { browser = await launch() });
  after(async () => { await browser?.close() });
  for (const viewport of VIEWPORTS) it(`${viewport.name}: charts, analysis, management and empty states`, { timeout: 120_000 }, async () => {
    const opened = await visit(browser, '/', viewport, async page => {
      await page.addInitScript(() => localStorage.setItem('peach.post-setup-tutorial.v1', 'complete'));
    });
    const { page } = opened;
    try {
      const emptyStats = await (await page.request.get(new URL('/api/stats', page.url()).href)).json();
      const stats = structuredClone(emptyStats);
      Object.assign(stats, {
        by_loc: [{ k: 'local', n: 4, bytes: 4294967296, videos: 4 }],
        by_medium: [{ k: 'video', n: 4, bytes: 4294967296 }, { k: 'image', n: 6, bytes: 100 }],
        by_library: [{ k: 'main', name: PRIVATE, icon: 'film', videos: 4, bytes: 4294967296 }],
        by_length: [{ k: '速食', n: 1 }, { k: '短', n: 3 }], by_quality: [{ k: '低画质', n: 1 }, { k: '1080P', n: 3 }],
        play_activity: taste.activity, replays: [{ k: 1, n: 2 }, { k: 3, n: 1 }],
        attribution: { videos: 4, creator: 3, code: 2, studio: 1, thumb: 4, duration: 4 }, tag_source: [{ k: 'javdb', n: 12, assets: 3 }], tag_cov: 2,
        consumption: { played: 2, library_played: 1, online_played: 1, play_seconds: 5400, o_total: 1, liked: 1, dislike: 1, seen: 1, trash: 1, skimmed: 1 },
        recent: [{ id: 1, name: PRIVATE, creator: PRIVATE, play_seconds: 600, duration: 1200, max_reached: 0.9, o_count: 0, kind: 'library' }],
      });
      const writes: string[] = [];
      let empty = false;
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url());
        const key = url.pathname + url.search;
        const readOnly = request.method() === 'GET' || request.postDataJSON()?.status_only === true;
        if (!readOnly) { writes.push(key); return route.fulfill({ json: { error: 'Synthetic read-only test' } }); }
        if (url.pathname === '/api/stats') return route.fulfill({ json: empty ? emptyStats : stats });
        if (url.pathname === '/api/taste') return route.fulfill({ json: empty ? {} : taste });
        if (url.pathname === '/api/taste/refresh') return route.fulfill({ json: { status: 'idle' } });
        const answer = cleanup[key] ?? cleanup[url.pathname];
        return answer === undefined ? route.continue() : route.fulfill({ json: answer });
      });
      const missing: Record<string, string[]> = {};
      for (const locale of ['th', 'en', 'zh-CN']) {
        empty = false;
        await page.evaluate(value => localStorage.setItem('peach.language.v1', value), locale);
        for (const path of ['/stats', '/taste', '/data-cleanup']) {
          await page.goto(new URL(path, page.url()).href);
          await page.locator('#stats').waitFor();
          await settle(page, '#stats');
          assert.equal(await page.locator('html').getAttribute('lang'), locale);
          if (locale !== 'zh-CN') missing[`${locale} ${path}`] = await gaps(page);
          const tabs = page.locator('#stats [role="tab"]');
          // 每次点击后重取节点：父页签可能挂载不同的子页签。
          for (let index = 0; index < await tabs.count(); index += 1) {
            await tabs.nth(index).click();
            await settle(page, '#stats');
            if (locale !== 'zh-CN') missing[`${locale} ${path} tab ${index}`] = await gaps(page);
          }
          assert.deepEqual((await layout(page)).offenders, []);
          if (path === '/data-cleanup') {
            const clean = locale === 'th' ? 'ล้างรายการที่ใช้ไม่ได้' : locale === 'en' ? 'Clean up unavailable items' : '清理失效条目';
            await page.getByRole('button', { name: clean, exact: true }).click();
            await page.locator('dialog[open]').waitFor();
            if (locale !== 'zh-CN') missing[`${locale} cleanup confirmation`] = await gaps(page);
            await page.locator('dialog[open] [data-modal-cancel]').click();
          }
          if (path === '/taste') {
            const add = locale === 'th' ? 'เพิ่มเบราว์เซอร์' : locale === 'en' ? 'Add browser' : '添加浏览器';
            await page.getByRole('button', { name: add, exact: true }).click();
            if (locale !== 'zh-CN') missing[`${locale} browser form`] = await gaps(page);
            const cancel = locale === 'th' ? 'ยกเลิก' : locale === 'en' ? 'Cancel' : '取消';
            await page.locator('#stats').getByRole('button', { name: cancel, exact: true }).click();
          }
        }
        empty = true;
        for (const path of ['/stats', '/taste']) {
          await page.goto(new URL(path, page.url()).href);
          await settle(page, '#stats');
          if (path === '/taste') {
            await page.locator('#stats summary').click();
            await settle(page, '#stats');
          }
          if (locale !== 'zh-CN') missing[`${locale} empty ${path}`] = await gaps(page);
        }
      }
      assert.deepEqual(Object.fromEntries(Object.entries(missing).filter(([, values]) => values.length)), {});
      assert.deepEqual(writes, []);
      assert.deepEqual(opened.problems, []);
    } finally { await opened.close() }
  });
});
