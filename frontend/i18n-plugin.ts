import { fileURLToPath } from 'node:url';
import { parseSync } from 'oxc-parser';
import type { Plugin } from 'vite';
import messages from './src/i18n/messages.json';

const labels = new Set(['label', 'title', 'legend', 'hint', 'description', 'placeholder', 'aria-label', 'alt', 'lede']);
const known = new Set(Object.keys(messages));
const localizedAreas = /\/src\/react\/(?:settings|settings-panel|sidebar|catalog-filter|catalog-grid|catalog-folders|library-shortcuts|library-processing|components|manage-header|entity-filter|pages\/login)\//;

/** JSX 的行首缩进不展示，同一行与内联节点之间的空格属于文案。 */
function jsxText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  const last = lines.map(line => /[^ \t]/.test(line)).lastIndexOf(true);
  return lines.map((line, index) => {
    let text = line.replace(/\t/g, ' ');
    if (index !== 0) text = text.replace(/^ +/, '');
    if (index !== lines.length - 1) text = text.replace(/ +$/, '');
    return text && index !== last ? `${text} ` : text;
  }).join('');
}

/** 仅转换 JSX 的展示字串；不处理 value、键、网络参数、用户数据或控制流。 */
export function localizeJsx(source: string, id: string, runtime = '/src/i18n/index.ts'): string | null {
  const edits: { start: number; end: number; value: string }[] = [];
  const ast = parseSync(id, source);
  if (ast.errors.length) throw new Error(`Unable to parse ${id}: ${ast.errors[0]?.message}`);
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const item = node as Record<string, any>;
    let text: string | undefined;
    let target = item;
    if (item.type === 'JSXText') text = item.value.trim();
    if (item.type === 'JSXAttribute' && labels.has(item.name.name) && item.value?.type === 'Literal') {
      text = item.value.value; target = item.value;
    }
    if (typeof text === 'string' && known.has(text)) {
      const display = item.type === 'JSXText' ? jsxText(item.value) : text;
      const prefix = display.slice(0, display.indexOf(text));
      const suffix = display.slice(display.indexOf(text) + text.length);
      const expression = [prefix ? JSON.stringify(prefix) : '', `__peachTranslate(${JSON.stringify(text)})`, suffix ? JSON.stringify(suffix) : ''].filter(Boolean).join(' + ');
      edits.push({ start: target.start, end: target.end, value: `{${expression}}` });
      return;
    }
    for (const child of Object.values(item)) {
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === 'object') walk(child);
    }
  };
  walk(ast.program);
  if (!edits.length) return null;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  }
  return `import {translate as __peachTranslate} from ${JSON.stringify(runtime)};\n${source}`;
}

export function i18nPlugin(): Plugin {
  const runtime = fileURLToPath(new URL('./src/i18n/index.ts', import.meta.url));
  return { name: 'peach-ui-languages', enforce: 'pre', transform(source, id) {
    if (!id.endsWith('.tsx') || !localizedAreas.test(id)) return;
    const code = localizeJsx(source, id, runtime);
    return code ? { code, map: null } : null;
  } };
}
