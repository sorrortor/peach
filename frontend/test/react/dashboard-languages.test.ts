/** 展示折算只翻译产品文案，真实名称与请求参数不变。 */
import { afterEach, expect, it } from 'vitest';
import { saveLanguage, translate } from '../../src/i18n';
import { analysisPresentation, rankDetail, type TasteAnalysis } from '../../src/react/taste/taste';
import { fmtCount, mediumRows, playedFor } from '../../src/react/stats/stats';
import { hourGrid } from '../../src/react/charts/heat';
import { junkBreakdown, reviewSummary } from '../../src/react/data-cleanup/data-cleanup';
import { DIRECTORY_TEMPLATE_ERROR, organizeOutcome, planSummary } from '../../src/react/data-cleanup/organize';
import { IDLE_REPAIR, statusLine } from '../../src/react/media-repair/media-repair';

afterEach(() => { saveLanguage('zh-CN'); localStorage.clear() });

for (const locale of ['en', 'th'] as const) it(`${locale}: 图表、读数和管理结果沿用所选语言`, () => {
  saveLanguage(locale);
  const texts = [fmtCount(null), playedFor(5400),
    ...mediumRows([{ k: 'video', n: 4, bytes: 100 }]).map(row => row.name),
    ...hourGrid({ hours: [{ weekday: 0, hour: 12, count: 3 }] }).cells.map(cell => cell.label),
    rankDetail({ name: 'Private 中文 ไทย', web_visits: 12, web_bookmarks: 2, peach_items: 3 }),
    ...Object.values(reviewSummary({ counts: { metadata_fields: 3, studio_logos: 2, performer_avatars: 1 } })),
    junkBreakdown({ pending_total: 4, dismissed_total: 1, counts: { video: 2, url: 2 } }),
    planSummary({ counts: { change: 3, unchanged: 2 }, reasons: { 字段缺失: 1 }, rows: [], truncated: false }),
    organizeOutcome({ status: 'complete', moved: 3, failed: 1 }).text,
    statusLine({ ...IDLE_REPAIR, status: 'complete', repaired: 2, failed: 1 }),
    translate('目录模板里有空的一层'),
  ];
  for (const text of texts) expect(text).not.toMatch(/\p{Script=Han}/u);
  expect(playedFor(5400)).toContain('1.5');
  expect(DIRECTORY_TEMPLATE_ERROR.test('目录模板里有空的一层')).toBe(true);
  expect(statusLine({ ...IDLE_REPAIR, status: 'running', stage: '修复', message: 'Private 中文 ไทย.mp4', total: 3, checked: 9 }))
    .toContain('3 / 3 · Private 中文 ไทย.mp4');
});

for (const locale of ['zh-CN', 'en', 'th'] as const) it(`${locale}: 分析总结翻译分类，保留标签与创作者`, () => {
  saveLanguage(locale);
  const original: TasteAnalysis = {
    headline: '浏览兴趣以3D/动画为主，Peach 中稳定出现Private 中文 ไทย。',
    confidence: { level: 'early', label: '仍在学习' },
    points: [{ label: '浏览主线', text: '3D/动画' }, { label: 'Peach 印证', text: 'Private 中文 ไทย' }],
    explore: [{ tag: 'Private 中文 ไทย', title: '探索 Private 中文 ไทย', detail: '浏览信号 12 次 · 馆藏 3 部 · 尚无观看印证' }],
    next_steps: [{ route: '/subscriptions', title: '追踪常访创作者', detail: 'Private 中文 ไทย' },
      { route: '/review', title: '补齐馆藏证据', detail: '2 项待补 Tag · 3 项待补身份' }],
  };
  const before = structuredClone(original);
  const result = analysisPresentation(original)!;
  expect(original).toEqual(before);
  expect(result.headline).toContain('Private 中文 ไทย');
  expect(result.points?.[1]?.text).toBe('Private 中文 ไทย');
  expect(result.explore?.[0]?.tag).toBe('Private 中文 ไทย');
  expect(result.explore?.[0]?.title).toContain('Private 中文 ไทย');
  expect(result.next_steps?.[0]?.detail).toBe('Private 中文 ไทย');
  expect(result.next_steps?.map(step => step.route)).toEqual(['/subscriptions', '/review']);
  if (locale === 'zh-CN') expect(result).toEqual(original);
  else {
    const text = JSON.stringify(result).replaceAll('Private 中文 ไทย', 'Private');
    expect(text).not.toMatch(/\p{Script=Han}/u);
    expect(result.explore?.[0]?.detail).toContain('12');
  }
});
