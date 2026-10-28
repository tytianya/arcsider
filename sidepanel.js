const STORAGE_KEY = 'arc_sidebar_tree';
const PINNED_KEY = 'arc_sidebar_pinned';
const BACKUP_KEY = 'arc_sidebar_before_import';
const embedded = window.parent !== window;
let tabRenderVersion = 0;
let tree = [];
let pinnedIds = [];
let draggedId = null;
let dragSource = null; // 'tree', 'pinned', 'tab'

const treeEl = document.getElementById('tree');
const pinnedGridEl = document.getElementById('pinned-grid');
const openTabsEl = document.getElementById('open-tabs');
const contextMenu = document.getElementById('context-menu');
let contextTarget = null;

// ── Data helpers ──
// Pure functions (normalizeUrl, faviconUrl, bareHost, urlKey, findNode,
// findParent, removeNode, isDescendant, setAllExpanded) live in lib.js.

function generateId() {
  return crypto.randomUUID();
}

function getList(parentId) {
  if (!parentId) return tree;
  const parent = findNode(tree, parentId);
  return parent?.children || tree;
}

// ── Tab focus ──

async function focusOrOpen(url) {
  const normalized = normalizeUrl(url);
  const targetKey = tabUrlKey(normalized);
  const tabs = await chrome.tabs.query({});

  const match = tabs.find(t => tabUrlKey(t.url) === targetKey);

  if (match) {
    await chrome.tabs.update(match.id, { active: true });
    await chrome.windows.update(match.windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: normalized });
  }
}

// ── Persistence ──

function save() {
  return chrome.storage.local.set({ [STORAGE_KEY]: tree, [PINNED_KEY]: pinnedIds })
    .catch(error => showStatus(`保存失败：${error.message}`));
}

async function load() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEY, PINNED_KEY], result => {
      tree = result[STORAGE_KEY] || [];
      pinnedIds = result[PINNED_KEY] || [];
      // Clean stale pinned IDs
      pinnedIds = pinnedIds.filter(id => findNode(tree, id));
      resolve();
    });
  });
}

// ── Rendering ──

function render() {
  renderPinnedGrid();
  renderTree();
  renderOpenTabs();
}

function renderTree() {
  treeEl.innerHTML = '';
  if (tree.length === 0) {
    treeEl.innerHTML = `
      <div class="empty-state">
        <p>No links yet</p>
        <p class="hint">Click + to add the current tab<br>or create a folder to organize links</p>
      </div>`;
    return;
  }
  tree.forEach(node => treeEl.appendChild(renderNode(node, 0)));
}

// ── Pinned Grid ──

function renderPinnedGrid() {
  pinnedGridEl.innerHTML = '';
  for (const id of pinnedIds) {
    const node = findNode(tree, id);
    if (!node || node.type !== 'link') continue;

    const item = document.createElement('div');
    item.className = 'pinned-item';
    item.dataset.id = node.id;
    item.draggable = true;

    const fav = faviconUrl(node.url);
    const image = document.createElement('img');
    image.src = fav || '';
    image.alt = '';
    const tooltip = document.createElement('span');
    tooltip.className = 'pinned-tooltip';
    tooltip.textContent = node.title;
    item.append(image, tooltip);

    item.addEventListener('click', () => focusOrOpen(node.url));
    item.addEventListener('contextmenu', e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, node.id);
    });

    item.addEventListener('dragstart', e => {
      draggedId = node.id;
      dragSource = 'pinned';
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      draggedId = null;
      dragSource = null;
      item.classList.remove('dragging');
    });

    pinnedGridEl.appendChild(item);
  }
}

// ── Open Tabs ──

async function renderOpenTabs() {
  const version = ++tabRenderVersion;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (version !== tabRenderVersion) return;
  const savedKeys = collectLinkKeys(tree);
  const openKeys = new Set(tabs.map(tab => tabUrlKey(tab.url)));
  const activeKey = tabUrlKey(tabs.find(tab => tab.active)?.url);
  document.querySelectorAll('.node-row, .pinned-item').forEach(row => {
    const node = findNode(tree, row.dataset.id);
    if (node?.type !== 'link') return;
    const key = tabUrlKey(node.url);
    row.classList.toggle('is-open', openKeys.has(key));
    row.classList.toggle('is-active', activeKey === key);
    row.title = `${node.title}\n${node.url}${openKeys.has(key) ? '\n已在当前窗口打开' : ''}${activeKey === key ? '（当前标签）' : ''}`;
  });
  openTabsEl.innerHTML = '';

  for (const tab of tabs) {
    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) continue;
    if (savedKeys.has(tabUrlKey(tab.url))) continue;

    const row = document.createElement('div');
    row.className = 'tab-row';
    if (tab.active) row.classList.add('active');
    row.draggable = true;
    row.dataset.tabId = tab.id;

    const fav = tab.favIconUrl || faviconUrl(tab.url) || '';
    const icon = document.createElement('span');
    icon.className = 'icon';
    const img = document.createElement('img');
    img.src = fav;
    img.alt = '';
    icon.appendChild(img);
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = tab.title || tab.url;
    row.append(icon, label);

    row.addEventListener('click', () => {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    });

    row.addEventListener('dragstart', e => {
      draggedId = `tab-${tab.id}`;
      dragSource = 'tab';
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        title: tab.title || tab.url,
        url: tab.url,
      }));
    });

    row.addEventListener('dragend', () => {
      draggedId = null;
      dragSource = null;
      row.classList.remove('dragging');
      clearDropIndicators();
    });

    openTabsEl.appendChild(row);
  }
  if (!openTabsEl.children.length) {
    const empty = document.createElement('div');
    empty.className = 'tabs-empty';
    empty.textContent = '没有未收藏的标签页';
    openTabsEl.appendChild(empty);
  }
}

