import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type {} from './harness';

const duckdbDist = resolve('packages/duckdb-terminal/node_modules/@duckdb/duckdb-wasm/dist');
const uplotDist = resolve('packages/duckdb-terminal/node_modules/uplot/dist');

test.beforeEach(async ({ context }) => {
  // Use the actual installed DuckDB assets, avoiding a CDN dependency in browser CI.
  await context.route(/https:\/\/cdn\.jsdelivr\.net\/npm\/@duckdb\/duckdb-wasm@[^/]+\/dist\/[^/?]+/, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
    return route.fulfill({ path: resolve(duckdbDist, name), contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await context.route(/https?:\/\/(?:community-)?extensions\.duckdb\.org\//, (route) => route.fulfill({ status: 404, body: 'Optional extensions disabled in integration fixture' }));
  await context.route(/https:\/\/cdn\.jsdelivr\.net\/npm\/uplot@[^/]+\/dist\//, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
    return route.fulfill({ path: resolve(uplotDist, name), contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript' });
  });
  await context.addInitScript(() => {
    window.workerStatus = [];
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const status = { name: options?.name ?? String(url), ready: false, error: '' };
        window.workerStatus.push(status);
        this.addEventListener('message', ({ data }) => { if (data?.type === 'ready') status.ready = true; });
        this.addEventListener('error', (error) => { status.error = error.message; });
      }
    };
  });
});

async function openFixture(page: Page) {
  await page.goto('./');
  await page.waitForFunction(() => window.fixture?.ready || window.fixture?.failure);
  expect(await page.evaluate(() => window.fixture.failure)).toBe('');
}
async function text(page: Page) { return page.evaluate(() => window.fixture.text()); }
async function sql(page: Page, query: string) {
  return page.evaluate((query) => window.fixture.terminal.executeSQL(query), query);
}

test('starts the real worker, renders SQL, and loads assets below a base path', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('response', (response) => {
    if (response.url().startsWith('http://127.0.0.1:4174/') && response.status() >= 400) failures.push(response.url());
  });
  await openFixture(page);
  expect(await page.evaluate(() => window.workerStatus.filter((worker) => worker.name === 'gespenst'))).toEqual([{ name: 'gespenst', ready: true, error: '' }]);
  await sql(page, "SELECT 42 AS answer, '🦆 café' AS label");
  expect(await text(page)).toContain('42');
  expect(await text(page)).toContain('café');
  expect(failures).toEqual([]);
});

test('keyboard editing, paste, history, resize and composition', async ({ page }) => {
  await openFixture(page);
  const input = page.locator('.gespenst__input');
  await input.focus();
  await input.pressSequentially('SELECT 42;');
  await expect.poll(() => page.evaluate(() => window.fixture.input)).toBe('SELECT 42;');
  await input.press('Home');
  await expect.poll(() => page.evaluate(() => window.fixture.cursor)).toBe(0);
  await input.press('End');
  await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.fixture.events.length)).toBe(1);
  await input.press('ArrowUp');
  await expect.poll(() => page.evaluate(() => window.fixture.input)).toBe('SELECT 42;');
  await input.press('Control+u');
  await expect.poll(() => page.evaluate(() => window.fixture.input)).toBe('');
  await page.evaluate(() => {
    const input = document.querySelector('.gespenst__input')!;
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', 'SELECT\n 7;\r\n');
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    // Firefox discards constructor-supplied clipboardData on synthetic paste events.
    Object.defineProperty(event, 'clipboardData', { value: clipboardData });
    input.dispatchEvent(event);
  });
  await expect.poll(() => page.evaluate(() => window.fixture.input)).toBe('SELECT 7;');
  expect(await page.evaluate(() => window.fixture.events.length)).toBe(1);
  const before = await page.evaluate(() => window.fixture.native.geometry.cols);
  await page.setViewportSize({ width: 600, height: 700 });
  await expect.poll(() => page.evaluate(() => window.fixture.native.geometry.cols)).toBeLessThan(before);
  await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.fixture.events.length)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.fixture.state)).toBe('idle');
  await page.evaluate(() => {
    const input = document.querySelector('.gespenst__input')!;
    input.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { data: '日本語', bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.fixture.input)).toBe('日本語');
});

