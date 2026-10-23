// Element Collector - Live CSS section (side panel)
// Lets a developer edit CSS on the open page and see the result instantly, before anything is deployed.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const GROUPS = [
    ['Typography', [['color', 'color'], ['font-size'], ['font-weight'], ['line-height'], ['letter-spacing'], ['text-align'], ['font-family']]],
    ['Background and border', [['background-color', 'color'], ['border-radius'], ['border-width'], ['border-style'], ['border-color', 'color'], ['box-shadow'], ['opacity']]],
    ['Spacing and size', [['padding'], ['margin'], ['width'], ['height'], ['gap']]],
    ['Layout', [['display'], ['position'], ['flex-direction'], ['justify-content'], ['align-items']]]
  ];
  const ALL_PROPS = GROUPS.flatMap((g) => g[1].map((p) => p[0]));
  const OPTIONS = {
    display: ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'none'],
    position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
    'text-align': ['left', 'center', 'right', 'justify'],
    'font-weight': ['300', '400', '500', '600', '700', '800'],
    'border-style': ['none', 'solid', 'dashed', 'dotted', 'double'],
    'flex-direction': ['row', 'row-reverse', 'column', 'column-reverse'],
    'justify-content': ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
    'align-items': ['stretch', 'flex-start', 'center', 'flex-end', 'baseline']
  };

  const state = { tabId: null, mode: 'collect' };
  const models = new Map();
  const model = (id) => {
    if (!models.has(id)) {
      models.set(id, { selector: '', count: 0, computed: {}, tag: '', edits: {}, custom: '', enabled: true, picking: false, confirmReset: false });
    }
    return models.get(id);
  };
  const cur = () => model(state.tabId);

  // ---------------------------------------------------------------------------
  // CSS generation
  // ---------------------------------------------------------------------------
  function generatedCss(m) {
    return Object.entries(m.edits)
      .filter(([, props]) => Object.keys(props).length)
      .map(([sel, props]) => sel + ' {\n' + Object.entries(props).map(([k, v]) => '  ' + k + ': ' + v + ' !important;').join('\n') + '\n}')
      .join('\n\n');
  }

  function fullCss(m) {
    return [generatedCss(m), m.custom.trim()].filter(Boolean).join('\n\n');
  }

  function toHex(v) {
    const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(v || '');
    if (m && (m[4] === undefined || parseFloat(m[4]) > 0)) {
      return '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
    }
    if (/^#[0-9a-f]{6}$/i.test(v || '')) return v;
    return '#ffffff';
  }

  // ---------------------------------------------------------------------------
  // Talking to the page
  // ---------------------------------------------------------------------------
  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function send(msg) {
    const tab = await activeTab();
    if (!tab || !tab.id || !/^(https?|file):/.test(tab.url || '')) throw new Error('unsupported');
    let res;
    try { res = await chrome.tabs.sendMessage(tab.id, msg); } catch (e) { res = undefined; }
    if (res === undefined) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['livecss.js'] });
      res = await chrome.tabs.sendMessage(tab.id, msg);
    }
    return res;
  }

  function flash(text, warn) {
    const n = $('#lcMsg');
    if (!n) return;
    if (!text) { n.hidden = true; return; }
    n.textContent = text;
    n.className = 'notice' + (warn ? ' warn' : '');
    n.hidden = false;
  }

  const UNSUPPORTED = 'This page cannot be edited. Open a regular website and try again.';

  let pushTimer = null;
  function push() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      send({ type: 'LC_APPLY', css: fullCss(cur()) }).then(() => flash('')).catch(() => flash(UNSUPPORTED, true));
    }, 40);
  }

  // ---------------------------------------------------------------------------
  // Skeleton
  // ---------------------------------------------------------------------------
  const datalists = Object.entries(OPTIONS)
    .map(([p, list]) => '<datalist id="lc-dl-' + p + '">' + list.map((o) => '<option value="' + o + '"></option>').join('') + '</datalist>')
    .join('');

  $('#liveView').innerHTML =
    '<div class="lc">' +
      '<p class="hint">Edit CSS on the open page and watch it change in real time, before anything is deployed. Nothing is saved to the website. Reloading the page removes every change.</p>' +
      '<div id="lcMsg" class="notice" hidden style="margin:0 0 10px"></div>' +
      '<div class="lc-bar">' +
        '<button id="lcPick" class="btn primary" type="button"></button>' +
        '<label class="lc-toggle"><input type="checkbox" id="lcEnabled" checked> <span>Show my changes</span></label>' +
      '</div>' +
      '<h3 class="lc-h">Selected element</h3>' +
      '<div class="lc-sel"><input id="lcSelector" class="lc-input" type="text" spellcheck="false" autocomplete="off" placeholder="Pick an element or type a CSS selector"><span id="lcCount" class="lc-count"></span></div>' +
      '<div class="lc-nav">' +
        '<button class="btn small" data-nav="parent" type="button">Parent</button>' +
        '<button class="btn small" data-nav="child" type="button">Child</button>' +
        '<button class="btn small" data-nav="prev" type="button">Previous</button>' +
        '<button class="btn small" data-nav="next" type="button">Next</button>' +
        '<span id="lcTag" class="lc-tag"></span>' +
      '</div>' +
      '<h3 class="lc-h">Properties</h3>' +
      '<div id="lcProps"></div>' + datalists +
      '<h3 class="lc-h">Custom CSS</h3>' +
      '<textarea id="lcCustom" class="lc-textarea" spellcheck="false" placeholder=".button:hover { transform: translateY(-2px); }&#10;@media (max-width: 600px) { .nav { display: none; } }"></textarea>' +
      '<h3 class="lc-h">Your changes</h3>' +
      '<div class="code-head"><span id="lcGenMeta"></span>' +
        '<span class="lc-btns">' +
          '<button class="btn small" id="lcCopy" type="button"><span>Copy CSS</span></button>' +
          '<button class="btn small" id="lcDownload" type="button"><span>Download .css</span></button>' +
          '<button class="btn small" id="lcReset" type="button"><span>Reset all</span></button>' +
        '</span></div>' +
      '<pre class="code" id="lcGen"></pre>' +
    '</div>';

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function renderBar() {
    const m = cur();
    $('#lcPick').innerHTML = '<span>' + (m.picking ? 'Cancel picking' : 'Pick element') + '</span>';
    $('#lcEnabled').checked = m.enabled;
  }

  function renderSelector() {
    const m = cur();
    const input = $('#lcSelector');
    if (document.activeElement !== input) input.value = m.selector;
    const c = $('#lcCount');
    if (!m.selector) c.textContent = '';
    else if (m.count < 0) c.textContent = 'Invalid';
    else c.textContent = m.count === 0 ? 'No match' : m.count + (m.count === 1 ? ' match' : ' matches');
    $('#lcTag').textContent = m.tag || '';
  }

  function renderProps() {
    const m = cur();
    const box = $('#lcProps');
    if (!m.selector || m.count < 1) {
      box.innerHTML = '<div class="empty" style="padding:18px 8px"><p>Pick an element on the page, or type a selector, to edit its styles.</p></div>';
      return;
    }
    const edits = m.edits[m.selector] || {};
    box.innerHTML = GROUPS.map(([group, list]) =>
      '<fieldset class="lc-group"><legend>' + group + '</legend>' +
      list.map(([prop, type]) => {
        const edited = edits[prop] != null;
        const val = edited ? edits[prop] : (m.computed[prop] || '');
        return '<div class="lc-row' + (edited ? ' edited' : '') + '" data-prop="' + prop + '">' +
          '<span class="lc-name">' + prop + '</span>' +
          (type === 'color' ? '<input type="color" class="lc-swatch" value="' + toHex(val) + '" aria-label="' + prop + ' color">' : '') +
          '<input type="text" class="lc-input lc-val" spellcheck="false" autocomplete="off" value="' + esc(val) + '"' + (OPTIONS[prop] ? ' list="lc-dl-' + prop + '"' : '') + '>' +
          '<button type="button" class="lc-x" title="Undo this change" aria-label="Undo ' + prop + '">x</button>' +
        '</div>';
      }).join('') + '</fieldset>'
    ).join('');
  }

  function renderGen() {
    const m = cur();
    const gen = generatedCss(m);
    const all = fullCss(m);
    $('#lcGen').textContent = all || '/* No changes yet. Pick an element and edit a value. */';
    $('#lcGen').classList.toggle('muted', !all);
    const kb = (all.length / 1024).toFixed(1);
    $('#lcGenMeta').textContent = all ? kb + ' KB, ' + all.split('\n').length + ' lines' : '';
    $('#lcCopy').disabled = !all;
    $('#lcDownload').disabled = !all;
    $('#lcReset').disabled = !all && !m.selector;
    $('#lcReset span').textContent = m.confirmReset ? 'Click again to confirm' : 'Reset all';
    return gen;
  }

  function renderAll() {
    const m = cur();
    renderBar();
    renderSelector();
    renderProps();
    if (document.activeElement !== $('#lcCustom')) $('#lcCustom').value = m.custom;
    renderGen();
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------
  function adopt(m, data) {
    m.selector = data.selector || '';
    m.count = data.error ? -1 : (data.count || 0);
    m.computed = data.computed || {};
    m.tag = data.tag || '';
  }

  async function selectBySelector(selector) {
    const m = cur();
    if (!selector.trim()) {
      m.selector = ''; m.count = 0; m.computed = {}; m.tag = '';
      renderAll();
      return;
    }
    try {
      const res = await send({ type: 'LC_SELECT', selector: selector.trim(), props: ALL_PROPS });
      adopt(m, res);
      flash('');
    } catch (e) {
      flash(UNSUPPORTED, true);
      return;
    }
    renderSelector();
    renderProps();
  }

  async function nav(dir) {
    const m = cur();
    if (!m.selector) return;
    try {
      const res = await send({ type: 'LC_NAV', dir, props: ALL_PROPS });
      if (res && res.ok) { adopt(m, res); renderSelector(); renderProps(); }
    } catch (e) { flash(UNSUPPORTED, true); }
  }

  async function togglePick() {
    const m = cur();
    try {
      if (m.picking) {
        await send({ type: 'LC_PICK_STOP' });
        m.picking = false;
        renderBar();
        return;
      }
      chrome.tabs.sendMessage((await activeTab()).id, { type: 'EC_STOP' }).catch(() => {});
      await send({ type: 'LC_PICK_START', props: ALL_PROPS });
      m.picking = true;
      flash('');
      renderBar();
    } catch (e) {
      flash(UNSUPPORTED, true);
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || !msg.type || msg.type.indexOf('LC_') !== 0) return;
    const id = sender && sender.tab ? sender.tab.id : state.tabId;
    const m = model(id);
    if (msg.type === 'LC_PICKED') {
      adopt(m, msg.data);
      m.picking = false;
    } else if (msg.type === 'LC_PICK_ENDED') {
      m.picking = false;
    }
    if (id === state.tabId) { renderBar(); renderSelector(); renderProps(); }
  });

  // ---------------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------------
  function setEdit(prop, value, row) {
    const m = cur();
    if (!m.selector) return;
    const v = value.trim();
    const bucket = m.edits[m.selector] || (m.edits[m.selector] = {});
    if (v === '') delete bucket[prop]; else bucket[prop] = v;
    if (!Object.keys(bucket).length) delete m.edits[m.selector];
    if (row) row.classList.toggle('edited', v !== '');
    m.confirmReset = false;
    renderGen();
    push();
  }

  $('#lcProps').addEventListener('input', (e) => {
    const row = e.target.closest('.lc-row');
    if (!row) return;
    const prop = row.dataset.prop;
    const text = $('.lc-val', row);
    if (e.target.classList.contains('lc-swatch')) {
      text.value = e.target.value;
    } else {
      const sw = $('.lc-swatch', row);
      if (sw && /^(#[0-9a-f]{6}|rgba?\()/i.test(text.value)) sw.value = toHex(text.value);
    }
    setEdit(prop, text.value, row);
  });

  $('#lcProps').addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !e.target.classList.contains('lc-val')) return;
    const row = e.target.closest('.lc-row');
    const prop = row.dataset.prop;
    const hit = /(-?\d*\.?\d+)/.exec(e.target.value);
    if (!hit) return;
    e.preventDefault();
    const unit = prop === 'opacity' ? 0.1 : 1;
    const step = e.shiftKey ? unit * 10 : e.altKey ? unit / 10 : unit;
    const next = Math.round((parseFloat(hit[1]) + (e.key === 'ArrowUp' ? step : -step)) * 100) / 100;
    e.target.value = e.target.value.replace(hit[1], String(next));
    setEdit(prop, e.target.value, row);
  });

  $('#lcProps').addEventListener('click', async (e) => {
    const x = e.target.closest('.lc-x');
    if (!x) return;
    const row = x.closest('.lc-row');
    setEdit(row.dataset.prop, '', row);
    await selectBySelector(cur().selector);
  });

  let selTimer = null;
  $('#lcSelector').addEventListener('input', (e) => {
    clearTimeout(selTimer);
    const v = e.target.value;
    selTimer = setTimeout(() => selectBySelector(v), 250);
  });

  $('#lcCustom').addEventListener('input', (e) => {
    const m = cur();
    m.custom = e.target.value;
    m.confirmReset = false;
    renderGen();
    push();
  });

  $('#lcEnabled').addEventListener('change', (e) => {
    cur().enabled = e.target.checked;
    send({ type: 'LC_ENABLE', enabled: e.target.checked }).catch(() => flash(UNSUPPORTED, true));
  });

  $('#lcPick').addEventListener('click', togglePick);
  $('.lc-nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]');
    if (b) nav(b.dataset.nav);
  });

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
    const span = btn.querySelector('span');
    const old = span.textContent;
    span.textContent = 'Copied';
    setTimeout(() => { span.textContent = old; }, 1200);
  }

  $('#lcCopy').addEventListener('click', (e) => copyText(fullCss(cur()), e.currentTarget));

  $('#lcDownload').addEventListener('click', async () => {
    const tab = await activeTab();
    let host = 'page';
    try { host = new URL(tab.url).hostname.replace(/^www\./, ''); } catch (err) { /* keep default */ }
    const blob = new Blob([fullCss(cur()) + '\n'], { type: 'text/css' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = host.replace(/[^a-z0-9.-]+/gi, '-') + '-live-changes.css';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  $('#lcReset').addEventListener('click', async () => {
    const m = cur();
    if (!m.confirmReset) {
      m.confirmReset = true;
      renderGen();
      setTimeout(() => { m.confirmReset = false; renderGen(); }, 3000);
      return;
    }
    m.edits = {};
    m.custom = '';
    m.enabled = true;
    m.selector = '';
    m.count = 0;
    m.computed = {};
    m.tag = '';
    m.confirmReset = false;
    renderAll();
    send({ type: 'LC_CLEAR' }).catch(() => {});
  });

  // ---------------------------------------------------------------------------
  // Mode switch (Collector / Live CSS)
  // ---------------------------------------------------------------------------
  async function syncFromPage() {
    const tab = await activeTab();
    if (!tab || !tab.id) return;
    state.tabId = tab.id;
    const m = cur();
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'LC_STATE' });
      if (res && res.ok) {
        m.enabled = res.enabled;
        if (res.css && !m.custom && !Object.keys(m.edits).length) m.custom = res.css;
      }
    } catch (e) { /* content script is not on this page yet */ }
    renderAll();
  }

  function setMode(mode) {
    state.mode = mode;
    $('#view').hidden = mode !== 'collect';
    $('#liveView').hidden = mode !== 'live';
    $('.top-actions').hidden = mode !== 'collect';
    document.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    activeTab().then((tab) => {
      if (!tab || !tab.id) return;
      if (mode === 'live') {
        chrome.tabs.sendMessage(tab.id, { type: 'EC_STOP' }).catch(() => {});
        syncFromPage();
      } else {
        chrome.tabs.sendMessage(tab.id, { type: 'LC_PICK_STOP' }).catch(() => {});
        cur().picking = false;
        renderBar();
      }
    });
  }

  $('.modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b && b.dataset.mode !== state.mode) setMode(b.dataset.mode);
  });

  chrome.tabs.onActivated.addListener(() => { if (state.mode === 'live') syncFromPage(); });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== 'loading' || !models.has(tabId)) return;
    models.delete(tabId);
    if (tabId === state.tabId) renderAll();
  });

  renderAll();
})();