function renderNode(node, depth) {
  const container = document.createElement('div');
  container.className = 'node';
  container.dataset.id = node.id;

  const row = document.createElement('div');
  row.className = 'node-row';
  row.style.paddingLeft = `${10 + depth * 16}px`;
  row.draggable = true;
  row.dataset.id = node.id;

  // Chevron
  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  if (node.type === 'folder') {
    chevron.classList.toggle('expanded', node.expanded !== false);
    chevron.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';
  } else {
    chevron.classList.add('hidden');
  }
  row.appendChild(chevron);

  // Icon
  const icon = document.createElement('span');
  icon.className = 'icon';
  if (node.type === 'folder') {
    icon.classList.add('folder-icon');
    icon.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5A1.5 1.5 0 012.5 2h3.379a1.5 1.5 0 011.06.44l1.122 1.12A.5.5 0 008.415 3.7H13.5A1.5 1.5 0 0115 5.2v7.3a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z"/></svg>';
  } else {
    const fav = faviconUrl(node.url);
    if (fav) {
      icon.innerHTML = `<img src="${fav}" alt="">`;
    } else {
      icon.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6" fill="#555"/></svg>';
    }
  }
  row.appendChild(icon);

  // Label
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = node.type === 'folder' ? node.name : node.title;
  row.appendChild(label);

  // Events
  row.addEventListener('click', e => {
    if (e.target.closest('input')) return;
    if (node.type === 'folder') {
      node.expanded = node.expanded === false ? true : !node.expanded;
      save();
      render();
    } else if (node.url) {
      focusOrOpen(node.url);
    }
  });

  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, node.id);
  });

  // Drag events
  row.addEventListener('dragstart', e => {
    draggedId = node.id;
    dragSource = 'tree';
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  row.addEventListener('dragend', () => {
    draggedId = null;
    dragSource = null;
    row.classList.remove('dragging');
    clearDropIndicators();
  });

  row.addEventListener('dragover', e => {
    e.preventDefault();
    if (!draggedId) return;
    if (dragSource !== 'tab' && draggedId === node.id) return;
    e.dataTransfer.dropEffect = 'move';
    clearDropIndicators();

    const rect = row.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const third = rect.height / 3;

    if (node.type === 'folder' && y > third && y < third * 2) {
      row.classList.add('drop-inside');
    } else if (y < rect.height / 2) {
      row.classList.add('drop-above');
    } else {
      row.classList.add('drop-below');
    }
  });

  row.addEventListener('dragleave', () => {
    row.classList.remove('drop-above', 'drop-below', 'drop-inside');
  });

  row.addEventListener('drop', e => {
    e.preventDefault();
    clearDropIndicators();

    // Handle tab drop → create new link
    if (dragSource === 'tab') {
      let tabData;
      try { tabData = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      const newLink = { id: generateId(), type: 'link', title: tabData.title, url: tabData.url };

      const rect = row.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const third = rect.height / 3;

      if (node.type === 'folder' && y > third && y < third * 2) {
        if (!node.children) node.children = [];
        node.children.push(newLink);
        node.expanded = true;
      } else {
        const parent = findParent(tree, node.id);
        const list = parent ? parent.children : tree;
        const idx = list.findIndex(n => n.id === node.id);
        if (y < rect.height / 2) {
          list.splice(idx, 0, newLink);
        } else {
          list.splice(idx + 1, 0, newLink);
        }
      }
      save();
      render();
      return;
    }

    if (!draggedId || draggedId === node.id) return;

    // Prevent dropping a folder into its own descendant
    const draggedNode = findNode(tree, draggedId);
    if (draggedNode?.type === 'folder' && isDescendant(draggedNode, node.id)) return;

    const removed = removeNode(tree, draggedId);
    if (!removed) return;

    const rect = row.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const third = rect.height / 3;

    if (node.type === 'folder' && y > third && y < third * 2) {
      if (!node.children) node.children = [];
      node.children.push(removed);
      node.expanded = true;
    } else {
      const parent = findParent(tree, node.id);
      const list = parent ? parent.children : tree;
      const idx = list.findIndex(n => n.id === node.id);
      if (y < rect.height / 2) {
        list.splice(idx, 0, removed);
      } else {
        list.splice(idx + 1, 0, removed);
      }
    }

    save();
    render();
  });

  container.appendChild(row);

  // Children
  if (node.type === 'folder' && node.children) {
    const childrenEl = document.createElement('div');
    childrenEl.className = `node-children${node.expanded === false ? ' collapsed' : ''}`;
    node.children.forEach(child => childrenEl.appendChild(renderNode(child, depth + 1)));
    container.appendChild(childrenEl);
  }

  return container;
}

function clearDropIndicators() {
  document.querySelectorAll('.drop-above, .drop-below, .drop-inside').forEach(el => {
    el.classList.remove('drop-above', 'drop-below', 'drop-inside');
  });
}

// ── Context Menu ──

function showContextMenu(x, y, nodeId) {
  contextTarget = nodeId;
  const node = findNode(tree, nodeId);
  const isPinned = pinnedIds.includes(nodeId);

  contextMenu.querySelector('[data-action="pin"]').style.display =
    node?.type === 'link' && !isPinned ? 'block' : 'none';
  contextMenu.querySelector('[data-action="unpin"]').style.display =
    node?.type === 'link' && isPinned ? 'block' : 'none';
  contextMenu.querySelector('[data-action="edit-link"]').style.display =
    node?.type === 'link' ? 'block' : 'none';
  contextMenu.querySelector('[data-action="edit-folder"]').style.display =
    node?.type === 'folder' ? 'block' : 'none';
  contextMenu.querySelector('[data-action="add-subfolder"]').style.display =
    node?.type === 'folder' ? 'block' : 'none';
  contextMenu.querySelector('[data-action="add-link"]').style.display =
    node?.type === 'folder' ? 'block' : 'none';

  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.classList.remove('hidden');

  const rect = contextMenu.getBoundingClientRect();
  if (rect.bottom > window.innerHeight) {
    contextMenu.style.top = `${window.innerHeight - rect.height - 4}px`;
  }
  if (rect.right > window.innerWidth) {
    contextMenu.style.left = `${window.innerWidth - rect.width - 4}px`;
  }
}

function hideContextMenu() {
  contextMenu.classList.add('hidden');
  contextTarget = null;
}

document.addEventListener('click', e => {
  if (!contextMenu.contains(e.target)) hideContextMenu();
});

contextMenu.addEventListener('click', async e => {
  const action = e.target.dataset.action;
  if (!action || !contextTarget) return;

  const node = findNode(tree, contextTarget);
  if (!node) { hideContextMenu(); return; }

  switch (action) {
    case 'pin':
      if (node.type === 'link' && !pinnedIds.includes(node.id)) {
        pinnedIds.push(node.id);
        save();
        render();
      }
      hideContextMenu();
      break;

    case 'unpin':
      pinnedIds = pinnedIds.filter(id => id !== node.id);
      save();
      render();
      hideContextMenu();
      break;

    case 'edit-link':
      hideContextMenu();
      showEditLinkForm(node);
      return;

    case 'edit-folder':
      hideContextMenu();
      startInlineEdit(node.id, 'name');
      break;

    case 'add-subfolder':
      if (node.type === 'folder') {
        if (!node.children) node.children = [];
        const newFolder = { id: generateId(), type: 'folder', name: 'New folder', children: [], expanded: true };
        node.children.push(newFolder);
        node.expanded = true;
        save();
        render();
        startInlineEdit(newFolder.id);
      }
      hideContextMenu();
      break;

    case 'add-link':
      if (node.type === 'folder') {
        hideContextMenu();
        showAddLinkForm(node);
        return;
      }
      hideContextMenu();
      break;

    case 'delete':
      pinnedIds = pinnedIds.filter(id => id !== contextTarget);
      removeNode(tree, contextTarget);
      save();
      render();
      hideContextMenu();
      break;
  }
});

function startInlineEdit(nodeId, field = 'name') {
  const row = [...document.querySelectorAll('.node-row')].find(el => el.dataset.id === nodeId);
  if (!row) return;
  const label = row.querySelector('.label');
  const node = findNode(tree, nodeId);
  if (!label || !node) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'label-input';

  if (field === 'url' && node.type === 'link') {
    input.value = node.url || '';
    input.placeholder = 'https://...';
  } else {
    input.value = node.type === 'folder' ? node.name : node.title;
  }

  let finished = false;
  const finish = (cancel = false) => {
    if (finished) return;
    finished = true;
    const val = input.value.trim();
    if (!cancel && val) {
      if (field === 'url' && node.type === 'link') {
        node.url = normalizeUrl(val);
      } else if (node.type === 'folder') {
        node.name = val;
      } else {
        node.title = val;
      }
      save();
    }
    render();
  };

  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('pointerdown', e => e.stopPropagation());
  input.addEventListener('blur', () => finish());
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(); }
    if (e.key === 'Escape') { e.preventDefault(); finish(true); }
  });

  label.replaceWith(input);
  input.focus();
  input.select();
}