test('live theme changes preserve scrollback, input, and database', async ({ page }) => {
  await openFixture(page);
  await sql(page, 'CREATE TABLE preserved AS SELECT 123 AS value');
  await sql(page, 'SELECT * FROM preserved');
  await page.locator('.gespenst__input').pressSequentially('SELECT ');
  const before = await text(page);
  await page.evaluate(() => window.fixture.terminal.setTheme('light'));
  expect(await text(page)).toBe(before);
  expect(await page.evaluate(() => window.fixture.input)).toBe('SELECT ');
  expect(await page.evaluate(() => window.workerStatus.filter((worker) => worker.name === 'gespenst').length)).toBe(1);
  const result = await sql(page, 'SELECT value FROM preserved');
  expect(Number(result?.rows[0][0])).toBe(123);
});

test('links toggle and cleanup releases the native terminal', async ({ page }) => {
  await openFixture(page);
  await sql(page, "SELECT 'https://example.com/path' AS url");
  await expect(page.locator('a.gespenst__link')).toHaveAttribute('href', 'https://example.com/path');
  await page.evaluate(() => { window.open = (url) => { document.body.dataset.opened = String(url); return null; }; });
  await page.locator('a.gespenst__link').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('body')).toHaveAttribute('data-opened', 'https://example.com/path');
  await page.evaluate(() => window.fixture.terminal.runCommand('.links off'));
  await expect(page.locator('a.gespenst__link')).toHaveCount(0);
  await page.evaluate(() => window.fixture.terminal.runCommand('.links on'));
  await expect(page.locator('a.gespenst__link').first()).toBeVisible();
  await page.evaluate(async () => { await window.fixture.terminal.destroy(); await window.fixture.terminal.destroy(); });
  await expect(page.locator('.gespenst')).toHaveCount(0);
});

test('pagination and cancellation remain responsive', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Full SQL interaction suite runs in Chromium.');
  await openFixture(page);
  const first = await sql(page, 'SELECT i FROM range(45) t(i)');
  expect(first?.pagination?.hasNextPage).toBe(true);
  await page.locator('.gespenst__input').press('n');
  await expect.poll(() => text(page)).toContain('Page 2');
  await page.locator('.gespenst__input').press('q');
  await expect.poll(() => page.evaluate(() => window.fixture.state)).toBe('idle');
  await page.evaluate(() => { void window.fixture.terminal.executeSQL('SELECT sum(sin(i)) FROM range(10000000000) t(i)'); });
  await expect.poll(() => page.evaluate(() => window.fixture.state)).toBe('executing');
  await page.locator('.gespenst__input').press('Control+c');
  await expect.poll(() => page.evaluate(() => window.fixture.state)).toBe('idle');
  expect(await text(page)).toContain('cancelled');
  expect((await sql(page, 'SELECT 9 AS recovered'))?.rowCount).toBe(1);
});

test('website themes and mobile actions use the public API', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Website/mobile wiring runs in Chromium.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4173/');
  await expect.poll(() => page.evaluate(() => window.workerStatus.some((worker) => worker.name === 'gespenst' && worker.ready))).toBe(true);
  // Wait until DuckDB has completed startup and installed its input callback.
  await expect(page.locator('.gespenst__input')).toBeAttached();
  await expect(page.locator('#terminal-container')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#action-keyboard').click();
  await expect(page.locator('.gespenst__input')).toBeFocused();
  let navigations = 0;
  page.on('framenavigated', () => navigations++);
  await page.locator('#theme-select').selectOption('dracula');
  await expect(page.locator('body')).toHaveClass(/dracula/);
  expect(navigations).toBe(0);
  const picker = page.waitForEvent('filechooser');
  await page.locator('#action-files').click();
  await (await picker).setFiles({ name: 'data.csv', mimeType: 'text/csv', buffer: Buffer.from('id,name\n1,duck\n') });
  await page.locator('#action-help').click();
});

test('selection copying resolves real worker text inside the clipboard item', async ({ page }) => {
  await openFixture(page);
  await sql(page, "SELECT 'copy me' AS message");
  await page.evaluate(async () => {
    await window.fixture.native.writeAsync('');
    window.fixture.native.selectAll();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      async write(items: ClipboardItem[]) {
        const blob = await items[0].getType('text/plain');
        document.body.dataset.copied = await blob.text();
      },
    } });
  });
  await page.locator('.gespenst__input').press('Meta+c');
  await expect.poll(() => page.locator('body').getAttribute('data-copied')).toContain('copy me');
});

test('chart overlay and sharing survive the renderer replacement', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Application overlays run in Chromium.');
  await openFixture(page);
  await sql(page, "SELECT category, value FROM (VALUES ('a', 10), ('b', 20)) t(category, value)");
  await page.evaluate(() => window.fixture.terminal.runCommand('.chart'));
  await expect(page.locator('.uplot')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.fixture.terminal.openSharingModal());
  await expect(page.locator('body')).toContainText('Share');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.fixture.errors)).toEqual([]);
});
