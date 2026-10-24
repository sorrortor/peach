import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'playwright-core';
import { launch, VIEWPORTS } from './harness.ts';
import { openHome, openPanel } from './settings-fixture.ts';

describe('网页观看入口', () => {
  let browser: Browser;
  before(async () => { browser = await launch() });
  after(async () => { await browser?.close() });
  for (const viewport of VIEWPORTS) {
    it(`${viewport.name} 显式打开和关闭窗口，不提交下载`, { timeout: 60000 }, async () => {
      const opened = await openHome(browser, viewport);
      const { page } = opened;
      let state = 'closed';
      const posts: Record<string, unknown>[] = [];
      let downloads = 0;
      await page.route('**/api/web-watch', async route => {
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON();
          posts.push(body);
          state = body.action === 'close' ? 'closed' : 'ready';
        }
        await route.fulfill({ json: { available: true, state, popups: 0 } });
      });
      await page.route('**/api/downloads', async route => {
        if (route.request().method() === 'POST') downloads++;
        await route.fulfill({ json: {} });
      });
      try {
        await openPanel(page, '浏览与播放');
        const panel = page.locator('[data-web-watch]');
        await panel.waitFor({ state: 'visible' });
        assert.equal(posts.length, 0);
        await panel.getByRole('textbox', { name: '网页地址' }).fill('https://media.w3.org/2010/05/sintel/trailer.mp4');
        await panel.getByRole('button', { name: '打开观看窗口' }).click();
        await panel.getByText('观看窗口已就绪', { exact: true }).waitFor();
        assert.equal(posts[0]?.action, 'open');
        assert.equal(posts[0]?.language, 'zh');
        assert.ok(await panel.getByRole('button', { name: '打开观看窗口' }).isDisabled());
        const bounds = await panel.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
        await panel.getByRole('button', { name: '关闭观看窗口' }).click();
        await panel.getByText('尚未打开观看窗口', { exact: true }).waitFor();
        assert.equal(posts[1]?.action, 'close');
        assert.equal(downloads, 0);
      } finally {
        await opened.close();
      }
    });
  }
});