// ── Header buttons ──

document.getElementById('btn-add-folder').addEventListener('click', () => {
  const newFolder = { id: generateId(), type: 'folder', name: 'New folder', children: [], expanded: true };
  tree.push(newFolder);
  save();
  render();
  startInlineEdit(newFolder.id);
});

document.getElementById('btn-add-link').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    tree.push({
      id: generateId(),
      type: 'link',
      title: tab.title || tab.url,
      url: tab.url,
    });
    save();
    render();
  }
});

// ── Fold all ──

document.getElementById('btn-fold-all').addEventListener('click', () => {
  const anyExpanded = tree.some(function check(n) {
    return n.type === 'folder' && (n.expanded !== false || (n.children || []).some(check));
  });
  setAllExpanded(tree, !anyExpanded);
  save();
  render();
});

// ── Export / Import ──

document.getElementById('btn-export').addEventListener('click', () => {
  const data = { tree, pinnedIds };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'arcsider-backup.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      showBackupPreview(parseBackup(JSON.parse(reader.result)));
    } catch (error) {
      showStatus(`未导入，现有收藏未改变：${error.message}`);
    }
  };
  reader.onerror = () => showStatus('读取文件失败，现有收藏未改变。');
  reader.readAsText(file);
  e.target.value = '';
});

