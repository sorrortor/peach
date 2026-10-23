import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { saveLanguage, translate } from '../../src/i18n';
import { factRows, companyFactRows } from '../../src/react/entity-hero/entity-hero';
import { pickerNote } from '../../src/react/avatar-picker/avatar-picker';
import { checkText } from '../../src/react/scraping/scraping';
import { searchNote, wantName, type Want } from '../../src/react/wants/wants';
import { errorTitle } from '../../src/react/pages/error/error-page';
import { SetupForm } from '../../src/react/pages/setup/setup-form';
import type { SetupQuestions } from '../../src/react/pages/setup/setup-api';
import { NumberSetting } from '../../src/react/settings-panel/number-setting';
import { configurationSkeleton } from '../../src/configuration-skeleton';
import { islandButton, islandSearchInput, islandSelect, islandSummary } from '../../src/island-skeleton';
import { mount, click } from './render';

const PRIVATE = 'Private 中文 ไทย';
afterEach(() => { saveLanguage('zh-CN'); localStorage.clear() });
const noChinese = (value: string) => expect(value.replaceAll(PRIVATE, 'Private')).not.toMatch(/\p{Script=Han}/u);

it.each(['en', 'th'])('localizes loading controls in %s while retaining selected section and private input', locale => {
  saveLanguage(locale);
  const host = document.createElement('div');
  host.innerHTML = configurationSkeleton('媒体库与入库')
    + islandButton({label:'保存配置',attrs:'data-action="save"'})
    + islandSearchInput('搜索',PRIVATE) + islandSelect('本地') + islandSummary('待判断');
  noChinese(host.textContent ?? '');
  expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe(translate('媒体库与入库'));
  expect(host.querySelector<HTMLInputElement>('input')?.value).toBe(PRIVATE);
  expect(host.querySelector('[data-action="save"]')?.textContent).toBe(translate('保存配置'));
});

it.each(['en', 'th'])('localizes profile facts, wanted status and connection results in %s while preserving values', locale => {
  saveLanguage(locale);
  const profile = { birth_date: '2000-01-01', age: 26, height: 170, cup: 'C', debut_title: PRIVATE, active: { from: '2020', ongoing: true }, tags: [PRIVATE] };
  const original = structuredClone(profile);
  const facts = factRows(profile);
  noChinese(JSON.stringify(facts));
  expect(profile).toEqual(original);
  expect(JSON.stringify(facts)).toContain(PRIVATE);
  noChinese(JSON.stringify(companyFactRows({ legal_name: { value: PRIVATE, source_url: 'https://example.invalid/' }, founded: { value: '2020', source_url: 'https://example.invalid/' } })));
  const want = { id: 1, title: PRIVATE, phase: 'given_up', search_count: 3 } as Want;
  expect(wantName(want)).toBe(PRIVATE);
  noChinese(searchNote(want));
  expect(want.phase).toBe('given_up');
  noChinese(pickerNote(PRIVATE, { kind: 'performer', entity_id: 1, names: [PRIVATE], matched_names: [PRIVATE], choices: [], index_age_hours: null, index_stale: false }));
  noChinese(checkText({ label: '来源页面', ok: false, elapsed_s: 1.5 }, PRIVATE));
  noChinese(errorTitle('403'));
  noChinese(errorTitle('404'));
  noChinese(errorTitle('409'));
});

it.each(['en', 'th'])('localizes setup questions and options in %s without changing folder values or access keys', async locale => {
  saveLanguage(locale);
  const setup: SetupQuestions = {
    windows: false, standalone: false, media_sources: [{ value: 'local', label: '本地磁盘' }], media_source_default: 'local', media_root: null,
    cloud: { help: '', link: { url: '', label: '' }, dependencies: [] }, access_enabled: false, scan_now: false, history_guide: false,
    questions: [
      { key: 'media_dir', label: '媒体库', help: ['Peach 从媒体库读取视频和图片。'], default: `/synthetic/${PRIVATE}`, required: true, advanced: false, input: 'folders', prefix: '', suffix: '' },
      { key: 'host', label: '谁可以访问', help: [], default: '2', required: true, advanced: true, input: 'choice', prefix: '', suffix: '',
        options: [{ value: '1', label: '只有这台电脑' }, { value: '2', label: '同一局域网的设备' }] },
    ],
  };
  const before = structuredClone(setup);
  const host = await mount(<SetupForm setup={setup} onDone={() => {}} />);
  await click(host.querySelector('summary')!);
  noChinese(host.textContent ?? '');
  expect([...host.querySelectorAll<HTMLInputElement>('input')].some(input => input.value === `/synthetic/${PRIVATE}`)).toBe(true);
  expect([...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(input => input.value)).toContain('2');
  expect(setup).toEqual(before);
});

it.each(['en', 'th'])('announces translated numeric validation in %s and prevents invalid writes', async locale => {
  saveLanguage(locale);
  const apply = vi.fn();
  const host = await mount(<NumberSetting id="seekSecondsSetting" label={translate('快进')} value={10} onApply={apply} />);
  const input = host.querySelector<HTMLInputElement>('input[type="number"]')!;
  await act(async () => { input.value = ''; input.dispatchEvent(new Event('change', { bubbles: true })) });
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(host.querySelector('[data-number-error]')?.textContent?.trim()).toBeTruthy();
  noChinese(host.textContent ?? '');
  expect(apply).not.toHaveBeenCalled();
});
