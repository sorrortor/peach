import { afterEach, expect, it } from 'vitest';
import { saveLanguage } from '../../src/i18n';
import { SourceSelect } from '../../src/react/settings/folder-rows';
import { LoginPage } from '../../src/react/pages/login/login-page';
import { mount, type } from './render';

afterEach(() => localStorage.clear());

it('登录表单在三种语言下保留原生校验、错误播报与提交字段', async () => {
  for (const [locale, label, error] of [
    ['th', 'รหัสผ่านเข้าใช้งาน', 'รหัสผ่านเข้าใช้งานไม่ถูกต้อง'],
    ['en', 'Access password', 'Incorrect access password'],
    ['zh-CN', '访问密码', '访问密码不正确'],
  ]) {
    saveLanguage(locale!);
    const host = await mount(<LoginPage data={{ invalid: 'true', next: '/settings/library' }} />);
    const input = host.querySelector<HTMLInputElement>('input[name="token"]')!;
    expect(host.textContent).toContain(label);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(error);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('form')!.checkValidity()).toBe(false);
    await type(input, 'test-only-password');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect([...new FormData(host.querySelector('form')!).entries()]).toEqual([
      ['token', 'test-only-password'], ['next', '/settings/library'], ['days', '30'],
    ]);
    expect(host.querySelector('select')?.value).toBe(locale);
    host.remove();
  }
});

it('媒体来源选择按语言显示名称，同时保留原始来源键', async () => {
  for (const [locale, label] of [['th', 'ดิสก์ในเครื่อง'], ['en', 'Local disk'], ['zh-CN', '本地磁盘']]) {
    saveLanguage(locale!);
    const host = await mount(<SourceSelect index={0} value="local" onChange={() => {}} />);
    expect(host.textContent).toContain(label);
    expect(host.querySelector('select')?.value).toBe('local');
    if (locale !== 'zh-CN') expect(host.textContent).not.toMatch(/\p{Script=Han}/u);
    host.remove();
  }
});