// ── Import from Arc Browser ──

function parseArcSidebar(arcData) {
  const containers = arcData.sidebar?.containers || [];

  const items = {};
  const spaces = [];
  for (const c of containers) {
    if (c?.items) {
      for (const item of c.items) {
        if (item?.id) items[item.id] = item;
      }
    }
    if (c?.spaces) {
      for (const s of c.spaces) {
        if (s?.title) spaces.push(s);
      }
    }
  }

  return { items, spaces };
}

function convertArcNode(itemId, items, depth = 0) {
  const item = items[itemId];
  if (!item) return null;

  const childrenIds = item.childrenIds || [];
  const tabData = item.data?.tab || {};
  const title = item.title || tabData.savedTitle || 'Untitled';
  const url = tabData.savedURL || '';

  if (childrenIds.length > 0) {
    const children = [];
    for (const cid of childrenIds) {
      if (typeof cid === 'string') {
        const child = convertArcNode(cid, items, depth + 1);
        if (child) children.push(child);
      }
    }
    return { id: generateId(), type: 'folder', name: title, expanded: depth < 2, children };
  } else if (url) {
    return { id: generateId(), type: 'link', title, url };
  }
  return null;
}

function convertArcSpace(space, items, pinnedOnly) {
  const containerIds = space.containerIDs || [];
  const result = [];
  const arcPinnedIds = [];
  let section = null;

  for (const cid of containerIds) {
    if (cid === 'pinned') { section = 'pinned'; continue; }
    if (cid === 'unpinned') { section = 'unpinned'; continue; }
    if (pinnedOnly && section !== 'pinned') continue;

    const container = items[cid];
    if (!container) continue;
    for (const childId of (container.childrenIds || [])) {
      if (typeof childId === 'string') {
        const node = convertArcNode(childId, items);
        if (node) {
          result.push(node);
          if (section === 'pinned' && node.type === 'link') {
            arcPinnedIds.push(node.id);
          }
        }
      }
    }
  }
  return { items: result, arcPinnedIds };
}

