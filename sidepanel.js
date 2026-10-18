// Element Collector - side panel
(() => {
  const $ = (s, r = document) => r.querySelector(s);

  const state = {
    items: [],
    id: null,
    tab: 'html',
    width: 'fit',
    bg: 'light',
    picking: false,
    confirmClear: false
  };

  const ICONS = {
    pick: '<rect x="9" y="9" width="6" height="6" rx="1"/><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    heart: '<path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6C19 16.5 12 21 12 21z"/>'
  };
  const icon = (name, size = 16) =>
    '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return u || ''; } };
  const fmtDate = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const current = () => state.items.find((i) => i.id === state.id) || null;

  // ---------------------------------------------------------------------------
  // Static chrome
  // ---------------------------------------------------------------------------
  const donate = $('#donate');
  donate.href = (typeof CONFIG !== 'undefined' && CONFIG.DONATE_URL) || '#';
  donate.innerHTML = icon('heart', 14) + '<span>Support the project</span>';

  function updatePick() {
    const b = $('#pick');
    b.innerHTML = icon('pick') + '<span>' + (state.picking ? 'Cancel picking' : 'Pick element') + '</span>';
  }

  function notice(text, warn) {
    const n = $('#notice');
    if (!text) { n.hidden = true; return; }
    n.textContent = text;
    n.className = 'notice' + (warn ? ' warn' : '');
    n.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------
  async function load() {
    const { items = [] } = await chrome.storage.local.get('items');
    state.items = items;
    render();
  }

  async function save() {
    await chrome.storage.local.set({ items: state.items });
  }

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local' || !ch.items) return;
    const oldIds = new Set((ch.items.oldValue || []).map((i) => i.id));
    state.items = ch.items.newValue || [];
    const added = state.items.find((i) => !oldIds.has(i.id));
    if (added) { state.id = added.id; state.picking = false; state.tab = 'html'; notice(''); }
    else if (!current()) state.id = null;
    updatePick();
    render();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'PICK_ENDED') { state.picking = false; updatePick(); }
  });

  // ---------------------------------------------------------------------------
  // Picking
  // ---------------------------------------------------------------------------
  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function togglePick() {
    const tab = await activeTab();
    if (state.picking) {
      state.picking = false;
      updatePick();
      if (tab && tab.id) chrome.tabs.sendMessage(tab.id, { type: 'EC_STOP' }).catch(() => {});
      return;
    }
    if (!tab || !tab.id || !/^(https?|file):/.test(tab.url || '')) {
      notice('This page cannot be inspected. Open a regular website and try again.', true);
      return;
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'EC_START' });
      state.picking = true;
      notice('');
      updatePick();
      render();
    } catch (e) {
      notice('Could not start on this page. Some pages, such as the Chrome Web Store, block extensions.', true);
    }
  }

  document.addEventListener('keydown', async (e) => {
    if (!state.picking) return;
    const map = { Escape: 'EC_STOP', ArrowUp: 'EC_PARENT', ArrowDown: 'EC_CHILD', Enter: 'EC_COLLECT' };
    const type = map[e.key];
    if (!type) return;
    e.preventDefault();
    const tab = await activeTab();
    if (tab && tab.id) chrome.tabs.sendMessage(tab.id, { type }).catch(() => {});
    if (type === 'EC_STOP') { state.picking = false; updatePick(); render(); }
  });

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function render() {
    const view = $('#view');
    const item = current();
    if (item) renderDetail(view, item);
    else renderList(view);
  }

  function renderList(view) {
    const hint = state.picking
      ? '<p class="hint">Hover an element on the page and click it. Up and Down arrows move between parent and child. Esc cancels.</p>'
      : '';
    if (!state.items.length) {
      view.innerHTML = hint + '<div class="empty"><h2>Nothing collected yet</h2><p>Press Pick element, then click any button, card or section on the page.</p><p>You get its HTML, CSS, interactive states and responsive CSS here.</p></div>';
      return;
    }
    const cards = state.items.map((i) => (
      '<li class="card" data-act="open" data-id="' + esc(i.id) + '">' +
        '<div class="thumb">' + (i.thumb ? '<img src="' + i.thumb + '" alt="">' : '<span>No preview</span>') + '</div>' +
        '<div class="card-body"><div class="card-name">' + esc(i.name) + '</div>' +
        '<div class="card-meta">' + esc(hostOf(i.url)) + ' - ' + esc(fmtDate(i.createdAt)) + '</div></div>' +
        '<button class="icon-btn danger" data-act="delete" data-id="' + esc(i.id) + '" title="Delete" type="button">' + icon('trash') + '</button>' +
      '</li>'
    )).join('');
    view.innerHTML = hint +
      '<div class="list-head"><span>' + state.items.length + ' collected</span>' +
      '<button class="link-btn" data-act="clear" type="button">' + (state.confirmClear ? 'Click again to confirm' : 'Clear all') + '</button></div>' +
      '<ul class="cards">' + cards + '</ul>';
  }

  function seg(group, options, active) {
    return '<div class="seg" data-group="' + group + '">' +
      options.map(([v, label]) => '<button type="button" data-v="' + v + '" class="' + (active === v ? 'on' : '') + '">' + label + '</button>').join('') +
      '</div>';
  }

  function codeFor(item, tab) {
    if (tab === 'html') return item.html;
    if (tab === 'css') return item.css || '/* No computed styles differ from browser defaults. */';
    if (tab === 'responsive') return item.responsive;
    return snippet(item);
  }

  function snippet(item) {
    const css = [item.css, item.responsive].filter(Boolean).join('\n\n');
    return (css ? '<style>\n' + css + '\n</style>\n\n' : '') + item.html;
  }

  function standalone(item) {
    const css = [item.css, item.responsive].filter(Boolean).join('\n\n');
    return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' +
      esc(item.name) + '</title>\n<style>\nbody { margin: 0; padding: 16px; }\n' + css + '\n</style>\n</head>\n<body>\n' + item.html + '\n</body>\n</html>\n';
  }

  function renderDetail(view, item) {
    const code = codeFor(item, state.tab);
    const empty = state.tab === 'responsive' && !code;
    const kb = (code.length / 1024).toFixed(1);
    const lines = code ? code.split('\n').length : 0;
    const warn = item.skippedSheets
      ? '<div class="notice warn" style="margin:0 0 10px">' + item.skippedSheets + ' stylesheet(s) could not be read, so some responsive rules may be missing.</div>'
      : '';

    view.innerHTML =
      '<div class="detail-head">' +
        '<button class="icon-btn" data-act="back" title="Back" type="button">' + icon('back') + '</button>' +
        '<div class="detail-title"><div class="t-name">' + esc(item.name) + '</div>' +
        '<a class="t-src" href="' + esc(item.url) + '" target="_blank" rel="noopener">' + esc(hostOf(item.url)) + '</a></div>' +
        '<button class="icon-btn danger" data-act="delete" data-id="' + esc(item.id) + '" title="Delete" type="button">' + icon('trash') + '</button>' +
      '</div>' + warn +
      '<div class="controls">' +
        seg('width', [['fit', 'Fit'], ['375', 'Mobile'], ['768', 'Tablet'], ['1280', 'Desktop']], state.width) +
        seg('bg', [['light', 'Light'], ['dark', 'Dark'], ['grid', 'Grid']], state.bg) +
      '</div>' +
      '<div class="stage" id="stage"><div class="frame-wrap" id="frameWrap"><iframe id="preview" sandbox="allow-same-origin" title="Live preview"></iframe></div></div>' +
      '<div class="tabs">' +
        [['html', 'HTML'], ['css', 'CSS'], ['responsive', 'Responsive CSS'], ['all', 'HTML + CSS']]
          .map(([k, l]) => '<button type="button" data-tab="' + k + '" class="' + (state.tab === k ? 'on' : '') + '">' + l + '</button>').join('') +
      '</div>' +
      '<div class="code-head"><span>' + (empty ? '' : kb + ' KB, ' + lines + ' lines') + '</span>' +
        '<button class="btn small" data-act="copy" type="button"' + (empty ? ' disabled' : '') + '>' + icon('copy', 14) + '<span>Copy</span></button></div>' +
      '<pre class="code' + (empty ? ' muted' : '') + '" id="code"></pre>' +
      '<div class="foot-actions">' +
        '<button class="btn" data-act="copy-all" type="button">' + icon('copy', 14) + '<span>Copy HTML + CSS</span></button>' +
        '<button class="btn" data-act="download" type="button">' + icon('download', 14) + '<span>Download .html</span></button>' +
        '<button class="btn primary" data-act="edit" type="button"><span>Edit in editor</span></button>' +
      '</div>' +
      '<div class="meta">' + item.nodes + ' elements, collected ' + esc(fmtDate(item.createdAt)) + '</div>';

    $('#code').textContent = empty ? 'No media queries targeting this element were found on the page.' : code;
    setupPreview(item);
  }

  // ---------------------------------------------------------------------------
  // Live preview
  // ---------------------------------------------------------------------------
  const BG = {
    light: 'background:#ffffff',
    dark: 'background:#0f172a',
    grid: 'background-color:#ffffff;background-image:linear-gradient(45deg,#eceff3 25%,transparent 25%,transparent 75%,#eceff3 75%),linear-gradient(45deg,#eceff3 25%,transparent 25%,transparent 75%,#eceff3 75%);background-size:16px 16px;background-position:0 0,8px 8px'
  };

  function previewDoc(item) {
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>html,body{margin:0}body{padding:16px;' + BG[state.bg] + '}</style>' +
      '<style>' + item.css + '</style><style>' + item.responsive + '</style></head><body>' + item.html + '</body></html>';
  }

  let resizeObs = null;
  function setupPreview(item) {
    const ifr = $('#preview');
    const stage = $('#stage');
    if (!ifr || !stage) return;
    ifr.addEventListener('load', () => {
      fitPreview();
      setTimeout(fitPreview, 300);
      setTimeout(fitPreview, 1200);
    });
    ifr.srcdoc = previewDoc(item);
    if (resizeObs) resizeObs.disconnect();
    resizeObs = new ResizeObserver(() => fitPreview());
    resizeObs.observe(stage);
  }

  function fitPreview() {
    const ifr = $('#preview');
    const stage = $('#stage');
    const wrap = $('#frameWrap');
    if (!ifr || !stage || !wrap) return;
    const avail = stage.clientWidth || 360;
    const logical = state.width === 'fit' ? avail : Number(state.width);
    ifr.style.width = logical + 'px';
    ifr.style.height = '10px';
    ifr.style.transform = 'none';
    let h = 120;
    try {
      const d = ifr.contentDocument;
      if (d && d.documentElement) h = Math.max(60, d.documentElement.scrollHeight);
    } catch (e) { /* ignore */ }
    ifr.style.height = h + 'px';
    const scale = Math.min(1, avail / logical);
    ifr.style.transformOrigin = 'top left';
    ifr.style.transform = 'scale(' + scale + ')';
    wrap.style.height = Math.ceil(h * scale) + 'px';
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    if (btn) {
      const span = btn.querySelector('span');
      const old = span.textContent;
      span.textContent = 'Copied';
      setTimeout(() => { span.textContent = old; }, 1200);
    }
  }

  function download(item) {
    const blob = new Blob([standalone(item)], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = item.name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() + '.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function openEditor(itemId) {
    const { editorAlive, editorTab } = await chrome.storage.local.get(['editorAlive', 'editorTab']);
    if (itemId) await chrome.storage.local.set({ pendingAdd: { id: itemId, t: Date.now() } });
    const alive = editorAlive && Date.now() - editorAlive < 5000 && editorTab;
    if (alive) {
      try {
        await chrome.tabs.update(editorTab.id, { active: true });
        await chrome.windows.update(editorTab.windowId, { focused: true });
        return;
      } catch (e) { /* tab is gone, open a new one */ }
    }
    chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
  }

  $('#pick').addEventListener('click', togglePick);
  $('#openEditor').addEventListener('click', () => openEditor());

  $('#view').addEventListener('click', async (e) => {
    const segBtn = e.target.closest('.seg button');
    if (segBtn) {
      const group = segBtn.parentElement.dataset.group;
      state[group] = segBtn.dataset.v;
      render();
      return;
    }
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) { state.tab = tabBtn.dataset.tab; render(); return; }

    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const item = current();

    if (act === 'open') { state.id = el.dataset.id; state.tab = 'html'; render(); }
    else if (act === 'back') { state.id = null; render(); }
    else if (act === 'delete') {
      e.stopPropagation();
      state.items = state.items.filter((i) => i.id !== el.dataset.id);
      if (state.id === el.dataset.id) state.id = null;
      await save();
      render();
    } else if (act === 'clear') {
      if (!state.confirmClear) {
        state.confirmClear = true;
        render();
        setTimeout(() => { state.confirmClear = false; if (!current()) render(); }, 3000);
      } else {
        state.confirmClear = false;
        state.items = [];
        await save();
        render();
      }
    } else if (act === 'copy' && item) copyText(codeFor(item, state.tab), el);
    else if (act === 'copy-all' && item) copyText(snippet(item), el);
    else if (act === 'download' && item) download(item);
    else if (act === 'edit' && item) openEditor(item.id);
  });

  updatePick();
  load();
})();
