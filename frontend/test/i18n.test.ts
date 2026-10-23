import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../src/i18n/messages.json';
import { LANGUAGE_KEY, initializeLanguage, language, saveLanguage, translate, format, markupText } from '../src/i18n';
import { localizeJsx, localizePlayer, playerDisplayMessages, displayMessages, localizedAreas } from '../i18n-plugin';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

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
    document.body.innerHTML = '<a href="#main">跳到正文</a>';
    initializeLanguage();
    expect(document.documentElement.lang).toBe('th');
    expect(document.documentElement.getAttribute('translate')).toBe('no');
    expect(document.title).toBe('เข้าสู่ระบบ Peach');
    expect(document.querySelector('a[href="#main"]')?.textContent).toBe('ข้ามไปเนื้อหา');
    expect(translate('保存配置')).toBe('บันทึกการตั้งค่า');
    expect(translate('保存配置', 'en')).toBe('Save settings');
    expect(translate('保存配置', 'zh-CN')).toBe('保存配置');
  });

  it('handles unavailable browser storage', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } });
    expect(language()).toBe('zh-CN');
    expect(saveLanguage('en')).toBe(false);
  });

  it('has both translations for every catalog entry', () => {
    for (const [key, pair] of Object.entries(messages)) {
      expect(pair).toHaveLength(2);
      expect(pair.every(value => value.trim().length > 0)).toBe(true);
      if (key !== '中文') expect(pair.some(value => /\p{Script=Han}/u.test(value)), key).toBe(false);
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
  it('preserves private interpolation values and localizes dynamic status messages', () => {
    expect(saveLanguage('en')).toBe(true);
    const name = '保存配置 中文 ไทย <script> $& {1}.mp4';
    expect(format('当前：{0} · {1}{2}', name, 'Scanning', '')).toBe(`Current: ${name} · Scanning`);
    expect(translate('已发现 12 个文件')).toBe('12 files found');
    expect(translate('2 小时 3 分')).toBe('2 hr 3 min');
    saveLanguage('th');
    expect(format('已发现 {0} 个文件', 12)).toBe('พบแล้ว 12 ไฟล์');
    expect(format('当前：{0} · {1}{2}', name, 'Scanning', '')).toContain(name);
  });

  it('only transforms display branches and preserves template expressions', () => {
    const source = 'const node=<button value={x === "登录" ? "登录" : "保存配置"} title={x === "登录" ? "登录" : "保存配置"}>{`已发现 ${name} 个文件`}</button>';
    const code = localizeJsx(source, 'sample.tsx');
    expect(code).toContain('value={x === "登录" ? "登录" : "保存配置"}');
    expect(code).toContain('title={x === "登录" ? __peachTranslate("登录") : __peachTranslate("保存配置")}');
    expect(code).toContain('__peachFormat("已发现 {0} 个文件", (name))');
    const nested = localizeJsx('const node=<Panel top={<div aria-label="视图">登录</div>} onClick={() => save("登录")} />;', 'sample.tsx');
    expect(nested).toContain('aria-label={__peachTranslate("视图")}');
    expect(nested).toContain('save("登录")');
  });

  it('covers every display message in the localized surfaces and preserves placeholders', () => {
    const root = resolve(process.cwd(), 'src/react');
    const missing: Record<string, string[]> = {};
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      const path = resolve(entry.parentPath, entry.name);
      if (!entry.isFile() || !/\.tsx?$/.test(path) || !localizedAreas.test(path)) continue;
      const gaps = displayMessages(readFileSync(path, 'utf8'), path).filter(key => !Object.hasOwn(messages, key));
      if (gaps.length) missing[path.slice(root.length + 1)] = gaps;
    }
    const playerRoot = resolve(root, '../player');
    for (const entry of readdirSync(playerRoot)) {
      if (!entry.endsWith('.ts')) continue;
      const path = resolve(playerRoot, entry);
      const gaps = playerDisplayMessages(readFileSync(path, 'utf8'), path).filter(key => !Object.hasOwn(messages, key));
      if (gaps.length) missing[`player/${entry}`] = gaps;
    }
    expect(missing).toEqual({});
    const slots = (text: string) => [...new Set(text.match(/\{\d+\}/g) ?? [])].sort();
    for (const [key, pair] of Object.entries(messages)) {
      for (const value of pair) expect(slots(value), key).toEqual(slots(key));
    }
  });

  it.each(['en', 'th'])('localizes static player markup in %s while preserving interpolated names and attributes', locale => {
    saveLanguage(locale);
    const source = 'const output = `<button title="播放" data-value="播放">播放</button><span title="另见 ${name}">${name}</span><p>字幕</p>`;';
    const code = localizePlayer(source, 'player.ts')!;
    const run = new Function('__peachTranslate', '__peachFormat', '__peachMarkup', 'name', code.replace(/^import[^\n]+\n/, '') + '\nreturn output;');
    const name = '中文 ไทย &lt;private&gt;';
    const html = run(translate, format, markupText, name);
    const root = document.createElement('div'); root.innerHTML = html;
    expect(root.querySelector('button')?.title).toBe(translate('播放'));
    expect(root.querySelector('button')?.textContent).toBe(translate('播放'));
    expect(root.querySelector('button')?.dataset.value).toBe('播放');
    expect(html).toContain(name);
    expect(root.querySelector('span')?.title).toBe(`${translate('另见')} 中文 ไทย <private>`);
    expect(root.querySelector('p')?.textContent).toBe(translate('字幕'));
    expect(markupText('"<&>')).toBe('&quot;&lt;&amp;&gt;');
  });

});