function showArcImportForm(arcData) {
  const { items, spaces } = parseArcSidebar(arcData);

  let overlay = document.getElementById('form-overlay');
  if (overlay) overlay.remove();

  const spaceOptions = spaces.map(s =>
    `<label class="form-checkbox"><input type="checkbox" value="${s.title}" checked> ${s.title}</label>`
  ).join('');

  overlay = document.createElement('div');
  overlay.id = 'form-overlay';
  overlay.className = 'form-overlay';
  overlay.innerHTML = `
    <div class="form-dialog">
      <div class="form-title">Import from Arc Browser</div>
      <label class="form-label">Spaces to import</label>
      <div class="form-checkboxes">${spaceOptions}</div>
      <label class="form-checkbox" style="margin-top:8px">
        <input type="checkbox" id="arc-pinned-only"> Pinned only
      </label>
      <label class="form-checkbox">
        <input type="checkbox" id="arc-auto-pin" checked> Auto-pin Arc's pinned links
      </label>
      <label class="form-checkbox">
        <input type="checkbox" id="arc-replace"> Replace current data
      </label>
      <div class="form-buttons">
        <button id="form-cancel" class="form-btn form-btn-cancel">Cancel</button>
        <button id="form-save" class="form-btn form-btn-save">Import</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();

  document.getElementById('form-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  document.getElementById('form-save').addEventListener('click', () => {
    const selectedSpaces = [...overlay.querySelectorAll('.form-checkboxes input:checked')]
      .map(cb => cb.value);
    const pinnedOnly = document.getElementById('arc-pinned-only').checked;
    const autoPin = document.getElementById('arc-auto-pin').checked;
    const replace = document.getElementById('arc-replace').checked;

    const selectedData = [];
    let allArcPinnedIds = [];
    for (const space of spaces) {
      if (!selectedSpaces.includes(space.title)) continue;
      const { items: spaceItems, arcPinnedIds: spacePinned } = convertArcSpace(space, items, pinnedOnly);
      if (spaceItems.length === 0) continue;
      selectedData.push({ title: space.title, items: spaceItems });
      allArcPinnedIds.push(...spacePinned);
    }

    let imported;
    if (selectedData.length === 1) {
      imported = selectedData[0].items;
    } else {
      imported = selectedData.map(s => ({
        id: generateId(),
        type: 'folder',
        name: s.title,
        expanded: true,
        children: s.items,
      }));
    }

    close();
    const candidate = replace
      ? { tree: imported, pinnedIds: autoPin ? allArcPinnedIds : [] }
      : { tree: [...tree, ...imported], pinnedIds: [...pinnedIds, ...(autoPin ? allArcPinnedIds : [])] };
    try { showBackupPreview(parseBackup(candidate)); }
    catch (error) { showStatus(`未导入，现有收藏未改变：${error.message}`); }
  });
}

document.getElementById('btn-import-arc').addEventListener('click', () => {
  let overlay = document.getElementById('form-overlay');
  if (overlay) overlay.remove();

  const arcPath = '~/Library/Application Support/Arc/StorableSidebar.json';

  overlay = document.createElement('div');
  overlay.id = 'form-overlay';
  overlay.className = 'form-overlay';
  overlay.innerHTML = `
    <div class="form-dialog">
      <div class="form-title">Import from Arc Browser</div>
      <p class="form-hint">In the Finder dialog, press <strong>Cmd+Shift+G</strong> and paste the path below:</p>
      <div class="form-path-row">
        <code class="form-path">${arcPath}</code>
        <button id="arc-copy-path" class="form-btn form-btn-cancel" style="padding:4px 8px;font-size:12px">Copy</button>
      </div>
      <div class="form-buttons" style="margin-top:12px">
        <button id="form-cancel" class="form-btn form-btn-cancel">Cancel</button>
        <button id="arc-select-file" class="form-btn form-btn-save">Select file</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  document.getElementById('form-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  document.getElementById('arc-copy-path').addEventListener('click', () => {
    navigator.clipboard.writeText(arcPath);
    document.getElementById('arc-copy-path').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('arc-copy-path').textContent = 'Copy'; }, 1500);
  });

  document.getElementById('arc-select-file').addEventListener('click', () => {
    close();
    document.getElementById('import-arc-file').click();
  });
});

