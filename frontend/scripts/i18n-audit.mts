/** 界面语言目录覆盖报告；只读源码，不读取运行时配置、凭据或媒体。 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { displayMessages, playerDisplayMessages, markupDisplayMessages, localizedAreas } from '../i18n-plugin.ts';
import messages from '../src/i18n/messages.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '../src');
const missing = new Map<string, string[]>();
let files = 0;
for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:tsx?|js)$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue;
  const path = resolve(entry.parentPath, entry.name);
  if (/\/(?:boardui|evilcharts|i18n)\//.test(path)) continue;
  files += 1;
  const source = readFileSync(path, 'utf8');
  const texts = path.includes('/src/player/') ? playerDisplayMessages(source, path)
    : path.endsWith('.tsx') && localizedAreas.test(path) ? displayMessages(source, path) : markupDisplayMessages(source, path);
  for (const text of texts) {
    if (Object.hasOwn(messages, text)) continue;
    const places = missing.get(text) ?? [];
    places.push(path.slice(root.length + 1));
    missing.set(text, places);
  }
}
console.log(JSON.stringify({ files, missing: Object.fromEntries(missing) }, null, 2));
process.exitCode = missing.size ? 1 : 0;
