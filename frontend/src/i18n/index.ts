import messages from './messages.json';

export const LANGUAGES = ['zh-CN', 'en', 'th'] as const;
export type Language = typeof LANGUAGES[number];
export const LANGUAGE_KEY = 'peach.language.v1';
const catalog: Record<string, readonly string[]> = messages;
let currentLanguage: Language | undefined;

export function language(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (LANGUAGES.includes(saved as Language)) return saved as Language;
  } catch { /* 浏览器禁止存储时仍可使用默认语言。 */ }
  return 'zh-CN';
}

export function translate(text: string, locale: Language = currentLanguage ?? (currentLanguage = language())): string {
  if (locale === 'zh-CN') return text;
  return catalog[text]?.[locale === 'en' ? 0 : 1] ?? text;
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
