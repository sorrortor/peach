import { fileURLToPath } from 'node:url';
import { parseSync } from 'oxc-parser';
import type { Plugin } from 'vite';
import messages from './src/i18n/messages.json' with { type: 'json' };

const labels = new Set(['label', 'title', 'legend', 'hint', 'description', 'placeholder', 'aria-label', 'alt', 'lede', 'summary', 'term', 'status', 'topLabel', 'bottomLabel', 'busyLabel', 'emptyLabel', 'message']);
const dashboardLabels = new Set(['empty', 'unit', 'series', 'figure', 'meta', 'detail', 'note', 'textValue', 'detailTitle']);
const known = new Set(Object.keys(messages));
export const localizedAreas = /\/src\/react\/(?!boardui\/|evilcharts\/)/;

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
  const displayAttribute = (name: string) => labels.has(name)
    || localizedAreas.test(id) && dashboardLabels.has(name);
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
    // 遗留壳的展示出口与 JSX 使用同一边界；属性名、请求参数和数据值不转换。
    if (item.type === 'CallExpression') {
      const method = item.callee?.type === 'MemberExpression' ? item.callee.property?.name : item.callee?.name;
      if (method === 'setAttribute' && ['aria-label', 'title', 'placeholder', 'alt'].includes(item.arguments[0]?.value)) display(item.arguments[1]);
      if (['toast', 'receipt', 'actionReceipt', 'actionFailure', 'spinnerHtml', 'loadingDotsHtml'].includes(method)) display(item.arguments[0]);
    }
    if (item.type === 'AssignmentExpression' && item.left?.type === 'MemberExpression'
      && ['textContent', 'title', 'placeholder'].includes(item.left.property?.name)) display(item.right);
    if (item.type === 'CallExpression' && ['translate', 'format', 'markupText'].includes(item.callee?.name)
      && typeof item.arguments[0]?.value === 'string' && /\p{Script=Han}/u.test(item.arguments[0].value)) messages.add(item.arguments[0].value);
    let text: string | undefined;
    let target = item;
    if (item.type === 'JSXText') text = jsxText(item.value).trim();
    if (item.type === 'JSXExpressionContainer') {
      display(item.expression);
    }
    if (item.type === 'JSXAttribute' && displayAttribute(item.name.name) && item.value?.type === 'Literal') {
      text = item.value.value; target = item.value;
    }
    // 非展示属性（value、id、data-*、事件、请求参数）不进入表达式转换。
    if (item.type === 'JSXAttribute' && !displayAttribute(item.name.name)) {
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

/** 播放器自有菜单的静态 HTML；插值、资源地址、属性键与用户字幕名不参与翻译。 */
function playerDisplay(source: string, id: string, markupOnly = false) {
  const catalog = new Set<string>();
  type Edit = { start: number; end: number; value: string };
  const apply = (start: number, end: number, edits: Edit[]) => {
    let text = source.slice(start, end);
    for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start - start) + edit.value + text.slice(edit.end - start);
    return text;
  };
  const markup = (text: string) => {
    const parts: string[] = [];
    let at = 0;
    const pattern = /\b(?:aria-label|title|label|placeholder|alt)=["']([^"']*\p{Script=Han}[^"']*)(?:["']|$)|(?:^|>)([^<>]*\p{Script=Han}[^<>]*)(?=<|$)/gu;
    for (const match of text.matchAll(pattern)) {
      const value = match[1] ?? match[2]!;
      // 插值可能把属性截成两段；不把属性残片当正文，也不转换 data-*。
      if (!match[1] && /["']|\b[\w-]+=/.test(value)) continue;
      const key = value.trim();
      catalog.add(key);
      if (!known.has(key)) continue;
      const start = match.index! + match[0].indexOf(value) + value.indexOf(key);
      parts.push(JSON.stringify(text.slice(at, start)), `__peachMarkup(${JSON.stringify(key)})`);
      at = start + key.length;
    }
    parts.push(JSON.stringify(text.slice(at)));
    return parts.join(' + ');
  };
  const visit = (node: any, parent?: any, field?: string): Edit[] => {
    if (!node || typeof node !== 'object') return [];
    if ((parent?.type === 'Property' || parent?.type === 'MemberExpression') && field === 'key' && !parent.computed) return [];
    const nested: Edit[] = [];
    for (const [key, child] of Object.entries(node)) {
      if (Array.isArray(child)) child.forEach(value => nested.push(...visit(value, node, key)));
      else if (child && typeof child === 'object') nested.push(...visit(child, node, key));
    }
    if (node.type === 'Literal' && typeof node.value === 'string' && /\p{Script=Han}/u.test(node.value)) {
      if (/<[a-z/][^>]*>/i.test(node.value)) return [{ start: node.start, end: node.end, value: `(${markup(node.value)})` }];
      if (markupOnly) return nested;
      catalog.add(node.value);
      if (known.has(node.value)) return [{ start: node.start, end: node.end, value: `__peachTranslate(${JSON.stringify(node.value)})` }];
    }
    if (node.type === 'TemplateLiteral' && node.quasis.some((part: any) => /\p{Script=Han}/u.test(part.value.cooked))) {
      const values = node.expressions.map((expression: any) => `(${apply(expression.start, expression.end, nested.filter(edit => edit.start >= expression.start && edit.end <= expression.end))})`);
      const key = node.quasis.map((part: any, index: number) => part.value.cooked + (index < values.length ? `{${index}}` : '')).join('');
      if (/<[a-z/][^>]*>/i.test(key)) {
        const parts = node.quasis.flatMap((part: any, index: number) => [markup(part.value.cooked), ...(index < values.length ? [values[index]] : [])]);
        return [{ start: node.start, end: node.end, value: `(${parts.join(' + ')})` }];
      }
      if (markupOnly) return nested;
      catalog.add(key);
      if (known.has(key)) return [{ start: node.start, end: node.end, value: `__peachFormat(${JSON.stringify(key)}${values.length ? ', ' + values.join(', ') : ''})` }];
    }
    return nested;
  };
  const ast = parseSync(id, source);
  if (ast.errors.length) throw new Error(`Unable to parse ${id}: ${ast.errors[0]?.message}`);
  const edits = visit(ast.program);
  return { messages: [...catalog], code: edits.length ? apply(0, source.length, edits) : null };
}

export const playerDisplayMessages = (source: string, id: string) => playerDisplay(source, id).messages;
export const markupDisplayMessages = (source: string, id: string) => [...new Set([...playerDisplay(source, id, true).messages, ...displayMessages(source, id)])];
export function localizeMarkup(source: string, id: string, runtime = '/src/i18n/index.ts'): string | null {
  const { code } = playerDisplay(source, id, true);
  const localized = localizeJsx(code ?? source, id, runtime);
  const result = localized ?? code;
  return result ? (code ? `import { markupText as __peachMarkup } from ${JSON.stringify(runtime)};\n` : '') + result : null;
}
export function localizePlayer(source: string, id: string, runtime = '/src/i18n/index.ts'): string | null {
  const { code } = playerDisplay(source, id);
  return code ? `import { translate as __peachTranslate, format as __peachFormat, markupText as __peachMarkup } from ${JSON.stringify(runtime)};\n${code}` : null;
}

export function i18nPlugin(): Plugin {
  const runtime = fileURLToPath(new URL('./src/i18n/index.ts', import.meta.url));
  return { name: 'peach-ui-languages', enforce: 'pre', transform(source, id) {
    const player = /\/src\/player\/[^/]+\.ts$/.test(id);
    const jsx = id.endsWith('.tsx') && localizedAreas.test(id);
    const markup = /\/src\//.test(id) && /\.(?:ts|js)$/.test(id) && !/\/(?:boardui|evilcharts|i18n)\//.test(id);
    if (!player && !jsx && !markup) return;
    const code = player ? localizePlayer(source, id, runtime) : jsx ? localizeJsx(source, id, runtime) : localizeMarkup(source, id, runtime);
    return code ? { code, map: null } : null;
  } };
}
