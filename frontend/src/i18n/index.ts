import messages from './messages.json';

export const LANGUAGES = ['zh-CN', 'en', 'th'] as const;
export type Language = typeof LANGUAGES[number];
export const LANGUAGE_KEY = 'peach.language.v1';
const catalog: Record<string, readonly string[]> = messages;
let currentLanguage: Language | undefined;
const templates = Object.keys(catalog).filter(key => /\{\d+\}/.test(key))
  .sort((a, b) => b.replace(/\{\d+\}/g, '').length - a.replace(/\{\d+\}/g, '').length).map(key => {
  const indices: number[] = [];
  const escaped = key.split(/(\{\d+\})/).map(part => {
    if (/^\{\d+\}$/.test(part)) { indices.push(Number(part.slice(1, -1))); return '(.*?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { key, indices, pattern: new RegExp(`^${escaped}$`, 'su') };
});

export function language(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (LANGUAGES.includes(saved as Language)) return saved as Language;
  } catch { /* 浏览器禁止存储时仍可使用默认语言。 */ }
  return 'zh-CN';
}

export function translate(text: string, locale: Language = currentLanguage ?? (currentLanguage = language())): string {
  if (locale === 'zh-CN') return text;
  const column = locale === 'en' ? 0 : 1;
  const exact = catalog[text]?.[column];
  if (exact !== undefined) return exact;
  if (text.length <= 8192 && /\p{Script=Han}/u.test(text)) {
    for (const template of templates) {
      const match = template.pattern.exec(text);
      if (!match) continue;
      const values = new Map(template.indices.map((index, at) => [index, match[at + 1] ?? '']));
      return (catalog[template.key]?.[column] ?? template.key).replace(/\{(\d+)\}/g,
        (placeholder, index: string) => values.get(Number(index)) ?? placeholder);
    }
  }
  return text;
}

/** 插值只替换模板占位，名称、路径、错误详情等值不参与字串匹配。 */
export function format(template: string, ...values: unknown[]): string {
  return translate(template).replace(/\{(\d+)\}/g, (placeholder, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : placeholder);
}

export function saveLanguage(locale: string): boolean {
  if (!LANGUAGES.includes(locale as Language)) return false;
  try { localStorage.setItem(LANGUAGE_KEY, locale); }
  catch { return false; }
  currentLanguage = locale as Language;
  return true;
}

export function initializeLanguage(): void {
  currentLanguage = language();
  document.documentElement.lang = currentLanguage;
  document.documentElement.setAttribute('translate', 'no');
  document.title = translate(document.title);
  const skipLink = document.querySelector('a[href="#main"]');
  if (skipLink?.textContent) skipLink.textContent = translate(skipLink.textContent);
  const heading = document.querySelector('#catalogPageHeading [data-page-title]');
  if (heading?.textContent) heading.textContent = translate(heading.textContent);
  // 启动时壳的静态控件还未交给 React；只处理展示属性，不改输入值或节点结构。
  for (const node of document.querySelectorAll('[title], [aria-label], [placeholder]')) {
    for (const attribute of ['title', 'aria-label', 'placeholder']) {
      const value = node.getAttribute(attribute);
      if (value) node.setAttribute(attribute, translate(value));
    }
  }
}
