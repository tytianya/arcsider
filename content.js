// Only the top-level HTTP(S) page receives a drawer. The UI stays on our origin.
(() => {
  const host = document.createElement('div');
  host.id = 'arcsider-drawer';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; position: fixed !important; left: 0 !important; top: 0 !important;
      height: 100dvh !important; width: min(380px, 92vw) !important; z-index: 2147483647 !important;
      transform: translateX(calc(-100% + 5px)); transition: transform 160ms ease;
      color-scheme: light dark; visibility: hidden; }
    :host([data-ready]) { visibility: visible; }
    :host([data-pinned]) { transition: none; }
    :host([data-open]) { transform: translateX(0); }
    .edge { position: absolute; right: 0; top: 0; width: 5px; height: 100%;
      background: transparent; cursor: e-resize; }
    .edge:hover, .edge:focus-visible { background: Highlight; outline: none; }
    iframe { width: calc(100% - 5px); height: 100%; border: 0; display: block;
      background: Canvas; box-shadow: 3px 0 14px #0003; }
    @media (prefers-reduced-motion: reduce) { :host { transition: none; } }
  `;
  const edge = document.createElement('div');
  edge.className = 'edge';
  edge.tabIndex = 0;
  edge.setAttribute('role', 'button');
  edge.setAttribute('aria-label', '展开 Arcsider 收藏侧栏');
  const frame = document.createElement('iframe');
  frame.title = 'Arcsider 收藏侧栏';
  frame.inert = true;
  frame.setAttribute('allow', 'clipboard-write');
  shadow.append(style, frame, edge);
  let pinned = false;
  let inside = false;
  let timer;
  let pinRevision = 0;
  function open() {
    clearTimeout(timer);
    if (!frame.src) frame.src = chrome.runtime.getURL('sidepanel.html?drawer=1');
    host.setAttribute('data-open', '');
    frame.inert = false;
  }
  function close() {
    clearTimeout(timer);
    if (!pinned) { host.removeAttribute('data-open'); frame.inert = true; }
  }
  host.addEventListener('pointerenter', () => {
    inside = true;
    clearTimeout(timer);
    timer = setTimeout(open, 100);
  });
  host.addEventListener('pointerleave', () => {
    inside = false;
    clearTimeout(timer);
    timer = setTimeout(close, 300);
  });
  edge.addEventListener('click', open);
  edge.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); frame.focus(); }
    if (e.key === 'Escape') close();
  });
  window.addEventListener('message', e => {
    if (e.source !== frame.contentWindow || e.origin !== new URL(chrome.runtime.getURL('/')).origin) return;
    if (e.data?.action === 'arcsider-close' && !pinned) { close(); edge.focus(); }
  });
  function applyPin(value) {
    pinned = value === true;
    host.toggleAttribute('data-pinned', pinned);
    if (pinned) open();
    else if (!inside) close();
    host.setAttribute('data-ready', '');
  }
  function restorePin() {
    const revision = pinRevision;
    chrome.storage.local.get('arc_sidebar_drawer_pinned').then(result => {
      if (revision === pinRevision) applyPin(result.arc_sidebar_drawer_pinned);
    }).catch(() => { if (revision === pinRevision) applyPin(false); });
  }
  restorePin();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.arc_sidebar_drawer_pinned) return;
    pinRevision++;
    applyPin(changes.arc_sidebar_drawer_pinned.newValue);
  });
  // document_start can precede documentElement; do not wait for the page body/load.
  if (document.documentElement) document.documentElement.appendChild(host);
  else {
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      document.documentElement.appendChild(host);
      observer.disconnect();
    });
    observer.observe(document, { childList: true });
  }
  window.addEventListener('pageshow', event => { if (event.persisted) restorePin(); });
})();
