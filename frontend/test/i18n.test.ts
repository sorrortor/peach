import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../src/i18n/messages.json';
import { LANGUAGE_KEY, initializeLanguage, language, saveLanguage, translate } from '../src/i18n';
import { localizeJsx } from '../i18n-plugin';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('界面语言', () => {
  it('persists supported languages and keeps unknown content intact', () => {
    expect(language()).toBe('zh-CN');
    for (const locale of ['th', 'en', 'zh-CN']) {
      expect(saveLanguage(locale)).toBe(true);
      expect(language()).toBe(locale);
      expect(translate('A private filename.mp4')).toBe('A private filename.mp4');
    }
    expect(saveLanguage('invalid')).toBe(false);
    localStorage.setItem(LANGUAGE_KEY, 'invalid');
    expect(language()).toBe('zh-CN');
  });

  it('localizes labels and document semantics without network access', () => {
    saveLanguage('th');
    document.title = '登录 Peach';
    initializeLanguage();
    expect(document.documentElement.lang).toBe('th');
    expect(document.documentElement.getAttribute('translate')).toBe('no');
    expect(document.title).toBe('เข้าสู่ระบบ Peach');
    expect(translate('保存配置')).toBe('บันทึกการตั้งค่า');
    expect(translate('保存配置', 'en')).toBe('Save settings');
    expect(translate('保存配置', 'zh-CN')).toBe('保存配置');
  });

  it('handles unavailable browser storage', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(language()).toBe('zh-CN');
    expect(saveLanguage('en')).toBe(false);
  });

  it('has both translations for every catalog entry', () => {
    for (const pair of Object.values(messages)) {
      expect(pair).toHaveLength(2);
      expect(pair.every(value => value.trim().length > 0)).toBe(true);
    }
  });

  it('transforms display JSX without changing values or control flow', () => {
    const source = 'const state="登录"; const node=<button value="登录" title="登录">登录</button>;';
    const code = localizeJsx(source, 'sample.tsx');
    expect(code).toContain('const state="登录"');
    expect(code).toContain('value="登录"');
    expect(code).toContain('title={__peachTranslate("登录")}');
    expect(code).toContain('>{__peachTranslate("登录")}</button>');
    expect(localizeJsx('const node=<p>Private title</p>', 'sample.tsx')).toBeNull();
    expect(localizeJsx('const node=<p>登录 {name}</p>', 'sample.tsx')).toContain('__peachTranslate("登录") + " "');
  });
});
