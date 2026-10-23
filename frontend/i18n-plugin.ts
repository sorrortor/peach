import { fileURLToPath } from 'node:url';
import { parseSync } from 'oxc-parser';
import type { Plugin } from 'vite';
import messages from './src/i18n/messages.json' with { type: 'json' };

const labels = new Set(['label', 'title', 'legend', 'hint', 'description', 'placeholder', 'aria-label', 'alt', 'lede', 'summary', 'term', 'status', 'topLabel', 'bottomLabel', 'busyLabel', 'emptyLabel', 'message']);
const known = new Set(Object.keys(messages));
export const localizedAreas = /\/src\/react\/(?:settings|settings-panel|sidebar|catalog-filter|catalog-grid|catalog-folders|library-shortcuts|library-processing|components|manage-header|entity-filter|item-detail|diagnostics|glow-picker|follow-manage(?=\/credentials\.tsx)|pages\/login)\//;

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
function displayEdits(source: string, id: string) {
  const edits: { start: number; end: number; value: string }[] = [];
  const messages = new Set<string>();
  const ast = parseSync(id, source);
  if (ast.errors.length) throw new Error(`Unable to parse ${id}: ${ast.errors[0]?.message}`);
  const add = (item: Record<string, any>, text: string, expression: string) => {
    if (!/\p{Script=Han}/u.test(text)) return;
    messages.add(text);
    if (known.has(text)) edits.push({ start: item.start, end: item.end, value: expression });
  };
  // 只走展示表达式的值分支；条件、函数参数、属性键及插值中的用户数据保持原样。
  const display = (item: Record<string, any> | null) => {
    if (!item) return;
    if (item.type === 'Literal' && typeof item.value === 'string') {
      add(item, item.value, `__peachTranslate(${JSON.stringify(item.value)})`);
    } else if (item.type === 'TemplateLiteral') {
      const text = item.quasis.map((part: any, index: number) => part.value.cooked + (index < item.expressions.length ? `{${index}}` : '')).join('');
      const values = item.expressions.map((expression: any) => `(${source.slice(expression.start, expression.end)})`);
      add(item, text, `__peachFormat(${JSON.stringify(text)}${values.length ? ', ' + values.join(', ') : ''})`);
    } else if (item.type === 'ConditionalExpression') {
      display(item.consequent); display(item.alternate);
    } else if (item.type === 'LogicalExpression') display(item.right);
    else if (item.type === 'BinaryExpression' && item.operator === '+') { display(item.left); display(item.right); }
  };
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const item = node as Record<string, any>;
    if (item.type === 'CallExpression' && ['translate', 'format'].includes(item.callee?.name)
      && typeof item.arguments[0]?.value === 'string' && /\p{Script=Han}/u.test(item.arguments[0].value)) messages.add(item.arguments[0].value);
    let text: string | undefined;
    let target = item;
    if (item.type === 'JSXText') text = jsxText(item.value).trim();
    if (item.type === 'JSXExpressionContainer') {
      display(item.expression);
    }
    if (item.type === 'JSXAttribute' && labels.has(item.name.name) && item.value?.type === 'Literal') {
      text = item.value.value; target = item.value;
    }
    // 非展示属性（value、id、data-*、事件、请求参数）不进入表达式转换。
    if (item.type === 'JSXAttribute' && !labels.has(item.name.name)) {
      // top、children、render 等非文案属性也能承载 JSX；只进入嵌套节点，不改参数或属性值。
      const embedded = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        const child = value as Record<string, any>;
        if (child.type === 'JSXElement' || child.type === 'JSXFragment') { walk(child); return; }
        for (const nested of Object.values(child)) {
          if (Array.isArray(nested)) nested.forEach(embedded); else if (nested && typeof nested === 'object') embedded(nested);
        }
      };
      embedded(item.value);
      return;
    }
    if (typeof text === 'string' && /\p{Script=Han}/u.test(text)) {
      messages.add(text);
      if (!known.has(text)) return;
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
  return { edits, messages: [...messages] };
}

export function displayMessages(source: string, id: string): string[] {
  return displayEdits(source, id).messages;
}

export function localizeJsx(source: string, id: string, runtime = '/src/i18n/index.ts'): string | null {
  const { edits } = displayEdits(source, id);
  if (!edits.length) return null;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  }
  return `import {translate as __peachTranslate, format as __peachFormat} from ${JSON.stringify(runtime)};\n${source}`;
}

export function i18nPlugin(): Plugin {
  const runtime = fileURLToPath(new URL('./src/i18n/index.ts', import.meta.url));
  return { name: 'peach-ui-languages', enforce: 'pre', transform(source, id) {
    if (!id.endsWith('.tsx') || !localizedAreas.test(id)) return;
    const code = localizeJsx(source, id, runtime);
    return code ? { code, map: null } : null;
  } };
}
