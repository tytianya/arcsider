// Targeted regression: pinned drawer restoration before a slow page finishes parsing.
const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { once } = require('node:events');

(async () => {
  const root = path.resolve(__dirname, '..');
  const extension = process.env.ARCSIDER_TEST_SOURCE ? root : path.join(root, 'dist/arcsider');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'arcsider-startup-'));
  const server = http.createServer((req, res) => {
    if (req.url === '/slow.js') {
      res.setHeader('Content-Type', 'text/javascript');
      setTimeout(() => res.end('window.pageParserFinished = true;'), 1200);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><head><script src="/slow.js"></script></head><body>Slow page</body></html>');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true, channel: 'chromium', viewport: { width: 1000, height: 800 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    await context.route('https://www.google.com/**', route => route.abort());
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const pin = value => worker.evaluate(pinned => chrome.storage.local.set({ arc_sidebar_drawer_pinned: pinned }), value);
    await pin(true);
    await worker.evaluate(base => chrome.storage.local.set({ arc_sidebar_tree: [
      { id: 'existing', type: 'link', title: 'Existing tab', url: `${base}/second` },
      { id: 'new', type: 'link', title: 'New tab', url: `${base}/opened-new` },
    ], arc_sidebar_pinned: [] }), base);
    await context.addInitScript(() => {
      new MutationObserver(() => {
        const host = document.getElementById('arcsider-drawer');
        if (host?.hasAttribute('data-open') && !window.drawerFirstOpen) {
          window.drawerFirstOpen = { parserFinished: window.pageParserFinished === true,
            transition: getComputedStyle(host).transitionDuration };
        }
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-open'] });
    });
    const page = await context.newPage();
    await page.goto(`${base}/first`, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.drawerFirstOpen);
    const first = await page.evaluate(() => window.drawerFirstOpen);
    console.log('Pinned startup:', JSON.stringify(first));
    assert.equal(first.parserFinished, false, 'Pinned drawer must restore before the slow parser-blocking resource completes');
    assert.equal(first.transition, '0s', 'Pinned restoration must not slide in');
    const earlyFrame = page.frames().find(frame => frame.url().includes('sidepanel.html?drawer=1')) ||
      await page.waitForEvent('framenavigated', { predicate: frame => frame.url().includes('sidepanel.html?drawer=1') });
    await earlyFrame.waitForSelector('.node-row[data-id="existing"]');
    assert.equal(await page.evaluate(() => window.pageParserFinished === true), false,
      'Drawer content, not just its host, must be ready before the slow page finishes parsing');
    await page.waitForLoadState('load');
    const originalFrame = page.frames().find(frame => frame.url().includes('sidepanel.html?drawer=1'));
    assert.ok(originalFrame);
    const other = await context.newPage();
    await other.goto(`${base}/second`);
    await other.waitForFunction(() => document.getElementById('arcsider-drawer')?.hasAttribute('data-pinned'));
    await page.bringToFront();
    assert.ok(page.frames().includes(originalFrame), 'Switching back reuses the mounted frame');
    assert.equal(await page.locator('#arcsider-drawer').evaluate(el => el.hasAttribute('data-open')), true);
    await originalFrame.locator('.node-row[data-id="existing"]').click();
    await other.waitForFunction(() => document.hasFocus());
    assert.equal(await other.locator('#arcsider-drawer').evaluate(el => el.hasAttribute('data-open')), true);
    const otherFrame = other.frames().find(frame => frame.url().includes('sidepanel.html?drawer=1'));
    const openedEvent = context.waitForEvent('page');
    await otherFrame.locator('.node-row[data-id="new"]').click();
    const opened = await openedEvent;
    await opened.waitForFunction(() => window.drawerFirstOpen);
    assert.equal(await opened.evaluate(() => window.drawerFirstOpen.parserFinished), false);
    assert.equal(await opened.evaluate(() => window.drawerFirstOpen.transition), '0s');
    await page.goto(`${base}/navigation`, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.drawerFirstOpen);
    assert.equal(await page.evaluate(() => window.drawerFirstOpen.parserFinished), false);
    await page.waitForLoadState('load');
    const drawer = page.frames().find(frame => frame.url().includes('sidepanel.html?drawer=1'));
    await drawer.waitForSelector('#btn-drawer-pin');
    await drawer.locator('#btn-drawer-pin').click();
    await page.mouse.move(900, 400);
    await page.waitForFunction(() => !document.getElementById('arcsider-drawer').hasAttribute('data-open'));
    await page.mouse.move(1, 400);
    await page.waitForFunction(() => document.getElementById('arcsider-drawer').hasAttribute('data-open'));
    assert.equal(await page.locator('#arcsider-drawer').evaluate(el => el.hasAttribute('data-pinned')), false);
    await page.mouse.move(900, 400);
    await page.waitForFunction(() => !document.getElementById('arcsider-drawer').hasAttribute('data-open'));
    console.log('PASS: drawer content ready before slow page parsing, no pinned slide animation, saved-link switch/new tab, mounted frame reused, early navigation restore, unpin/hover/hide');
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(profile);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('arcsider-startup-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