document.getElementById('import-arc-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const arcData = JSON.parse(reader.result);
      if (!arcData.sidebar?.containers) throw new Error('Not an Arc sidebar file');
      showArcImportForm(arcData);
    } catch (err) {
      alert('Invalid Arc StorableSidebar.json file');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── Drop on empty tree area ──

treeEl.addEventListener('dragover', e => {
  if (!draggedId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});

treeEl.addEventListener('drop', e => {
  if (!draggedId) return;
  if (e.target !== treeEl) return;
  e.preventDefault();

  if (dragSource === 'tab') {
    let tabData;
    try { tabData = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    tree.push({ id: generateId(), type: 'link', title: tabData.title, url: tabData.url });
    save();
    render();
    return;
  }

  const removed = removeNode(tree, draggedId);
  if (removed) {
    tree.push(removed);
    save();
    render();
  }
});

// ── Tab change listeners ──

chrome.tabs.onUpdated.addListener(() => renderOpenTabs());
chrome.tabs.onCreated.addListener(() => renderOpenTabs());
chrome.tabs.onAttached.addListener(() => renderOpenTabs());
chrome.tabs.onDetached.addListener(() => renderOpenTabs());
chrome.tabs.onRemoved.addListener(() => renderOpenTabs());
chrome.tabs.onActivated.addListener(() => renderOpenTabs());

// ── Edit Link Form ──

function showEditLinkForm(node) {
  let overlay = document.getElementById('form-overlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'form-overlay';
  overlay.className = 'form-overlay';
  overlay.innerHTML = `
    <div class="form-dialog">
      <div class="form-title">Edit link</div>
      <label class="form-label">Name</label>
      <input type="text" id="form-edit-name" class="form-input" value="${node.title.replace(/"/g, '&quot;')}">
      <label class="form-label">URL</label>
      <input type="text" id="form-edit-url" class="form-input" value="${(node.url || '').replace(/"/g, '&quot;')}">
      <div class="form-buttons">
        <button id="form-cancel" class="form-btn form-btn-cancel">Cancel</button>
        <button id="form-save" class="form-btn form-btn-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const nameInput = document.getElementById('form-edit-name');
  const urlInput = document.getElementById('form-edit-url');
  nameInput.focus();
  nameInput.select();

  const close = () => overlay.remove();

  const submit = () => {
    const name = nameInput.value.trim();
    const url = normalizeUrl(urlInput.value.trim());
    if (!name || !url) return;
    node.title = name;
    node.url = url;
    save();
    render();
    close();
  };

  document.getElementById('form-cancel').addEventListener('click', close);
  document.getElementById('form-save').addEventListener('click', submit);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') urlInput.focus();
    if (e.key === 'Escape') close();
  });
  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') close();
  });
}

// ── Add Link Form ──

function showAddLinkForm(parentNode) {
  let overlay = document.getElementById('form-overlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'form-overlay';
  overlay.className = 'form-overlay';
  overlay.innerHTML = `
    <div class="form-dialog">
      <div class="form-title">Add link to "${parentNode.name}"</div>
      <input type="text" id="form-link-name" class="form-input" placeholder="Name" autofocus>
      <input type="text" id="form-link-url" class="form-input" placeholder="https://...">
      <div class="form-buttons">
        <button id="form-cancel" class="form-btn form-btn-cancel">Cancel</button>
        <button id="form-save" class="form-btn form-btn-save">Add</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const nameInput = document.getElementById('form-link-name');
  const urlInput = document.getElementById('form-link-url');

  // Pre-fill with current tab
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab && !nameInput.value) {
      nameInput.value = tab.title || '';
      urlInput.value = tab.url || '';
      nameInput.select();
    }
  });

  const close = () => overlay.remove();

  const submit = () => {
    const name = nameInput.value.trim();
    const url = normalizeUrl(urlInput.value.trim());
    if (!name || !url) return;
    if (!parentNode.children) parentNode.children = [];
    parentNode.children.push({
      id: generateId(),
      type: 'link',
      title: name,
      url,
    });
    parentNode.expanded = true;
    save();
    render();
    close();
  };

  document.getElementById('form-cancel').addEventListener('click', close);
  document.getElementById('form-save').addEventListener('click', submit);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') urlInput.focus();
    if (e.key === 'Escape') close();
  });
  urlInput.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

// ── Folder dropdown helper ──

function collectFolderOptions(nodes, path = '') {
  const options = [];
  for (const node of nodes) {
    if (node.type === 'folder') {
      const label = path ? `${path} / ${node.name}` : node.name;
      options.push({ id: node.id, label });
      if (node.children) {
        options.push(...collectFolderOptions(node.children, label));
      }
    }
  }
  return options;
}

function folderSelectHtml(selectedId) {
  const folders = collectFolderOptions(tree);
  const opts = folders.map(f =>
    `<option value="${f.id}"${f.id === selectedId ? ' selected' : ''}>${f.label}</option>`
  ).join('');
  return `<option value="">(Top level)</option>${opts}`;
}

// ── Context menu forms (triggered from background.js) ──

