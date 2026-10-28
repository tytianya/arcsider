// Optional interaction check. Requires Playwright + its Chromium, not shipped with the extension.
const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { once } = require('node:events');

(async () => {
  const root = path.resolve(__dirname, '..');
  const extension = path.join(root, 'dist', 'arcsider');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'arcsider-check-'));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<html><title>Arcsider test ${req.url}</title><body><h1>Local extension check</h1></body></html>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let context;
  const passed = [];
  const errors = [];
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true, channel: 'chromium', viewport: { width: 1100, height: 800 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    context.on('weberror', error => errors.push(error.error().message));
    await context.route('https://www.google.com/**', route => route.abort());
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const fixture = { tree: [{ id: 'f1', type: 'folder', name: '协议调研', expanded: true, children: [
      { id: 'l1', type: 'link', title: '已收藏页面', url: `${base}/one?id=1#view` },
    ] }], pinnedIds: ['l1'] };
    await worker.evaluate(data => chrome.storage.local.set({ arc_sidebar_tree: data.tree, arc_sidebar_pinned: data.pinnedIds }), fixture);
    const saved = await context.newPage();
    await saved.goto(`${base}/one?id=1#view`);
    const unsaved = await context.newPage();
    await unsaved.goto(`${base}/two`);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html`);
    const storage = () => worker.evaluate(() => chrome.storage.local.get(['arc_sidebar_tree', 'arc_sidebar_pinned', 'arc_sidebar_tabs_ratio']));
    const folder = panel.locator('.node-row[data-id="f1"]');
    await folder.click({ button: 'right' });
    await panel.locator('[data-action="edit-folder"]').click();
    await panel.locator('.label-input').fill('重命名成功');
    await panel.locator('.label-input').press('Enter');
    await panel.waitForFunction(() => document.querySelector('.node-row[data-id="f1"] .label')?.textContent === '重命名成功');
    assert.equal((await storage()).arc_sidebar_tree[0].name, '重命名成功');
    await folder.click({ button: 'right' });
    await panel.locator('[data-action="edit-folder"]').click();
    await panel.locator('.label-input').fill('取消的修改');
    await panel.locator('.label-input').press('Escape');
    assert.equal((await storage()).arc_sidebar_tree[0].name, '重命名成功');
    passed.push('folder context rename: Enter saves, Escape cancels');

    assert.equal(await panel.locator('.node-row[data-id="l1"].is-open').count(), 1);
    const openUrls = await panel.locator('.tab-row').evaluateAll(rows => rows.map(row => row.textContent));
    assert.ok(openUrls.some(text => text.includes('/two')));
    assert.ok(!openUrls.some(text => text.includes('/one')));
    await saved.bringToFront();
    await panel.waitForFunction(() => document.querySelector('.node-row[data-id="l1"]')?.classList.contains('is-active'));
    passed.push('saved tabs hidden; saved link and pin show open/active state');

    const resize = panel.locator('#tabs-resizer');
    const initialHeight = await panel.locator('#open-tabs').evaluate(el => el.offsetHeight);
    const box = await resize.boundingBox();
    await panel.mouse.move(box.x + box.width / 2, box.y + 4);
    await panel.mouse.down();
    await panel.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 8 });
    await panel.mouse.up();
    assert.ok(await panel.locator('#open-tabs').evaluate(el => el.offsetHeight) > initialHeight + 50);
    await resize.focus();
    await resize.press('ArrowDown');
    const ratio = (await storage()).arc_sidebar_tabs_ratio;
    await panel.reload();
    await panel.waitForFunction(value => Number(document.querySelector('#tabs-resizer').getAttribute('aria-valuenow')) === Math.round(value), ratio);
    passed.push('Open Tabs pointer/keyboard resize persists after reload');

    // Exercise actual HTML drag/drop event flow with a real browser DataTransfer.
    const transfer = await panel.evaluateHandle(() => new DataTransfer());
    const tabRow = panel.locator('.tab-row').filter({ hasText: '/two' });
    await tabRow.dispatchEvent('dragstart', { dataTransfer: transfer });
    const folderBox = await folder.boundingBox();
    await folder.dispatchEvent('drop', { dataTransfer: transfer, clientY: folderBox.y + folderBox.height / 2 });
    await panel.waitForFunction(() => ![...document.querySelectorAll('.tab-row')].some(el => el.textContent.includes('/two')));
    assert.ok((await storage()).arc_sidebar_tree[0].children.some(node => node.url === `${base}/two`));
    passed.push('Open Tabs drag/drop saves a link and immediately removes its duplicate row');

    const before = await storage();
    const downloadEvent = panel.waitForEvent('download');
    await panel.locator('#btn-export').click();
    const download = await downloadEvent;
    const downloaded = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.deepEqual(downloaded, { tree: before.arc_sidebar_tree, pinnedIds: before.arc_sidebar_pinned });
    const upload = data => panel.locator('#import-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await upload({ tree: [{ id: 'invalid' }] });
    assert.deepEqual((await storage()).arc_sidebar_tree, before.arc_sidebar_tree);
    assert.ok((await panel.locator('#status').textContent()).includes('未导入'));
    const imported = { tree: [{ id: 'new-folder', type: 'folder', name: '导入测试', children: fixture.tree }], pinnedIds: [] };
    await upload(imported);
    await panel.locator('.backup-dialog .form-btn-cancel').click();
    assert.deepEqual((await storage()).arc_sidebar_tree, before.arc_sidebar_tree);
    await upload(imported);
    await panel.locator('.backup-dialog .form-btn-save').click();
    await panel.waitForFunction(() => document.querySelector('.node-row[data-id="new-folder"]'));
    assert.deepEqual((await storage()).arc_sidebar_tree, imported.tree);
    assert.deepEqual((await storage()).arc_sidebar_pinned, []);
    await panel.locator('#btn-recover').click();
    await panel.locator('.backup-dialog .form-btn-save').click();
    await panel.waitForFunction(() => !document.querySelector('.node-row[data-id="new-folder"]'));
    assert.deepEqual((await storage()).arc_sidebar_tree, before.arc_sidebar_tree);
    assert.deepEqual((await storage()).arc_sidebar_pinned, before.arc_sidebar_pinned);
    await upload(downloaded);
    await panel.locator('.backup-dialog .form-btn-save').click();
    await panel.waitForSelector('.backup-dialog', { state: 'detached' });
    assert.deepEqual((await storage()).arc_sidebar_tree, downloaded.tree);
    assert.deepEqual((await storage()).arc_sidebar_pinned, downloaded.pinnedIds);
    passed.push('actual export/import round-trip; invalid file/cancel preserve data; recovery restores previous tree');

    // Verify failed writes leave the live data intact (only the extension frame API is replaced).
    await panel.evaluate(() => { window.realStorageSet = chrome.storage.local.set; chrome.storage.local.set = () => Promise.reject(new Error('simulated quota failure')); });
    await upload(imported);
    await panel.locator('.backup-dialog .form-btn-save').click();
    await panel.waitForFunction(() => document.querySelector('#status').textContent.includes('写入失败'));
    assert.deepEqual((await storage()).arc_sidebar_tree, downloaded.tree);
    assert.equal(await panel.locator('.node-row[data-id="new-folder"]').count(), 0);
    await panel.locator('.backup-dialog .form-btn-cancel').click();
    await panel.evaluate(() => { chrome.storage.local.set = window.realStorageSet; });
    passed.push('storage failure leaves current bookmarks unchanged');

    await panel.emulateMedia({ colorScheme: 'light' });
    const light = await panel.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await panel.emulateMedia({ colorScheme: 'dark' });
    const dark = await panel.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.notEqual(light, dark);
    passed.push(`appearance switches light/dark: ${light} / ${dark}`);

    await unsaved.bringToFront();
    await unsaved.mouse.move(1000, 400);
    await unsaved.mouse.move(1, 400);
    await unsaved.waitForFunction(() => document.querySelector('#arcsider-drawer')?.hasAttribute('data-open'));
    const drawer = unsaved.frames().find(frame => frame.url().includes('sidepanel.html?drawer=1')) ||
      await unsaved.waitForEvent('framenavigated', { predicate: frame => frame.url().includes('sidepanel.html?drawer=1') });
    const drawerFrame = drawer || unsaved.frames().find(frame => frame.url().includes('sidepanel.html?drawer=1'));
    assert.ok(drawerFrame);
    await drawerFrame.waitForSelector('#btn-drawer-pin');
    await drawerFrame.locator('#btn-drawer-pin').click();
    await unsaved.mouse.move(1000, 400);
    await unsaved.waitForTimeout(500);
    assert.ok(await unsaved.locator('#arcsider-drawer').evaluate(el => el.hasAttribute('data-open')));
    await drawerFrame.locator('#btn-drawer-pin').click();
    await unsaved.mouse.move(1000, 400);
    await unsaved.waitForFunction(() => !document.querySelector('#arcsider-drawer').hasAttribute('data-open'));
    await unsaved.mouse.move(1, 400);
    await unsaved.waitForFunction(() => document.querySelector('#arcsider-drawer').hasAttribute('data-open'));
    await unsaved.mouse.move(1000, 400);
    await unsaved.waitForFunction(() => !document.querySelector('#arcsider-drawer').hasAttribute('data-open'));
    passed.push('left-edge hover opens, pointer leave hides, pin keeps drawer open');

    await panel.setViewportSize({ width: 380, height: 850 });
    await panel.evaluate(() => { document.getElementById('status').hidden = true; });
    await panel.screenshot({ path: path.join(root, 'dist', 'verification-dark.png') });
    assert.deepEqual(errors, [], 'No uncaught extension/page errors');
    console.log(JSON.stringify({ passed, uncaughtErrors: errors.length }, null, 2));
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(profile);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('arcsider-check-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
