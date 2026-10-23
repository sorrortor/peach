/** 管理页三语验收：合成任务、候选和重复文件，所有写入均拦截；确认框只取消。 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'playwright-core';
import { launch, layout, settle, VIEWPORTS, visit } from './harness.ts';

const PRIVATE = 'Private 中文 ไทย';
const run = (id: number, patch: Record<string, unknown> = {}) => ({ id, task_key: 'library-processing', task_label: '扫描与采集',
  trigger: 'manual', status: 'running', host: 'synthetic', started_at: '2026-10-23T00:00:00Z', finished_at: null,
  elapsed_seconds: 75, progress_current: 3, progress_total: 12, progress_label: `扫描与采集：${PRIVATE}`,
  result_summary: {}, error: '', parent_run_id: null, root_run_id: null, followup_key: '', followup_depth: 0, ...patch });
const tasks = { available: true, running: [run(1)], skipped: [run(2, { status: 'cancelled', error: '与第 1 轮（手动触发）冲突，本次跳过' })],
  finished: [run(3, { status: 'succeeded', finished_at: '2026-10-23T00:01:00Z', result_summary: { checked: 3, operation: '扫描文件', name: PRIVATE } }),
    run(5, { status: 'failed', finished_at: '2026-10-23T00:02:00Z', result_summary: {
      library: PRIVATE, stage: '处理结束', error: '20 项需要处理，可重试未完成的部分。', requested_stage: 'metadata',
      speed_mode: 'standard', eta_kind: 'estimating', eta_scope: '整趟任务', eta_basis: '汇总当前阶段与所有待执行阶段的剩余耗时',
      probed: 20, auto_applied: 0, performer_profile_conflicts: 0, performer_profile_failed: 0 }, error: '媒体文件不可访问' }),
    run(4, { task_label: '补全资料图片', task_key: 'entity-avatar', status: 'succeeded', parent_run_id: 3, root_run_id: 3,
      followup_key: 'entity-avatar:1', progress_label: `补全资料图片：${PRIVATE}`, result_summary: { written: 2 } })], finished_has_more: false };
const metadata = { item_key: 'row:1', field: 'title', field_label: '标题', query: PRIVATE, current_value: PRIVATE,
  reason: '未标注来源', candidates: [
    { candidate_key: 'a', source: 'nfo', display_value: PRIVATE, official: true, warnings: ['媒体文件不可访问'],
      catalog_evidence: { original_title: { display_value: PRIVATE }, runtime: { display_value: '3600' } } },
    { candidate_key: 'b', source: 'javdb', display_value: PRIVATE, unmapped_genres: [PRIVATE] },
  ] };
const review = { sections: { metadata_fields: [metadata], creator_tags: [{ item_key: 'creator:1', creator: PRIVATE, tags: PRIVATE }],
  studio_logos: [], performer_avatars: [], western_identity: [], code_creators: [], fc2_markings: [], fc2_similarity: [], video_endcards: [] },
  counts: { metadata_fields: 1, creator_tags: 1 }, genre_tags: [PRIVATE] };
const file = (id: number, size: number) => ({ id, name: `${PRIVATE}-${id}.mp4`, path: `/synthetic/${PRIVATE}-${id}.mp4`,
  location: 'local', drive: 'R:', size, duration: 3600, is_largest: id === 1, is_longest: id === 2 });
const duplicates = { total: 1, files: 2, reclaimable: 100, groups: [{ code: 'TEST-001', files: [file(1, 200), file(2, 100)],
  count: 2, identical: false, evidence: 'same_code_short_copy', drives: ['R:'], cross_drive: false, reclaimable: 100 }] };
const downloads = { available: true, providers: [], tasks: [{ id: 'test', title: PRIVATE, state: 'ingested', state_label: '已入库',
  postprocess_state: 'failed', postprocess_label: '后处理失败', postprocess_detail: '媒体文件不可访问', provider: 'pikpak', provider_label: 'PikPak',
  failure_label: '配置与认证', failure_detail: '媒体文件不可访问', code: 'TEST-001', target: '/synthetic', submitted_at: '2026-10-23T00:00:00Z',
  source_uri: 'magnet:?xt=urn:btih:synthetic', cancellable: false, resubmittable: false, postprocess_retryable: true }] };

async function gaps(page: Page) {
  return page.locator('#stats,#grid,[data-manage-header],[data-batch-dock],dialog[open],[role="dialog"]').evaluateAll(roots => {
    const missing = new Set<string>();
    for (const root of roots) for (const node of [root, ...root.querySelectorAll('*')]) {
      if (!node.getClientRects().length || node.tagName === 'OPTION') continue;
      const values = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent || '');
      values.push(...['aria-label', 'title', 'placeholder', 'label'].map(key => node.getAttribute(key) || ''));
      for (const value of values) if (/\p{Script=Han}/u.test(value.replaceAll('Private 中文 ไทย', 'Private'))) missing.add(value.trim());
    }
    return [...missing];
  });
}

describe('任务、人工复核、重复文件与回收站三语界面', () => {
  let browser: Browser;
  before(async () => { browser = await launch() });
  after(async () => { await browser?.close() });
  for (const viewport of VIEWPORTS) it(`${viewport.name}: localized management, selection and cancelled confirmations`, { timeout: 120_000 }, async () => {
    const opened = await visit(browser, '/', viewport, async page => {
      await page.addInitScript(() => localStorage.setItem('peach.post-setup-tutorial.v1', 'complete'));
    });
    const { page } = opened;
    try {
      const catalog = await (await page.request.get(new URL('/api/items?limit=10', page.url()).href)).json();
      const trash = { ...catalog, total: 1, items: catalog.items.map((item: Record<string, unknown>) => ({ ...item, disposal: 'trash' })) };
      let empty = false;
      const writes: string[] = [], missing: Record<string, string[]> = {};
      await page.route('**/thumb?*', route => route.fulfill({ contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64') }));
      await page.route('**/api/**', route => {
        const req = route.request(), url = new URL(req.url());
        if (req.method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ json: { error: 'Synthetic read-only test' } }); }
        if (url.pathname === '/api/tasks') return route.fulfill({ json: empty ? { available: true, running: [], skipped: [], finished: [] } : tasks });
        if (url.pathname === '/api/downloads') return route.fulfill({ json: empty ? { available: true, providers: [], tasks: [] } : downloads });
        if (url.pathname === '/api/review') return route.fulfill({ json: empty ? { sections: {}, counts: {} } : review });
        if (url.pathname === '/api/duplicates') return route.fulfill({ json: empty ? { total: 0, files: 0, groups: [], reclaimable: 0 } : duplicates });
        if (url.pathname === '/api/items' && url.searchParams.get('state') === 'trash') return route.fulfill({ json: empty ? { ...trash, items: [], total: 0 } : trash });
        return route.continue();
      });
      for (const locale of ['th', 'en', 'zh-CN']) {
        empty = false;
        await page.evaluate(value => localStorage.setItem('peach.language.v1', value), locale);
        for (const path of ['/activity', '/review', '/duplicates', '/trash']) {
          await page.goto(new URL(path, page.url()).href);
          await settle(page);
          assert.equal(await page.locator('html').getAttribute('lang'), locale);
          if (locale !== 'zh-CN') missing[`${locale} ${path}`] = await gaps(page);
          if (path === '/review') {
            await page.locator('[data-review-key="row:1"] label').filter({ has: page.locator('input[type="checkbox"]') }).click();
            if (locale !== 'zh-CN') missing[`${locale} review selection`] = await gaps(page);
            const tabs = page.locator('#stats [role="tab"]');
            for (let index = 0; index < await tabs.count(); index++) {
              await tabs.nth(index).click();
              await settle(page, '#stats');
              if (locale !== 'zh-CN') missing[`${locale} review ${index}`] = await gaps(page);
            }
          }
          if (path === '/duplicates') {
            await page.locator('#stats button').filter({ hasText: locale === 'th' ? 'เก็บไฟล์ใหญ่ที่สุดทุกกลุ่ม' : locale === 'en' ? 'Keep largest in all groups' : '全部保留最大' }).click();
            await page.locator('dialog[open]').waitFor();
            if (locale !== 'zh-CN') missing[`${locale} duplicates confirmation`] = await gaps(page);
            await page.locator('dialog[open] [data-modal-cancel]').click();
          }
          if (path === '/trash') {
            await page.locator('[data-empty-trash]').click();
            await page.locator('dialog[open]').waitFor();
            if (locale !== 'zh-CN') missing[`${locale} empty trash confirmation`] = await gaps(page);
            await page.locator('dialog[open] [data-modal-cancel]').click();
            await page.locator('#grid [data-media-pic]').first().click({ modifiers: ['Shift'] });
            await page.locator('[data-batch-action="delete"]').click();
            await page.locator('dialog[open]').waitFor();
            if (locale !== 'zh-CN') missing[`${locale} trash selection confirmation`] = await gaps(page);
            await page.locator('dialog[open] [data-modal-cancel]').click();
            await page.locator('[data-batch-action="restore"]').click();
            await page.locator('dialog[open]').waitFor();
            if (locale !== 'zh-CN') missing[`${locale} trash restore confirmation`] = await gaps(page);
            await page.locator('dialog[open] [data-modal-cancel]').click();
            await page.locator('[data-batch-action="clear"]').click();
          }
          assert.deepEqual((await layout(page)).offenders, []);
        }
        empty = true;
        for (const path of ['/activity', '/review', '/duplicates', '/trash']) {
          await page.goto(new URL(path, page.url()).href);
          await settle(page);
          if (locale !== 'zh-CN') missing[`${locale} empty ${path}`] = await gaps(page);
        }
      }
      assert.deepEqual(Object.fromEntries(Object.entries(missing).filter(([, values]) => values.length)), {});
      assert.deepEqual(writes, []);
      assert.deepEqual(opened.problems, []);
    } finally { await opened.close() }
  });
});