function showContextAddLinkForm(prefillTitle, prefillUrl) {
  let overlay = document.getElementById('form-overlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'form-overlay';
  overlay.className = 'form-overlay';
  overlay.innerHTML = `
    <div class="form-dialog">
      <div class="form-title">Add page to Arcsider</div>
      <label class="form-label">Name</label>
      <input type="text" id="form-ctx-name" class="form-input" value="${(prefillTitle || '').replace(/"/g, '&quot;')}">
      <label class="form-label">URL</label>
      <input type="text" id="form-ctx-url" class="form-input" value="${(prefillUrl || '').replace(/"/g, '&quot;')}">
      <label class="form-label">Folder</label>
      <select id="form-ctx-folder" class="form-input">${folderSelectHtml()}</select>
      <div class="form-buttons">
        <button id="form-cancel" class="form-btn form-btn-cancel">Cancel</button>
        <button id="form-save" class="form-btn form-btn-save">Add</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const nameInput = document.getElementById('form-ctx-name');
  const urlInput = document.getElementById('form-ctx-url');
  const folderSelect = document.getElementById('form-ctx-folder');
  nameInput.focus();
  nameInput.select();

  const close = () => overlay.remove();

  const submit = () => {
    const name = nameInput.value.trim();
    const url = normalizeUrl(urlInput.value.trim());
    if (!name || !url) return;
    const newLink = { id: generateId(), type: 'link', title: name, url };
    const folderId = folderSelect.value;
    if (folderId) {
      const folder = findNode(tree, folderId);
      if (folder) {
        if (!folder.children) folder.children = [];
        folder.children.push(newLink);
        folder.expanded = true;
      } else {
        tree.push(newLink);
      }
    } else {
      tree.push(newLink);
    }
    save();
    render();
    close();
  };

  document.getElementById('form-cancel').addEventListener('click', close);
  document.getElementById('form-save').addEventListener('click', submit);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') urlInput.focus();
    if (e.key === 'Escape') close();
  });
  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') close();
  });
}

function showContextAddFolderForm() {
  let overlay = document.getElementById('form-overlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'form-overlay';
  overlay.className = 'form-overlay';
  overlay.innerHTML = `
    <div class="form-dialog">
      <div class="form-title">New folder</div>
      <label class="form-label">Name</label>
      <input type="text" id="form-ctx-folder-name" class="form-input" placeholder="Folder name" autofocus>
      <label class="form-label">Nest inside</label>
      <select id="form-ctx-parent" class="form-input">${folderSelectHtml()}</select>
      <div class="form-buttons">
        <button id="form-cancel" class="form-btn form-btn-cancel">Cancel</button>
        <button id="form-save" class="form-btn form-btn-save">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const nameInput = document.getElementById('form-ctx-folder-name');
  const parentSelect = document.getElementById('form-ctx-parent');
  nameInput.focus();

  const close = () => overlay.remove();

  const submit = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const newFolder = { id: generateId(), type: 'folder', name, children: [], expanded: true };
    const parentId = parentSelect.value;
    if (parentId) {
      const parent = findNode(tree, parentId);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(newFolder);
        parent.expanded = true;
      } else {
        tree.push(newFolder);
      }
    } else {
      tree.push(newFolder);
    }
    save();
    render();
    close();
  };

  document.getElementById('form-cancel').addEventListener('click', close);
  document.getElementById('form-save').addEventListener('click', submit);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') close();
  });
}

// ── Message listener (from background.js context menu) ──

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== 'show-add-form') return;
  if (msg.type === 'link') {
    showContextAddLinkForm(msg.title, msg.url);
  } else if (msg.type === 'folder') {
    showContextAddFolderForm();
  }
});

function showStatus(message) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.hidden = false;
}

function showBackupPreview(data, recovery = false) {
  const overlay = document.createElement('div');
  overlay.className = 'form-overlay';
  overlay.innerHTML = `<div class="form-dialog backup-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-title">
    <div class="form-title" id="backup-title"></div>
    <p class="backup-summary"></p>
    <p class="form-hint">确认后替换当前收藏；替换前的数据会保存为本地恢复点。请同时保留原始导出文件。</p>
    <div class="backup-actions"><button class="form-btn-cancel">取消</button><button class="form-btn-save">确认替换</button></div>
  </div>`;
  overlay.querySelector('.form-title').textContent = recovery ? '恢复上次导入前的收藏' : '导入预览';
  overlay.querySelector('.backup-summary').textContent = `${data.folderCount} 个文件夹，${data.linkCount} 个链接，${data.pinnedIds.length} 个顶部固定项。` +
    (data.ignoredPinnedCount ? ` 忽略 ${data.ignoredPinnedCount} 个失效或重复的固定引用，收藏链接均保留。` : '');
  const previousFocus = document.activeElement;
  const cancel = overlay.querySelector('.form-btn-cancel');
  const submit = overlay.querySelector('.form-btn-save');
  let busy = false;
  const close = () => { if (!busy) { overlay.remove(); previousFocus?.focus(); } };
  cancel.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      (document.activeElement === cancel ? submit : cancel).focus();
    }
  });
  submit.addEventListener('click', async () => {
    busy = true;
    submit.disabled = cancel.disabled = true;
    try {
      const stored = await chrome.storage.local.get([STORAGE_KEY, PINNED_KEY]);
      const before = { tree: stored[STORAGE_KEY] || [], pinnedIds: stored[PINNED_KEY] || [], savedAt: new Date().toISOString() };
      // One storage write: a failed write never replaces the current in-memory tree.
      await chrome.storage.local.set({ [BACKUP_KEY]: before, [STORAGE_KEY]: data.tree, [PINNED_KEY]: data.pinnedIds });
      tree = data.tree;
      pinnedIds = data.pinnedIds;
      render();
      busy = false;
      close();
      showStatus(`${recovery ? '已恢复' : '已导入'} ${data.folderCount} 个文件夹、${data.linkCount} 个链接。可用 ↶ 恢复替换前的数据。`);
    } catch (error) {
      busy = false;
      submit.disabled = cancel.disabled = false;
      showStatus(`写入失败，未替换当前收藏：${error.message}`);
    }
  });
  document.body.appendChild(overlay);
  cancel.focus();
}

