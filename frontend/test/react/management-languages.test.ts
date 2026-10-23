/** 翻译只折算展示，复核决定、保留规则与私有名称保持原样。 */
import { afterEach, expect, it } from 'vitest';
import { saveLanguage, translate } from '../../src/i18n';
import { elapsedText, statusLabel, summaryText, taskMessage, taskProgressLabel, type TaskRunPayload } from '../../src/react/activity/tasks';
import { decisionPayload, defaultChoice, groupReviewRows, rowTitle, type ReviewRow } from '../../src/react/review/review';
import { duplicateVictims, type DuplicateGroup } from '../../src/react/duplicates/duplicates';
import { manageHeaderView, trashLedeText } from '../../src/manage-header';

afterEach(() => { saveLanguage('zh-CN'); localStorage.clear() });
for (const locale of ['th', 'en'] as const) it(`${locale}: 任务状态、耗时与调度原因翻译，数据名称不变`, () => {
  saveLanguage(locale);
  for (const text of [elapsedText(75), elapsedText(73 * 3600), statusLabel('interrupted'),
    taskMessage('与第 12 轮（手动触发）冲突，本次跳过'),
    summaryText({ checked: 3, operation: '扫描文件', stage: '处理结束', error: '20 项需要处理，可重试未完成的部分。',
      requested_stage: 'metadata', speed_mode: 'standard', eta_kind: 'estimating', eta_scope: '整趟任务',
      eta_basis: '汇总当前阶段与所有待执行阶段的剩余耗时', probed: 20 }),
    trashLedeText({ total: 1, shown: 1 }), translate('文件和馆藏记录会永久删除，无法恢复。')]) {
    expect(text).not.toMatch(/\p{Script=Han}/u);
  }
  expect(summaryText({ name: '保存', private: 'Private 中文 ไทย' })).toContain('保存');
  expect(taskProgressLabel({ task_label: '扫描与采集', progress_label: '扫描与采集：Private 中文 ไทย' } as TaskRunPayload))
    .toContain('Private 中文 ไทย');
  expect(statusLabel('unknown')).toBe('unknown');
  expect(manageHeaderView({ section: 'cleanup', path: '/review', sections: [['cleanup', '数据管理', 'database']], menu: [], trash: null })?.crumb)
    .not.toMatch(/\p{Script=Han}/u);
});

for (const locale of ['zh-CN', 'th', 'en'] as const) it(`${locale}: 显示字段名不改复核参数或重复文件保留结果`, () => {
  const row: ReviewRow = { item_key: 'row:1', query: 'Private 中文 ไทย', field: 'title', field_label: '标题',
    candidates: [{ candidate_key: 'nfo:1', source: 'nfo', display_value: '保存' }] };
  saveLanguage('zh-CN');
  const expected = decisionPayload('metadata_fields', row, 'approved', defaultChoice(row));
  saveLanguage(locale);
  expect(rowTitle('metadata_fields', row)).toContain('Private 中文 ไทย');
  expect(groupReviewRows([row], 'field')[0]?.key).toBe('title');
  expect(decisionPayload('metadata_fields', row, 'approved', defaultChoice(row))).toEqual(expected);
  expect(row.candidates?.[0]?.display_value).toBe('保存');
  const groups: DuplicateGroup[] = [{ code: 'TEST', files: [
    { id: 1, name: 'Private 中文 ไทย', path: null, location: 'local', drive: 'R:', size: 20, duration: 10, is_largest: true, is_longest: false },
    { id: 2, name: '保存', path: null, location: 'local', drive: 'R:', size: 10, duration: 20, is_largest: false, is_longest: true },
  ], count: 2, identical: false, drives: ['R:'], cross_drive: false, reclaimable: 10 }];
  expect(duplicateVictims(groups, 'largest')).toEqual([2]);
  expect(duplicateVictims(groups, 'longest')).toEqual([1]);
});
