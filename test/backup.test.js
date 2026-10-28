const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBackup, collectLinkKeys, tabUrlKey } = require('../lib.js');

const tree = [{ id: 'folder-1', type: 'folder', name: '协议调研', expanded: false, children: [
  { id: 'link-1', type: 'link', title: '仪表板', url: 'https://example.com/dashboard?id=1#state', custom: 'preserve' },
] }];

test('original object export round-trips nested names, URLs, IDs and pinned links without mutation', () => {
  const original = { tree, pinnedIds: ['link-1'] };
  const result = parseBackup(JSON.parse(JSON.stringify(original)));
  assert.deepEqual({ tree: result.tree, pinnedIds: result.pinnedIds }, original);
  assert.deepEqual(parseBackup(JSON.parse(JSON.stringify({ tree: result.tree, pinnedIds: result.pinnedIds }))), result);
  assert.equal(result.folderCount, 1);
  assert.equal(result.linkCount, 1);
});

test('legacy array export is accepted and stale pinned IDs are reported without losing links', () => {
  assert.deepEqual(parseBackup(tree).tree, tree);
  const result = parseBackup({ tree, pinnedIds: ['missing', 'folder-1', 'link-1', 'link-1'] });
  assert.deepEqual(result.pinnedIds, ['link-1']);
  assert.equal(result.ignoredPinnedCount, 3);
  assert.deepEqual(result.tree, tree);
});

test('malformed trees and duplicate IDs are rejected before any persistence', () => {
  for (const value of [null, {}, { tree: {} }, [null], [{ id: 'x', type: 'unknown' }],
    [{ id: 'x', type: 'folder', name: 'f', children: {} }],
    [{ id: 'x', type: 'link', title: 'x', url: '' }],
    [{ id: 'x', type: 'link', title: 'x', url: 'javascript:alert(1)' }],
    [...tree, { id: 'link-1', type: 'folder', name: 'duplicate', children: [] }],
    { tree, pinnedIds: 'bad' }]) assert.throws(() => parseBackup(value));
});

test('an empty original backup remains a valid backup', () => {
  assert.equal(parseBackup({ tree: [], pinnedIds: [] }).linkCount, 0);
});

test('saved tab matching includes nested links and preserves query and hash routes', () => {
  const keys = collectLinkKeys(tree);
  assert.ok(keys.has(tabUrlKey(tree[0].children[0].url)));
  assert.ok(!keys.has(tabUrlKey('https://example.com/dashboard?id=2#state')));
  assert.ok(!keys.has(tabUrlKey('https://example.com/dashboard?id=1#other')));
  assert.equal(tabUrlKey('https://EXAMPLE.com:443'), tabUrlKey('https://example.com/'));
});
