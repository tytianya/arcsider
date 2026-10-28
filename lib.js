// Pure utility functions — no DOM or chrome.* dependencies.
// Loaded as a <script> in the browser and as CommonJS in tests.

function normalizeUrl(url) {
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) return `https://${url}`;
  return url;
}

function faviconUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return null;
  }
}

function bareHost(hostname) {
  return hostname.replace(/^www\./, '');
}

function urlKey(raw) {
  try {
    const u = new URL(raw);
    return (u.origin + u.pathname).replace(/\/+$/, '');
  } catch { return raw; }
}

function findNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function findParent(nodes, id, parent = null) {
  for (const node of nodes) {
    if (node.id === id) return parent;
    if (node.children) {
      const found = findParent(node.children, id, node);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function removeNode(nodes, id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx !== -1) return nodes.splice(idx, 1)[0];
  for (const node of nodes) {
    if (node.children) {
      const removed = removeNode(node.children, id);
      if (removed) return removed;
    }
  }
  return null;
}

function isDescendant(folder, targetId) {
  if (!folder.children) return false;
  for (const child of folder.children) {
    if (child.id === targetId) return true;
    if (child.type === 'folder' && isDescendant(child, targetId)) return true;
  }
  return false;
}

function setAllExpanded(nodes, expanded) {
  for (const node of nodes) {
    if (node.type === 'folder') {
      node.expanded = expanded;
      if (node.children) setAllExpanded(node.children, expanded);
    }
  }
}

// Tab identity must preserve query parameters and hash-based application routes.
function tabUrlKey(raw) {
  try { return new URL(raw).href; } catch { return raw; }
}

function collectLinkKeys(nodes, keys = new Set()) {
  for (const node of nodes) {
    if (node.type === 'link') keys.add(tabUrlKey(node.url));
    else if (node.children) collectLinkKeys(node.children, keys);
  }
  return keys;
}

// Accept both original export formats without regenerating IDs or changing URLs.
function parseBackup(value) {
  const nodes = Array.isArray(value) ? value : value?.tree;
  const pins = Array.isArray(value) ? [] : value?.pinnedIds ?? [];
  if (!Array.isArray(nodes) || !Array.isArray(pins)) throw new Error('Expected an Arcsider tree and pinnedIds array.');
  const ids = new Set();
  const linkIds = new Set();
  let folderCount = 0;
  let linkCount = 0;
  function check(list, depth) {
    if (depth > 100) throw new Error('Folder nesting exceeds 100 levels.');
    for (const node of list) {
      if (!node || typeof node.id !== 'string' || !node.id.trim() || ids.has(node.id)) {
        throw new Error('A node has a missing or duplicate ID.');
      }
      ids.add(node.id);
      if (node.type === 'folder') {
        if (typeof node.name !== 'string' || !Array.isArray(node.children) ||
            (node.expanded !== undefined && typeof node.expanded !== 'boolean')) {
          throw new Error('Invalid folder name, children or expanded state.');
        }
        folderCount++;
        check(node.children, depth + 1);
      } else if (node.type === 'link') {
        if (typeof node.title !== 'string' || typeof node.url !== 'string' || !node.url.trim() ||
            /^[\s\u0000-\u0020]*(javascript|data|vbscript):/i.test(node.url)) {
          throw new Error('Invalid link title or URL.');
        }
        linkCount++;
        linkIds.add(node.id);
      } else throw new Error('Unknown node type.');
    }
  }
  check(nodes, 0);
  const pinnedIds = [...new Set(pins.filter(id => linkIds.has(id)))];
  return { tree: JSON.parse(JSON.stringify(nodes)), pinnedIds, folderCount, linkCount,
    ignoredPinnedCount: pins.length - pinnedIds.length };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeUrl, faviconUrl, bareHost, urlKey, findNode, findParent, removeNode, isDescendant, setAllExpanded,
    tabUrlKey, collectLinkKeys, parseBackup };
}