document.getElementById('btn-recover').addEventListener('click', async () => {
  try {
    const stored = await chrome.storage.local.get(BACKUP_KEY);
    if (!stored[BACKUP_KEY]) { showStatus('尚无导入恢复点。导入前请先导出旧插件的数据。'); return; }
    showBackupPreview(parseBackup(stored[BACKUP_KEY]), true);
  } catch (error) { showStatus(`无法恢复：${error.message}`); }
});

// Shared settings apply to both the native panel and the injected drawer.
const pinButton = document.getElementById('btn-drawer-pin');
pinButton.hidden = !embedded;
function updatePin(pinned) {
  pinButton.setAttribute('aria-pressed', String(pinned));
  pinButton.title = pinned ? '取消固定，移出后自动收起' : '固定左侧抽屉';
  pinButton.setAttribute('aria-label', pinButton.title);
  pinButton.textContent = pinned ? '◆' : '◇';
}
pinButton.addEventListener('click', () => {
  chrome.storage.local.set({ arc_sidebar_drawer_pinned: pinButton.getAttribute('aria-pressed') !== 'true' })
    .catch(error => showStatus(`固定设置失败：${error.message}`));
});
document.addEventListener('keydown', e => {
  if (embedded && e.key === 'Escape' && !document.querySelector('.form-overlay, .label-input') && contextMenu.classList.contains('hidden')) {
    window.parent.postMessage({ action: 'arcsider-close' }, '*');
  }
});

const resizer = document.getElementById('tabs-resizer');
let tabsRatio = 40;
function setTabsRatio(value) {
  tabsRatio = Math.max(10, Math.min(75, Number(value) || 40));
  document.documentElement.style.setProperty('--tabs-height', `${tabsRatio}vh`);
  resizer.setAttribute('aria-valuenow', String(Math.round(tabsRatio)));
}
const saveTabsRatio = () => chrome.storage.local.set({ arc_sidebar_tabs_ratio: tabsRatio })
  .catch(error => showStatus(`布局保存失败：${error.message}`));
resizer.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  resizer.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing-tabs');
});
resizer.addEventListener('pointermove', e => {
  if (resizer.hasPointerCapture(e.pointerId)) setTabsRatio((window.innerHeight - e.clientY - 26) / window.innerHeight * 100);
});
function endResize(e) {
  if (!resizer.hasPointerCapture(e.pointerId)) return;
  resizer.releasePointerCapture(e.pointerId);
  document.body.classList.remove('resizing-tabs');
  saveTabsRatio();
}
resizer.addEventListener('pointerup', endResize);
resizer.addEventListener('pointercancel', endResize);
resizer.addEventListener('keydown', e => {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  setTabsRatio(e.key === 'Home' ? 10 : e.key === 'End' ? 75 : tabsRatio + (e.key === 'ArrowUp' ? 5 : -5));
  saveTabsRatio();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.arc_sidebar_drawer_pinned) updatePin(changes.arc_sidebar_drawer_pinned.newValue === true);
  if (changes.arc_sidebar_tabs_ratio) setTabsRatio(changes.arc_sidebar_tabs_ratio.newValue);
  let changed = false;
  if (changes[STORAGE_KEY] && JSON.stringify(tree) !== JSON.stringify(changes[STORAGE_KEY].newValue || [])) {
    tree = changes[STORAGE_KEY].newValue || [];
    changed = true;
  }
  if (changes[PINNED_KEY] && JSON.stringify(pinnedIds) !== JSON.stringify(changes[PINNED_KEY].newValue || [])) {
    pinnedIds = changes[PINNED_KEY].newValue || [];
    changed = true;
  }
  if (changed) render();
});

// ── Init ──
chrome.storage.local.get(['arc_sidebar_drawer_pinned', 'arc_sidebar_tabs_ratio']).then(settings => {
  updatePin(settings.arc_sidebar_drawer_pinned === true);
  setTabsRatio(settings.arc_sidebar_tabs_ratio);
});
load().then(render);
