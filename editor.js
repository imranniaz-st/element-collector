// Element Collector - visual editor
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ECX = window.ECX;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const uid = () => Math.random().toString(36).slice(2, 9);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const bpOf = (w) => (w <= 480 ? 'mobile' : w <= 900 ? 'tablet' : 'desktop');

  const S = {
    frames: [], sel: null, zoom: 1, px: 80, py: 100,
    items: [], undo: [], redo: [], clip: null,
    preview: false, pstate: '', ltab: 'collected', undoArmed: false
  };
  const R = {}; // runtime per frame: { el, iframe, doc, win, sel, hov, drop, lbl }
  const F = (id) => S.frames.find((f) => f.id === id);
  const curFrame = () => (S.sel ? F(S.sel.fid) : null) || null;
  const targetFrame = () => curFrame() || S.frames[S.frames.length - 1] || null;
  const world = $('#world');
  const viewport = $('#viewport');

  const CONTAINERS = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'ul', 'ol', 'li', 'form', 'figure', 'body', 'a', 'button', 'span', 'label', 'td', 'th', 'blockquote']);

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------
  let toastT = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, 2800);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  let saveT = null;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      chrome.storage.local.set({ project: { frames: S.frames, px: S.px, py: S.py, zoom: S.zoom } }).catch(() => {});
    }, 300);
  }

  async function init() {
    const d = await chrome.storage.local.get(['project', 'items', 'pendingAdd']);
    S.items = d.items || [];
    if (d.project && d.project.frames) {
      S.frames = d.project.frames.map(normalizeFrame);
      S.px = d.project.px != null ? d.project.px : S.px;
      S.py = d.project.py != null ? d.project.py : S.py;
      S.zoom = d.project.zoom || 1;
    }
    S.frames.forEach(mountFrame);
    applyView();
    if (d.pendingAdd) { consumePending(d.pendingAdd.id); }
    else if (S.frames.length) setTimeout(fitAll, 400);
    renderLeft();
    renderProps();
    syncToolbar();
    chrome.tabs.getCurrent((t) => { if (t) chrome.storage.local.set({ editorTab: { id: t.id, windowId: t.windowId } }); });
    chrome.storage.local.set({ editorAlive: Date.now() });
    setInterval(() => chrome.storage.local.set({ editorAlive: Date.now() }).catch(() => {}), 2000);
  }

  function normalizeFrame(f) {
    return Object.assign({ id: uid(), name: 'Frame', x: 0, y: 0, w: 640, h: 200, html: '', css: '', responsive: '', edits: {}, bg: '', next: 1000 }, f);
  }

  function consumePending(id) {
    const it = S.items.find((i) => i.id === id);
    chrome.storage.local.remove('pendingAdd').catch(() => {});
    if (it) addItem(it);
  }

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.items) { S.items = ch.items.newValue || []; if (S.ltab === 'collected') renderLeft(); }
    if (ch.pendingAdd && ch.pendingAdd.newValue) consumePending(ch.pendingAdd.newValue.id);
  });

  // ---------------------------------------------------------------------------
  // Frames
  // ---------------------------------------------------------------------------
  function prep(html) {
    const t = document.createElement('template');
    t.innerHTML = html || '';
    let n = 0;
    t.content.querySelectorAll('*').forEach((e) => e.setAttribute('data-eid', ++n));
    return { html: t.innerHTML, next: n + 1 };
  }

  function freePos() {
    let x = 0;
    S.frames.forEach((f) => { x = Math.max(x, f.x + f.w + 120); });
    return x;
  }

  function addItem(item) {
    const p = prep(item.html);
    const f = normalizeFrame({ name: item.name || 'Element', itemId: item.id, x: freePos(), y: 0, w: 640, html: p.html, next: p.next, css: item.css || '', responsive: item.responsive || '' });
    S.frames.push(f);
    mountFrame(f);
    select(f.id, null);
    setTimeout(() => focusFrame(f), 150);
    save();
  }

  function addBlank() {
    const css = { padding: '32px', 'min-height': '320px', display: 'flex', 'flex-direction': 'column', gap: '16px', background: '#ffffff' };
    const f = normalizeFrame({ name: 'Blank frame', x: freePos(), y: 0, w: 1280, html: '<main data-eid="1"></main>', next: 2, edits: { 1: { desktop: css } } });
    S.frames.push(f);
    mountFrame(f);
    select(f.id, 1);
    setTimeout(() => focusFrame(f), 150);
    save();
  }

  function frameDoc(f) {
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>html,body{margin:0}body{min-height:20px}a{cursor:default}</style>' +
      '<style id="ec-base">' + (f.bg ? 'body{background:' + f.bg + '}' : '') + '</style>' +
      '<style>' + f.css + '</style><style>' + f.responsive + '</style>' +
      '<style id="ec-edits">' + ECX.editsCss(f, 'live') + '</style></head><body>' + f.html + '</body></html>';
  }

  function mountFrame(f) {
    const el = document.createElement('div');
    el.className = 'frame';
    el.dataset.fid = f.id;
    el.innerHTML =
      '<div class="fhead"><span class="fname"></span><span class="fsize"></span><span class="fbtns">' +
      '<button data-fa="dup" title="Duplicate frame">&#10064;</button><button data-fa="del" title="Delete frame">&#10005;</button></span></div>' +
      '<div class="fbody"><iframe sandbox="allow-same-origin" title="frame"></iframe>' +
      '<div class="ov"><div class="hov"></div><div class="selbox">' +
      ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => '<i class="h" data-d="' + d + '"></i>').join('') +
      '<span class="sizelbl"></span></div><div class="drop"></div></div>' +
      '<div class="fresize" title="Drag to change width"></div></div>';
    world.appendChild(el);
    const r = {
      el, iframe: $('iframe', el), sel: $('.selbox', el), hov: $('.hov', el), drop: $('.drop', el), lbl: $('.sizelbl', el), doc: null, win: null
    };
    R[f.id] = r;
    posFrame(f);
    r.iframe.style.width = f.w + 'px';
    r.iframe.style.height = f.h + 'px';
    r.iframe.addEventListener('load', () => {
      const cd = r.iframe.contentDocument;
      if (!cd || !cd.getElementById('ec-edits')) return; // ignore the initial blank document
      r.doc = cd;
      r.win = r.iframe.contentWindow;
      attachDoc(f, r);
      fit(f);
      if (S.sel && S.sel.fid === f.id) { updOv(f.id); renderProps(); }
      if (S.ltab === 'layers') renderLeft();
      setTimeout(() => fit(f), 300);
      setTimeout(() => fit(f), 1200);
    });
    r.iframe.srcdoc = frameDoc(f);
    $('#emptyCanvas').style.display = 'none';
    wireFrame(f, r);
  }

  function posFrame(f) {
    const r = R[f.id];
    r.el.style.left = f.x + 'px';
    r.el.style.top = f.y + 'px';
    $('.fname', r.el).textContent = f.name;
    $('.fsize', r.el).textContent = Math.round(f.w) + ' \u00d7 ' + Math.round(f.h);
  }

  function fit(f) {
    const r = R[f.id];
    if (!r || !r.doc || !r.doc.documentElement) return;
    r.iframe.style.width = f.w + 'px';
    r.iframe.style.height = '10px';
    f.h = Math.max(80, r.doc.documentElement.scrollHeight);
    r.iframe.style.height = f.h + 'px';
    posFrame(f);
    updOv(f.id);
  }

  function removeFrame(id) {
    const r = R[id];
    if (r) r.el.remove();
    delete R[id];
    S.frames = S.frames.filter((f) => f.id !== id);
    if (S.sel && S.sel.fid === id) S.sel = null;
    if (!S.frames.length) $('#emptyCanvas').style.display = '';
    renderLeft(); renderProps(); syncToolbar(); save();
  }

  function dupFrame(f) {
    const c = JSON.parse(JSON.stringify(f));
    c.id = uid(); c.x = f.x + f.w + 100; c.name = f.name + ' copy';
    S.frames.push(c);
    mountFrame(c);
    select(c.id, null);
    save();
  }

  function wireFrame(f, r) {
    r.el.addEventListener('pointerdown', (e) => {
      const fa = e.target.closest('[data-fa]');
      if (fa) {
        e.stopPropagation();
        if (fa.dataset.fa === 'del') removeFrame(f.id);
        else dupFrame(f);
        return;
      }
      if (e.target.closest('.fresize')) { e.stopPropagation(); startWidthResize(f, e); return; }
      if (e.target.closest('.h')) { e.stopPropagation(); startHandle(f, e); return; }
      if (e.target.closest('.fhead')) { e.stopPropagation(); select(f.id, null); startMove(f, e); }
    });
    $('.fname', r.el).addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const n = prompt('Frame name', f.name);
      if (n) { f.name = n; posFrame(f); renderProps(); save(); }
    });
  }

  function startMove(f, e) {
    const sx = e.clientX, sy = e.clientY, ox = f.x, oy = f.y;
    world.classList.add('dragging');
    const mv = (ev) => { f.x = Math.round(ox + (ev.clientX - sx) / S.zoom); f.y = Math.round(oy + (ev.clientY - sy) / S.zoom); posFrame(f); };
    const up = () => { window.removeEventListener('pointermove', mv); world.classList.remove('dragging'); save(); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up, { once: true });
  }

  function setFrameWidth(f, w) {
    f.w = clamp(Math.round(w), 200, 3000);
    fit(f);
    syncToolbar();
  }

  function startWidthResize(f, e) {
    pushUndoFor(f);
    const sx = e.clientX, ow = f.w;
    world.classList.add('dragging');
    const mv = (ev) => {
      let w = ow + (ev.clientX - sx) / S.zoom;
      [375, 768, 1280].forEach((p) => { if (Math.abs(w - p) < 10) w = p; });
      setFrameWidth(f, w);
    };
    const up = () => { window.removeEventListener('pointermove', mv); world.classList.remove('dragging'); renderProps(); save(); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up, { once: true });
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------
  const snapshot = (f) => JSON.stringify({ html: f.html, edits: f.edits, w: f.w, bg: f.bg, name: f.name });
  function pushUndoFor(f) {
    S.undo.push({ fid: f.id, s: snapshot(f) });
    if (S.undo.length > 150) S.undo.shift();
    S.redo = [];
    syncToolbar();
  }
  function pushUndo() { const f = curFrame(); if (f) pushUndoFor(f); }
  function armUndo() { if (!S.undoArmed) { pushUndo(); S.undoArmed = true; } }

  function restore(f, s) {
    const o = JSON.parse(s);
    Object.assign(f, o);
    const r = R[f.id];
    if (!r || !r.doc) return;
    r.doc.body.innerHTML = f.html;
    applyEdits(f);
    $('#ec-base', r.doc).textContent = f.bg ? 'body{background:' + f.bg + '}' : '';
    fit(f);
    renderLeft(); renderProps(); syncToolbar(); save();
  }
  function undo() {
    const e = S.undo.pop();
    if (!e) return;
    const f = F(e.fid);
    if (!f) return;
    S.redo.push({ fid: f.id, s: snapshot(f) });
    restore(f, e.s);
  }
  function redo() {
    const e = S.redo.pop();
    if (!e) return;
    const f = F(e.fid);
    if (!f) return;
    S.undo.push({ fid: f.id, s: snapshot(f) });
    restore(f, e.s);
  }

  // ---------------------------------------------------------------------------
  // Edits (style overrides per breakpoint / state) and DOM sync
  // ---------------------------------------------------------------------------
  function editKey(f) { return bpOf(f.w) + (S.pstate ? ':' + S.pstate : ''); }

  function setEditKey(f, eid, key, prop, val) {
    const m = (f.edits[eid] = f.edits[eid] || {});
    const d = (m[key] = m[key] || {});
    if (val === '' || val == null) delete d[prop]; else d[prop] = val;
    if (!Object.keys(d).length) delete m[key];
    if (!Object.keys(m).length) delete f.edits[eid];
  }
  function setEdit(f, eid, prop, val) { setEditKey(f, eid, editKey(f), prop, val); applyEdits(f); }
  function applyEdits(f) {
    const r = R[f.id];
    if (!r || !r.doc) return;
    $('#ec-edits', r.doc).textContent = ECX.editsCss(f, 'live');
  }

  function elOf(f, eid) {
    const r = R[f.id];
    return r && r.doc ? r.doc.querySelector('[data-eid="' + eid + '"]') : null;
  }
  function selEl() {
    const f = curFrame();
    return f && S.sel.eid ? elOf(f, S.sel.eid) : null;
  }

  function ensureEids(f) {
    const r = R[f.id];
    r.doc.body.querySelectorAll('*').forEach((e) => { if (!e.hasAttribute('data-eid')) e.setAttribute('data-eid', f.next++); });
  }

  function syncHtml(f) {
    const b = R[f.id].doc.body.cloneNode(true);
    b.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'));
    return b.innerHTML;
  }

  function commitDom(f) {
    ensureEids(f);
    f.html = syncHtml(f);
    const present = new Set(Array.from(R[f.id].doc.body.querySelectorAll('[data-eid]')).map((e) => e.getAttribute('data-eid')));
    Object.keys(f.edits).forEach((k) => { if (!present.has(k)) delete f.edits[k]; });
    applyEdits(f);
    fit(f);
    if (S.ltab === 'layers') renderLeft();
    save();
  }

  // ---------------------------------------------------------------------------
  // Selection & overlay
  // ---------------------------------------------------------------------------
  function label(el) {
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/)[0];
    return el.localName + (cls ? '.' + cls : '');
  }

  function select(fid, eid) {
    S.sel = { fid, eid: eid ? String(eid) : null };
    S.undoArmed = false;
    $$('.frame').forEach((n) => n.classList.toggle('on', n.dataset.fid === fid));
    S.frames.forEach((f) => updOv(f.id));
    renderProps();
    if (S.ltab === 'layers') renderLeft();
    syncToolbar();
  }

  function updOv(fid) {
    const r = R[fid];
    if (!r || !r.doc) return;
    const el = S.sel && S.sel.fid === fid && S.sel.eid ? elOf(F(fid), S.sel.eid) : null;
    if (!el || S.preview) { r.sel.style.display = 'none'; return; }
    const b = el.getBoundingClientRect();
    r.sel.style.cssText = 'display:block;left:' + b.left + 'px;top:' + b.top + 'px;width:' + b.width + 'px;height:' + b.height + 'px';
    r.lbl.textContent = Math.round(b.width) + ' \u00d7 ' + Math.round(b.height);
  }

  function showHover(fid, el) {
    S.frames.forEach((f) => { const r = R[f.id]; if (r) r.hov.style.display = 'none'; });
    const r = R[fid];
    if (!r || !el || S.preview) return;
    const b = el.getBoundingClientRect();
    r.hov.style.cssText = 'display:block;left:' + b.left + 'px;top:' + b.top + 'px;width:' + b.width + 'px;height:' + b.height + 'px';
  }

  // ---------------------------------------------------------------------------
  // Events inside each frame's document
  // ---------------------------------------------------------------------------
  let drag = null;

  function attachDoc(f, r) {
    const doc = r.doc;
    const eidOf = (n) => { const e = n && n.closest ? n.closest('[data-eid]') : null; return e && e !== doc.body ? e : null; };
    const editing = () => doc.activeElement && doc.activeElement.isContentEditable;

    doc.addEventListener('mousemove', (e) => { if (!drag) showHover(f.id, eidOf(e.target)); });
    doc.addEventListener('mouseleave', () => showHover(f.id, null));
    doc.addEventListener('click', (e) => {
      if (S.preview) { if (e.target.closest('a')) e.preventDefault(); return; }
      if (editing() && doc.activeElement.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    doc.addEventListener('dragstart', (e) => e.preventDefault());
    doc.addEventListener('selectstart', (e) => { if (!editing() && !S.preview) e.preventDefault(); });
    doc.addEventListener('dblclick', (e) => {
      if (S.preview) return;
      const el = eidOf(e.target);
      if (el) startTextEdit(f, el);
    });
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('paste', (e) => {
      if (!editing()) return;
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData).getData('text/plain');
      doc.execCommand('insertText', false, t);
    });
    doc.addEventListener('wheel', (e) => {
      e.preventDefault();
      const ib = r.iframe.getBoundingClientRect();
      const vb = viewport.getBoundingClientRect();
      onWheel(e, ib.left + e.clientX * S.zoom - vb.left, ib.top + e.clientY * S.zoom - vb.top);
    }, { passive: false });

    doc.addEventListener('pointerdown', (e) => {
      if (S.preview || e.button !== 0 || editing()) return;
      const el = eidOf(e.target);
      if (!el) { select(f.id, null); return; }
      const sameSel = S.sel && S.sel.fid === f.id && S.sel.eid === el.getAttribute('data-eid');
      if (!sameSel) select(f.id, el.getAttribute('data-eid'));
      drag = { f, r, el, x0: e.clientX, y0: e.clientY, started: false, alt: e.altKey, target: null };
      try { doc.documentElement.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    doc.addEventListener('pointermove', (e) => { if (drag && drag.r === r) dragMove(e); });
    doc.addEventListener('pointerup', () => { if (drag && drag.r === r) dragEnd(); });
    doc.addEventListener('pointercancel', () => { if (drag && drag.r === r) dragEnd(true); });
  }

  function dragMove(e) {
    const d = drag;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.started) {
      if (Math.hypot(dx, dy) < 5) return;
      d.started = true;
      pushUndoFor(d.f);
      if (d.alt) {
        const cs = d.r.win.getComputedStyle(d.el);
        d.pos = cs.position;
        d.l0 = parseFloat(cs.left) || 0;
        d.t0 = parseFloat(cs.top) || 0;
        if (cs.position === 'static') setEdit(d.f, d.el.getAttribute('data-eid'), 'position', 'relative');
      }
    }
    const eid = d.el.getAttribute('data-eid');
    if (d.alt) {
      setEdit(d.f, eid, 'left', Math.round(d.l0 + dx) + 'px');
      setEdit(d.f, eid, 'top', Math.round(d.t0 + dy) + 'px');
      updOv(d.f.id);
      return;
    }
    const doc = d.r.doc;
    const t = doc.elementFromPoint(e.clientX, e.clientY);
    const te = t && t.closest ? t.closest('[data-eid]') : null;
    const drop = d.r.drop;
    d.target = null;
    drop.style.display = 'none';
    if (!te || te === d.el || d.el.contains(te)) return;
    const b = te.getBoundingClientRect();
    const fx = (e.clientX - b.left) / (b.width || 1);
    const fy = (e.clientY - b.top) / (b.height || 1);
    const inside = (te === doc.body || (CONTAINERS.has(te.localName) && fx > 0.2 && fx < 0.8 && fy > 0.25 && fy < 0.75 && te.localName !== 'a' && te.localName !== 'button' && te.localName !== 'span'));
    const pcs = te.parentElement ? d.r.win.getComputedStyle(te.parentElement) : null;
    const horiz = pcs && (pcs.display.indexOf('flex') >= 0 && pcs.flexDirection.indexOf('row') === 0);
    if (inside) {
      d.target = { el: te, mode: 'inside' };
      drop.style.cssText = 'display:block;left:' + b.left + 'px;top:' + b.top + 'px;width:' + b.width + 'px;height:' + b.height + 'px;background:rgba(13,153,255,.15);outline:2px solid #0d99ff';
    } else {
      const after = horiz ? fx > 0.5 : fy > 0.5;
      d.target = { el: te, mode: after ? 'after' : 'before' };
      const th = 3 / S.zoom;
      drop.style.cssText = horiz
        ? 'display:block;left:' + (after ? b.right : b.left) + 'px;top:' + b.top + 'px;width:' + th + 'px;height:' + b.height + 'px;background:#0d99ff'
        : 'display:block;left:' + b.left + 'px;top:' + (after ? b.bottom : b.top) + 'px;width:' + b.width + 'px;height:' + th + 'px;background:#0d99ff';
    }
  }

  function dragEnd(cancel) {
    const d = drag;
    drag = null;
    if (!d) return;
    d.r.drop.style.display = 'none';
    if (!d.started) return;
    if (!cancel && d.target) {
      const t = d.target;
      if (t.mode === 'inside') t.el.appendChild(d.el);
      else if (t.mode === 'after') t.el.after(d.el);
      else t.el.before(d.el);
    }
    commitDom(d.f);
    updOv(d.f.id);
    renderProps();
  }

  // Inline text editing
  function startTextEdit(f, el) {
    const r = R[f.id];
    pushUndoFor(f);
    select(f.id, el.getAttribute('data-eid'));
    el.contentEditable = 'true';
    el.focus();
    const rng = r.doc.createRange();
    rng.selectNodeContents(el);
    const s = r.win.getSelection();
    s.removeAllRanges();
    s.addRange(rng);
    const done = () => {
      el.removeEventListener('blur', done);
      el.removeAttribute('contenteditable');
      commitDom(f);
      renderProps();
    };
    el.addEventListener('blur', done);
  }

  // Resize handles
  function startHandle(f, e) {
    const el = selEl();
    if (!el) return;
    const d = e.target.dataset.d;
    const r = R[f.id];
    const b0 = el.getBoundingClientRect();
    const w0 = b0.width, h0 = b0.height;
    const eid = S.sel.eid;
    const sx = e.clientX, sy = e.clientY;
    pushUndoFor(f);
    if (r.win.getComputedStyle(el).display === 'inline') setEdit(f, eid, 'display', 'inline-block');
    world.classList.add('dragging');
    const mv = (ev) => {
      const dx = (ev.clientX - sx) / S.zoom, dy = (ev.clientY - sy) / S.zoom;
      let w = w0, h = h0;
      if (d.indexOf('e') >= 0) w = w0 + dx;
      if (d.indexOf('w') >= 0) w = w0 - dx;
      if (d.indexOf('s') >= 0) h = h0 + dy;
      if (d.indexOf('n') >= 0) h = h0 - dy;
      if (ev.shiftKey && d.length === 2) h = (w / w0) * h0;
      if (d !== 'n' && d !== 's') setEdit(f, eid, 'width', Math.max(4, Math.round(w)) + 'px');
      if (d !== 'e' && d !== 'w') setEdit(f, eid, 'height', Math.max(4, Math.round(h)) + 'px');
      fit(f);
    };
    const up = () => { window.removeEventListener('pointermove', mv); world.classList.remove('dragging'); commitDom(f); renderProps(); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up, { once: true });
  }

  // ---------------------------------------------------------------------------
  // Element operations
  // ---------------------------------------------------------------------------
  function cloneEl(f, el) {
    const c = el.cloneNode(true);
    [c].concat(Array.from(c.querySelectorAll('[data-eid]'))).forEach((n) => {
      const old = n.getAttribute('data-eid');
      if (!old) return;
      const nw = f.next++;
      n.setAttribute('data-eid', nw);
      if (f.edits[old]) f.edits[nw] = JSON.parse(JSON.stringify(f.edits[old]));
    });
    return c;
  }

  function dupSel() {
    const f = curFrame(); const el = selEl();
    if (!f || !el) return;
    pushUndoFor(f);
    const c = cloneEl(f, el);
    el.after(c);
    commitDom(f);
    select(f.id, c.getAttribute('data-eid'));
  }

  function delSel() {
    const f = curFrame(); const el = selEl();
    if (!f || !el) return;
    pushUndoFor(f);
    el.remove();
    commitDom(f);
    select(f.id, null);
  }

  function copySel() {
    const f = curFrame(); const el = selEl();
    if (!f || !el) return;
    const edits = {};
    [el].concat(Array.from(el.querySelectorAll('[data-eid]'))).forEach((n) => {
      const id = n.getAttribute('data-eid');
      if (f.edits[id]) edits[id] = f.edits[id];
    });
    S.clip = { html: el.outerHTML, edits: JSON.parse(JSON.stringify(edits)) };
    toast('Copied');
  }

  function pasteClip() {
    const f = targetFrame();
    if (!f || !S.clip) return;
    pushUndoFor(f);
    const t = document.createElement('template');
    t.innerHTML = S.clip.html;
    const node = t.content.firstElementChild;
    [node].concat(Array.from(node.querySelectorAll('[data-eid]'))).forEach((n) => {
      const old = n.getAttribute('data-eid');
      const nw = f.next++;
      n.setAttribute('data-eid', nw);
      if (S.clip.edits[old]) f.edits[nw] = JSON.parse(JSON.stringify(S.clip.edits[old]));
    });
    insertEl(f, R[f.id].doc.importNode(node, true));
    commitDom(f);
    select(f.id, node.getAttribute('data-eid'));
  }

  function moveSel(dir) {
    const f = curFrame(); const el = selEl();
    if (!f || !el) return;
    const sib = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    if (!sib) return;
    pushUndoFor(f);
    if (dir < 0) sib.before(el); else sib.after(el);
    commitDom(f);
    updOv(f.id);
  }

  function wrapSel() {
    const f = curFrame(); const el = selEl();
    if (!f || !el) return;
    pushUndoFor(f);
    const w = build(f, { t: 'div', c: css('display:flex;flex-direction:column;gap:8px') });
    el.before(w);
    w.appendChild(el);
    commitDom(f);
    select(f.id, w.getAttribute('data-eid'));
  }

  function selectParent() {
    const f = curFrame(); const el = selEl();
    if (!f || !el) return;
    const p = el.parentElement;
    if (p && p.hasAttribute('data-eid')) select(f.id, p.getAttribute('data-eid'));
  }
  function selectChild() {
    const f = curFrame(); const el = selEl();
    if (!f || !el) return;
    const c = Array.from(el.children).find((x) => x.hasAttribute('data-eid'));
    if (c) select(f.id, c.getAttribute('data-eid'));
  }

  function resetEl() {
    const f = curFrame();
    if (!f || !S.sel.eid) return;
    pushUndoFor(f);
    delete f.edits[S.sel.eid];
    applyEdits(f);
    fit(f);
    renderProps();
    save();
  }

  // Build new elements from specs
  function css(str) {
    const o = {};
    str.split(';').forEach((d) => { const i = d.indexOf(':'); if (i > 0) o[d.slice(0, i).trim()] = d.slice(i + 1).trim(); });
    return o;
  }
  function build(f, spec) {
    const doc = R[f.id].doc;
    const el = doc.createElement(spec.t);
    const id = f.next++;
    el.setAttribute('data-eid', id);
    if (spec.x != null) el.textContent = spec.x;
    Object.entries(spec.a || {}).forEach(([k, v]) => el.setAttribute(k, v));
    Object.entries(spec.c || {}).forEach(([k, v]) => setEditKey(f, id, 'desktop', k, v));
    (spec.k || []).forEach((k) => el.appendChild(build(f, k)));
    return el;
  }
  function insertEl(f, el) {
    const doc = R[f.id].doc;
    const sel = S.sel && S.sel.fid === f.id && S.sel.eid ? elOf(f, S.sel.eid) : null;
    if (!sel || sel === doc.body) doc.body.appendChild(el);
    else if (CONTAINERS.has(sel.localName) && sel.localName !== 'a' && sel.localName !== 'button' && sel.localName !== 'span' && sel.localName !== 'label') sel.appendChild(el);
    else sel.after(el);
  }

  const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240"><rect width="400" height="240" fill="#e5e7eb"/><path d="M150 150l35-45 30 36 20-24 45 57H150z" fill="#9ca3af"/><circle cx="160" cy="90" r="16" fill="#9ca3af"/></svg>');
  const BTN = 'padding:10px 18px;background:#4f46e5;color:#ffffff;border:0;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer';
  const KINDS = {
    container: { t: 'div', c: css('padding:16px;display:flex;flex-direction:column;gap:12px') },
    row: { t: 'div', c: css('display:flex;flex-direction:row;gap:12px;align-items:center') },
    grid: { t: 'div', c: css('display:grid;grid-template-columns:repeat(3,1fr);gap:16px'), k: [1, 2, 3].map((n) => ({ t: 'div', x: 'Item ' + n, c: css('padding:24px;background:#f3f4f6;border-radius:8px') })) },
    heading: { t: 'h2', x: 'Heading', c: css('margin:0;font-size:28px;font-weight:700;line-height:1.2') },
    text: { t: 'p', x: 'Write something here.', c: css('margin:0;font-size:16px;line-height:1.5') },
    button: { t: 'button', x: 'Button', c: css(BTN) },
    link: { t: 'a', x: 'Link', a: { href: '#' }, c: css('color:#4f46e5;text-decoration:underline') },
    image: { t: 'img', a: { src: PLACEHOLDER, alt: '' }, c: css('width:240px;height:150px;object-fit:cover;border-radius:8px') },
    input: { t: 'input', a: { placeholder: 'Type here' }, c: css('padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px') },
    divider: { t: 'hr', c: css('border:0;border-top:1px solid #e5e7eb;width:100%;margin:8px 0') },
    card: { t: 'div', c: css('padding:20px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,.1);display:flex;flex-direction:column;gap:8px;max-width:320px'), k: [
      { t: 'h3', x: 'Card title', c: css('margin:0;font-size:18px') },
      { t: 'p', x: 'Short description of the card goes here.', c: css('margin:0;color:#6b7280;font-size:14px') },
      { t: 'button', x: 'Learn more', c: css(BTN + ';align-self:flex-start') }] },
    navbar: { t: 'header', c: css('display:flex;align-items:center;justify-content:space-between;padding:16px 32px;background:#ffffff;border-bottom:1px solid #e5e7eb'), k: [
      { t: 'strong', x: 'Brand', c: css('font-size:18px') },
      { t: 'nav', c: css('display:flex;gap:20px'), k: ['Home', 'About', 'Pricing'].map((x) => ({ t: 'a', x, a: { href: '#' }, c: css('color:#374151;text-decoration:none;font-size:14px') })) },
      { t: 'button', x: 'Sign up', c: css(BTN) }] },
    hero: { t: 'section', c: css('display:flex;flex-direction:column;align-items:center;text-align:center;gap:16px;padding:80px 24px;background:linear-gradient(135deg,#eef2ff,#ffffff)'), k: [
      { t: 'h1', x: 'Build something people love', c: css('margin:0;font-size:48px;line-height:1.1;max-width:720px') },
      { t: 'p', x: 'A short supporting sentence that explains the value in plain words.', c: css('margin:0;font-size:18px;color:#4b5563;max-width:560px') },
      { t: 'button', x: 'Get started', c: css(BTN + ';padding:14px 28px;font-size:16px') }] }
  };

  function insertKind(kind) {
    if (!S.frames.length) addBlank();
    const f = targetFrame();
    if (!f || !R[f.id].doc) return;
    pushUndoFor(f);
    const el = build(f, KINDS[kind]);
    insertEl(f, el);
    commitDom(f);
    select(f.id, el.getAttribute('data-eid'));
  }

  // ---------------------------------------------------------------------------
  // Properties panel
  // ---------------------------------------------------------------------------
  const FONTS = ['system-ui, sans-serif', 'Arial, Helvetica, sans-serif', 'Georgia, serif', '"Times New Roman", serif', '"Courier New", monospace', 'Inter, system-ui, sans-serif', 'Roboto, system-ui, sans-serif', '"Helvetica Neue", Arial, sans-serif'];
  const UNITLESS = new Set(['opacity', 'z-index', 'flex-grow', 'flex-shrink', 'order', 'line-height', 'font-weight', 'flex']);
  const SHADOWS = { none: 'none', sm: '0 1px 2px rgba(0,0,0,.12)', md: '0 4px 6px rgba(0,0,0,.12)', lg: '0 10px 20px rgba(0,0,0,.18)', xl: '0 20px 40px rgba(0,0,0,.25)', inner: 'inset 0 2px 4px rgba(0,0,0,.2)' };

  function toHex(c) {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return /^#[0-9a-f]{6}$/i.test(c) ? c : '#000000';
    const p = m[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map((n) => clamp(Math.round(parseFloat(n)), 0, 255));
    return '#' + p.map((n) => n.toString(16).padStart(2, '0')).join('');
  }

  const fText = (cs, p, l) => '<label class="fld"><span>' + l + '</span><input type="text" data-p="' + p + '" value="' + esc(cs.getPropertyValue(p)) + '"></label>';
  const fSel = (cs, p, l, opts) => {
    const v = cs.getPropertyValue(p);
    const list = opts.indexOf(v) >= 0 ? opts : [v].concat(opts);
    return '<label class="fld"><span>' + l + '</span><select data-p="' + p + '">' + list.map((o) => '<option' + (o === v ? ' selected' : '') + ' value="' + esc(o) + '">' + esc(o) + '</option>').join('') + '</select></label>';
  };
  const fClr = (cs, p, l) => {
    const v = cs.getPropertyValue(p);
    return '<label class="fld"><span>' + l + '</span><span class="clr"><input type="color" data-p="' + p + '" value="' + toHex(v) + '"><input type="text" data-p="' + p + '" value="' + esc(v) + '"></span></label>';
  };
  const fBox = (cs, name, prefix) => '<div class="b4"><span>' + name + '</span>' +
    ['top', 'right', 'bottom', 'left'].map((s) => '<input type="text" data-p="' + prefix + '-' + s + '" value="' + esc(cs.getPropertyValue(prefix + '-' + s)) + '" title="' + prefix + '-' + s + '">').join('') + '</div>';
  const sec = (title, body, open) => '<details class="sec"' + (open ? ' open' : '') + '><summary>' + title + '</summary>' + body + '</details>';

  function renderProps() {
    const host = $('#props');
    const f = curFrame();
    if (!f || !R[f.id] || !R[f.id].doc) {
      host.innerHTML = '<div class="sec"><h4>Nothing selected</h4><p class="hint">Click a frame header or an element on the canvas.</p></div>' + helpHtml();
      return;
    }
    const el = selEl();
    if (!el) { host.innerHTML = frameProps(f) + helpHtml(); return; }

    const win = R[f.id].win;
    const cs = win.getComputedStyle(el);
    const tag = el.localName;
    const hasKids = Array.from(el.children).length > 0;
    const bp = bpOf(f.w);
    const stateSeg = '<div class="segs" id="pstate">' + [['', 'Default'], ['hover', 'Hover'], ['focus', 'Focus'], ['active', 'Active']].map(([v, l]) => '<button data-ps="' + v + '" class="' + (S.pstate === v ? 'on' : '') + '">' + l + '</button>').join('') + '</div>';

    let h = '<div class="top"><div class="crumb">' + esc(label(el)) + '</div>' +
      '<div class="acts">' +
      '<button class="btn" data-act="parent" title="Shift+Enter">&uarr; Parent</button>' +
      '<button class="btn" data-act="up" title="Move before previous">&#8593; Move</button>' +
      '<button class="btn" data-act="down" title="Move after next">&#8595; Move</button>' +
      '<button class="btn" data-act="dup" title="Ctrl+D">Duplicate</button>' +
      '<button class="btn" data-act="wrap">Wrap</button>' +
      '<button class="btn" data-act="reset" title="Remove all overrides on this element">Reset</button>' +
      '<button class="btn danger" data-act="del" title="Delete">Delete</button></div></div>';
    h += '<div class="sec"><h4>Editing for: ' + bp + (S.pstate ? ' / ' + S.pstate : '') + '</h4>' + stateSeg +
      '<p class="note" style="margin:-4px 0 0">Changes apply at this frame width and below. Resize the frame to ' + (bp === 'desktop' ? 'tablet or mobile' : 'desktop') + ' to edit another size.</p></div>';

    // Content
    let content = '';
    if (!hasKids && !['img', 'input', 'hr', 'br'].includes(tag)) content += '<label class="fld" style="grid-template-columns:1fr"><textarea data-txt="1">' + esc(el.textContent) + '</textarea></label>';
    if (tag === 'img') content += '<label class="fld"><span>Image URL</span><input type="text" data-a="src" value="' + esc(el.getAttribute('src') && el.getAttribute('src').length < 200 ? el.getAttribute('src') : '') + '"></label><label class="fld"><span>Alt</span><input type="text" data-a="alt" value="' + esc(el.getAttribute('alt')) + '"></label>';
    if (tag === 'a') content += '<label class="fld"><span>Link</span><input type="text" data-a="href" value="' + esc(el.getAttribute('href')) + '"></label>';
    if (tag === 'input' || tag === 'textarea') content += '<label class="fld"><span>Placeholder</span><input type="text" data-a="placeholder" value="' + esc(el.getAttribute('placeholder')) + '"></label>';
    if (content) h += sec('Content', content, true);

    h += sec('Layout',
      fSel(cs, 'display', 'Display', ['block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'none']) +
      fSel(cs, 'flex-direction', 'Direction', ['row', 'column', 'row-reverse', 'column-reverse']) +
      fSel(cs, 'flex-wrap', 'Wrap', ['nowrap', 'wrap']) +
      fSel(cs, 'justify-content', 'Justify', ['normal', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']) +
      fSel(cs, 'align-items', 'Align', ['normal', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline']) +
      fText(cs, 'gap', 'Gap') + fText(cs, 'grid-template-columns', 'Grid columns') +
      fText(cs, 'flex-grow', 'Grow') + fSel(cs, 'align-self', 'Align self', ['auto', 'flex-start', 'center', 'flex-end', 'stretch']), true);

    h += sec('Size',
      fText(cs, 'width', 'Width') +
      '<div class="quick"><button data-q="width:100%">Fill</button><button data-q="width:fit-content">Hug</button><button data-q="width:auto">Auto</button></div>' +
      fText(cs, 'height', 'Height') +
      '<div class="quick"><button data-q="height:100%">Fill</button><button data-q="height:fit-content">Hug</button><button data-q="height:auto">Auto</button></div>' +
      fText(cs, 'min-width', 'Min width') + fText(cs, 'max-width', 'Max width') + fText(cs, 'min-height', 'Min height') + fText(cs, 'max-height', 'Max height') +
      fSel(cs, 'overflow', 'Overflow', ['visible', 'hidden', 'auto', 'scroll']) + (tag === 'img' ? fSel(cs, 'object-fit', 'Fit', ['fill', 'contain', 'cover', 'none']) : ''), true);

    h += sec('Spacing', fBox(cs, 'Padding', 'padding') + fBox(cs, 'Margin', 'margin'), true);

    h += sec('Typography',
      fSel(cs, 'font-family', 'Font', FONTS) + fText(cs, 'font-size', 'Size') +
      fSel(cs, 'font-weight', 'Weight', ['100', '200', '300', '400', '500', '600', '700', '800', '900']) +
      fText(cs, 'line-height', 'Line height') + fText(cs, 'letter-spacing', 'Letter spacing') +
      fSel(cs, 'text-align', 'Align', ['start', 'left', 'center', 'right', 'justify']) +
      fSel(cs, 'text-transform', 'Case', ['none', 'uppercase', 'lowercase', 'capitalize']) +
      fSel(cs, 'text-decoration-line', 'Decoration', ['none', 'underline', 'line-through']) +
      fSel(cs, 'font-style', 'Style', ['normal', 'italic']) + fClr(cs, 'color', 'Color'), true);

    h += sec('Fill & border',
      fClr(cs, 'background-color', 'Background') + fText(cs, 'background-image', 'BG image') +
      fText(cs, 'border-radius', 'Radius') + fText(cs, 'border-width', 'Border width') +
      fSel(cs, 'border-style', 'Border style', ['none', 'solid', 'dashed', 'dotted']) + fClr(cs, 'border-color', 'Border color') +
      '<label class="fld"><span>Opacity</span><input type="range" min="0" max="1" step="0.05" data-p="opacity" value="' + esc(cs.opacity) + '" style="width:100%"></label>', true);

    const shadowNow = cs.boxShadow;
    h += sec('Effects',
      '<label class="fld"><span>Shadow</span><select data-shadow="1"><option value="">Custom / current</option>' + Object.keys(SHADOWS).map((k) => '<option value="' + k + '">' + k + '</option>').join('') + '</select></label>' +
      '<label class="fld"><span>Box shadow</span><input type="text" data-p="box-shadow" value="' + esc(shadowNow === 'none' ? '' : shadowNow) + '"></label>' +
      fText(cs, 'filter', 'Filter') + fText(cs, 'backdrop-filter', 'Backdrop') + fText(cs, 'transform', 'Transform') + fText(cs, 'transition', 'Transition') + fSel(cs, 'cursor', 'Cursor', ['auto', 'pointer', 'default', 'text', 'not-allowed', 'grab']), false);

    h += sec('Position',
      fSel(cs, 'position', 'Position', ['static', 'relative', 'absolute', 'fixed', 'sticky']) +
      fText(cs, 'top', 'Top') + fText(cs, 'right', 'Right') + fText(cs, 'bottom', 'Bottom') + fText(cs, 'left', 'Left') + fText(cs, 'z-index', 'Z-index'), false);

    const mine = (f.edits[S.sel.eid] || {})[editKey(f)] || {};
    h += sec('Custom CSS', '<textarea class="full" data-custom="1" placeholder="prop: value;">' + esc(Object.entries(mine).map(([k, v]) => k + ': ' + v + ';').join('\n')) + '</textarea><p class="note">Overrides for this element at this size/state. Edit and click outside to apply.</p>', false);

    host.innerHTML = h + helpHtml();
  }

  function frameProps(f) {
    return '<div class="top"><div class="crumb">Frame</div><div class="acts"><button class="btn" data-fact="dup">Duplicate</button><button class="btn danger" data-fact="del">Delete</button></div></div>' +
      '<div class="sec"><h4>Frame</h4>' +
      '<label class="fld"><span>Name</span><input type="text" data-fp="name" value="' + esc(f.name) + '"></label>' +
      '<label class="fld"><span>Width</span><input type="text" data-fp="w" value="' + Math.round(f.w) + '"></label>' +
      '<label class="fld"><span>Page color</span><span class="clr"><input type="color" data-fp="bg" value="' + toHex(f.bg || '#ffffff') + '"><input type="text" data-fp="bg" value="' + esc(f.bg) + '" placeholder="transparent"></span></label>' +
      '<p class="note">Edits made while the frame is mobile-width apply to mobile, tablet-width to tablet. Those become real @media rules on export.</p></div>';
  }

  function helpHtml() {
    return '<div class="kbd"><b>Click</b> select &nbsp; <b>Double-click</b> edit text<br><b>Drag</b> reorder (blue line shows drop spot)<br><b>Alt+Drag</b> offset (relative position)<br><b>Handles</b> resize &nbsp; <b>Shift</b> keeps ratio<br><b>Enter</b> child &nbsp; <b>Shift+Enter</b> parent<br><b>Ctrl+D</b> duplicate &nbsp; <b>Ctrl+C/V</b> copy/paste<br><b>Del</b> delete &nbsp; <b>Ctrl+Z</b> undo<br><b>Ctrl+scroll</b> zoom &nbsp; <b>scroll</b> pan</div>';
  }

  function applyField(t) {
    const f = curFrame();
    if (!f) return;
    armUndo();

    if (t.dataset.fp) {
      const k = t.dataset.fp;
      let v = t.value;
      if (k === 'w') { setFrameWidth(f, parseFloat(v) || f.w); renderProps(); save(); return; }
      if (k === 'bg') { f.bg = v; $('#ec-base', R[f.id].doc).textContent = v ? 'body{background:' + v + '}' : ''; }
      if (k === 'name') { f.name = v; posFrame(f); }
      if (t.type === 'color') { const sib = t.parentElement.querySelector('input[type=text]'); if (sib) sib.value = v; }
      else if (k === 'bg') { const sib = t.parentElement.querySelector('input[type=color]'); if (sib && /^#[0-9a-f]{6}$/i.test(v)) sib.value = v; }
      save();
      return;
    }

    const el = selEl();
    if (!el) return;
    const eid = S.sel.eid;

    if (t.dataset.txt) { el.textContent = t.value; commitDom(f); updOv(f.id); return; }
    if (t.dataset.a) { el.setAttribute(t.dataset.a, t.value); commitDom(f); updOv(f.id); return; }
    if (t.dataset.shadow) { if (t.value) { setEdit(f, eid, 'box-shadow', SHADOWS[t.value]); fit(f); renderProps(); save(); } return; }
    if (t.dataset.custom) {
      const key = editKey(f);
      const m = f.edits[eid] || {};
      Object.keys(m[key] || {}).forEach((k) => setEditKey(f, eid, key, k, ''));
      Object.entries(css(t.value.replace(/\n/g, ';'))).forEach(([k, v]) => setEditKey(f, eid, key, k, v.replace(/\s*!important$/, '')));
      applyEdits(f); fit(f); save();
      return;
    }
    const p = t.dataset.p;
    if (!p) return;
    let v = t.value.trim();
    if (t.type === 'color') {
      v = t.value;
      const sib = t.parentElement.querySelector('input[type=text]');
      if (sib) sib.value = v;
    } else if (t.type === 'text') {
      const sib = t.parentElement.querySelector('input[type=color]');
      if (sib && /^#[0-9a-f]{6}$/i.test(v)) sib.value = v;
    }
    if (/^-?\d+(\.\d+)?$/.test(v) && !UNITLESS.has(p) && v !== '0') v += 'px';
    const r = R[f.id];
    if (p === 'display' || p === 'width' || p === 'height') { /* inline ignores size */ if (p !== 'display' && r.win.getComputedStyle(el).display === 'inline') setEdit(f, eid, 'display', 'inline-block'); }
    setEdit(f, eid, p, v);
    fit(f);
    save();
  }

  $('#props').addEventListener('input', (e) => {
    const t = e.target;
    if (t.type === 'color' || t.type === 'range') applyField(t);
  });
  $('#props').addEventListener('change', (e) => {
    const t = e.target;
    if (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'color' && t.type !== 'range')) {
      applyField(t);
      if (t.tagName === 'SELECT' && t.dataset.p === 'display') renderProps();
    }
  });
  $('#props').addEventListener('focusout', () => { S.undoArmed = false; });
  $('#props').addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.tagName !== 'INPUT' || t.type !== 'text') return;
    if (e.key === 'Enter') { t.blur(); return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const m = t.value.match(/^(-?\d*\.?\d+)(.*)$/);
    if (!m) return;
    e.preventDefault();
    const step = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
    t.value = (Math.round((parseFloat(m[1]) + step) * 100) / 100) + m[2];
    applyField(t);
  });
  $('#props').addEventListener('click', (e) => {
    const f = curFrame();
    const ps = e.target.closest('[data-ps]');
    if (ps) { S.pstate = ps.dataset.ps; renderProps(); return; }
    const q = e.target.closest('[data-q]');
    if (q && f && S.sel.eid) {
      pushUndoFor(f);
      const [p, v] = q.dataset.q.split(':');
      setEdit(f, S.sel.eid, p, v);
      fit(f); renderProps(); save();
      return;
    }
    const fa = e.target.closest('[data-fact]');
    if (fa && f) { if (fa.dataset.fact === 'del') removeFrame(f.id); else dupFrame(f); return; }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'del') delSel();
    else if (act === 'dup') dupSel();
    else if (act === 'up') moveSel(-1);
    else if (act === 'down') moveSel(1);
    else if (act === 'wrap') wrapSel();
    else if (act === 'reset') resetEl();
    else if (act === 'parent') selectParent();
  });

  // ---------------------------------------------------------------------------
  // Left panel
  // ---------------------------------------------------------------------------
  function renderLeft() {
    const pane = $('#lpane');
    $$('#ltabs button').forEach((b) => b.classList.toggle('on', b.dataset.lt === S.ltab));
    if (S.ltab === 'collected') {
      pane.innerHTML = '<button class="btn block" id="blank" style="background:var(--accent);border-color:var(--accent);color:#fff">+ Blank frame</button>' +
        '<h4>Collected elements</h4>' +
        (S.items.length
          ? S.items.map((i) => '<div class="citem" data-item="' + esc(i.id) + '"><div class="th">' + (i.thumb ? '<img src="' + i.thumb + '" alt="">' : 'No preview') + '</div><div><div class="nm">' + esc(i.name) + '</div><div class="sub">' + esc(hostOf(i.url)) + '</div></div></div>').join('')
          : '<p class="hint">Nothing collected yet. Use the side panel to pick elements from any site, then add them here.</p>') +
        (S.frames.length ? '<h4 style="margin-top:14px">Frames on canvas</h4>' + S.frames.map((f) => '<div class="ly' + (S.sel && S.sel.fid === f.id ? ' on' : '') + '" data-frame="' + f.id + '">' + esc(f.name) + '</div>').join('') : '');
    } else if (S.ltab === 'layers') {
      const f = targetFrame();
      if (!f || !R[f.id] || !R[f.id].doc) { pane.innerHTML = '<p class="hint">Select a frame to see its layers.</p>'; return; }
      const doc = R[f.id].doc;
      const rows = [];
      let count = 0;
      (function rec(parent, d) {
        for (const c of parent.children) {
          if (!c.hasAttribute('data-eid')) continue;
          if (++count > 600) return;
          const txt = Array.from(c.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue.trim()).join(' ').slice(0, 22);
          const on = S.sel && S.sel.fid === f.id && S.sel.eid === c.getAttribute('data-eid');
          rows.push('<div class="ly' + (on ? ' on' : '') + '" style="padding-left:' + (6 + d * 12) + 'px" data-eid="' + c.getAttribute('data-eid') + '">' + esc(label(c)) + ' <span class="tx">' + esc(txt) + '</span></div>');
          rec(c, d + 1);
        }
      })(doc.body, 0);
      pane.innerHTML = '<h4>' + esc(f.name) + '</h4>' + (rows.join('') || '<p class="hint">Empty frame.</p>');
    } else {
      const names = [['container', 'Container'], ['row', 'Row'], ['grid', 'Grid (3)'], ['heading', 'Heading'], ['text', 'Text'], ['button', 'Button'], ['link', 'Link'], ['image', 'Image'], ['input', 'Input'], ['divider', 'Divider'], ['card', 'Card'], ['navbar', 'Navbar'], ['hero', 'Hero']];
      pane.innerHTML = '<p class="hint">Adds inside the selected container, or after the selected element.</p><div class="igrid">' + names.map(([k, l]) => '<button class="btn" data-kind="' + k + '">' + l + '</button>').join('') + '</div>';
    }
  }
  const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return u || ''; } };

  $('#ltabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lt]');
    if (b) { S.ltab = b.dataset.lt; renderLeft(); }
  });
  $('#lpane').addEventListener('click', (e) => {
    if (e.target.closest('#blank')) { addBlank(); return; }
    const it = e.target.closest('[data-item]');
    if (it) { const item = S.items.find((i) => i.id === it.dataset.item); if (item) addItem(item); return; }
    const fr = e.target.closest('[data-frame]');
    if (fr) { const f = F(fr.dataset.frame); if (f) { select(f.id, null); focusFrame(f); } return; }
    const ly = e.target.closest('[data-eid]');
    if (ly) { const f = targetFrame(); if (f) select(f.id, ly.dataset.eid); return; }
    const k = e.target.closest('[data-kind]');
    if (k) insertKind(k.dataset.kind);
  });
  $('#lpane').addEventListener('mouseover', (e) => {
    const ly = e.target.closest('[data-eid]');
    const f = targetFrame();
    if (ly && f) showHover(f.id, elOf(f, ly.dataset.eid));
  });
  $('#lpane').addEventListener('mouseleave', () => { const f = targetFrame(); if (f) showHover(f.id, null); });

  // ---------------------------------------------------------------------------
  // View (pan / zoom)
  // ---------------------------------------------------------------------------
  function applyView() {
    world.style.transform = 'translate(' + S.px + 'px,' + S.py + 'px) scale(' + S.zoom + ')';
    world.style.setProperty('--z', S.zoom);
    $('#zlbl').textContent = Math.round(S.zoom * 100) + '%';
  }
  function zoomAt(cx, cy, k) {
    const nz = clamp(S.zoom * k, 0.1, 4);
    const wx = (cx - S.px) / S.zoom, wy = (cy - S.py) / S.zoom;
    S.zoom = nz; S.px = cx - wx * nz; S.py = cy - wy * nz;
    applyView(); save();
  }
  function onWheel(e, cx, cy) {
    if (e.ctrlKey || e.metaKey) zoomAt(cx, cy, Math.exp(-e.deltaY * 0.01));
    else { S.px -= e.deltaX; S.py -= e.deltaY; applyView(); save(); }
  }
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const vb = viewport.getBoundingClientRect();
    onWheel(e, e.clientX - vb.left, e.clientY - vb.top);
  }, { passive: false });

  viewport.addEventListener('pointerdown', (e) => {
    if (e.target !== viewport && e.target !== world) return;
    S.sel = null;
    S.frames.forEach((f) => updOv(f.id));
    $$('.frame').forEach((n) => n.classList.remove('on'));
    renderProps(); syncToolbar();
    const sx = e.clientX, sy = e.clientY, ox = S.px, oy = S.py;
    const mv = (ev) => { S.px = ox + ev.clientX - sx; S.py = oy + ev.clientY - sy; applyView(); };
    const up = () => { window.removeEventListener('pointermove', mv); save(); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up, { once: true });
  });

  function fitBounds(list) {
    if (!list.length) return;
    const vb = viewport.getBoundingClientRect();
    const x0 = Math.min(...list.map((f) => f.x)), y0 = Math.min(...list.map((f) => f.y));
    const x1 = Math.max(...list.map((f) => f.x + f.w)), y1 = Math.max(...list.map((f) => f.y + f.h));
    const pad = 80;
    const z = clamp(Math.min((vb.width - pad * 2) / (x1 - x0), (vb.height - pad * 2) / (y1 - y0)), 0.1, 1);
    S.zoom = z;
    S.px = (vb.width - (x1 - x0) * z) / 2 - x0 * z;
    S.py = (vb.height - (y1 - y0) * z) / 2 - y0 * z + 10;
    applyView(); save();
  }
  const fitAll = () => fitBounds(S.frames);
  const focusFrame = (f) => fitBounds([f]);

  $('#zin').onclick = () => { const vb = viewport.getBoundingClientRect(); zoomAt(vb.width / 2, vb.height / 2, 1.2); };
  $('#zout').onclick = () => { const vb = viewport.getBoundingClientRect(); zoomAt(vb.width / 2, vb.height / 2, 1 / 1.2); };
  $('#zlbl').onclick = fitAll;
  window.addEventListener('resize', () => { S.frames.forEach((f) => updOv(f.id)); });

  // ---------------------------------------------------------------------------
  // Toolbar
  // ---------------------------------------------------------------------------
  function syncToolbar() {
    const f = targetFrame();
    $('#undo').disabled = !S.undo.length;
    $('#redo').disabled = !S.redo.length;
    $$('#devices [data-w]').forEach((b) => b.classList.toggle('on', !!f && Number(b.dataset.w) === Math.round(f.w)));
    $('#fw').value = f ? Math.round(f.w) : '';
    $('#bp').textContent = f ? bpOf(f.w) : '-';
    $('#preview').classList.toggle('on', S.preview);
  }
  $('#undo').onclick = undo;
  $('#redo').onclick = redo;
  $('#devices').addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]');
    const f = targetFrame();
    if (!b || !f) return;
    pushUndoFor(f);
    setFrameWidth(f, Number(b.dataset.w));
    renderProps(); save();
  });
  $('#fw').addEventListener('change', (e) => {
    const f = targetFrame();
    if (!f) return;
    pushUndoFor(f);
    setFrameWidth(f, Number(e.target.value) || f.w);
    renderProps(); save();
  });
  $('#preview').onclick = () => {
    S.preview = !S.preview;
    viewport.classList.toggle('preview', S.preview);
    S.frames.forEach((f) => updOv(f.id));
    syncToolbar();
    toast(S.preview ? 'Preview on: hover states are live' : 'Preview off');
  };

  const donate = $('#donate');
  donate.href = (typeof CONFIG !== 'undefined' && CONFIG.DONATE_URL) || '#';

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  const fileName = (s) => String(s || 'design').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'design';
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
  }

  $('#exportBtn').onclick = (e) => { e.stopPropagation(); $('#exportMenu').hidden = !$('#exportMenu').hidden; };
  document.addEventListener('click', () => { $('#exportMenu').hidden = true; });

  $('#exportMenu').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-x]');
    if (!b) return;
    const x = b.dataset.x;
    const f = targetFrame();
    $('#exportMenu').hidden = true;
    if (x === 'import') { $('#importFile').click(); return; }
    if (!f) { toast('Nothing to export yet'); return; }
    const r = R[f.id];
    try {
      if (x === 'html') download(new Blob([ECX.standalone(f)], { type: 'text/html' }), fileName(f.name) + '.html');
      else if (x === 'html-all') download(ECX.zip(S.frames.map((fr, i) => ({ name: fileName(fr.name) + (S.frames.filter((o) => fileName(o.name) === fileName(fr.name)).length > 1 ? '-' + (i + 1) : '') + '.html', data: ECX.standalone(fr) }))), 'design-frames.zip');
      else if (x === 'copy-html') { await copy(ECX.snippet(f)); toast('HTML + CSS copied'); }
      else if (x === 'css') download(new Blob([ECX.cleanFrame(f).css + '\n'], { type: 'text/css' }), fileName(f.name) + '.css');
      else if (x === 'jsx') download(ECX.zip(ECX.reactFiles(f)), fileName(f.name) + '-react.zip');
      else if (x === 'figma') { await copy(ECX.toSvg(r.doc)); toast('Copied. In Figma, click the canvas and press Ctrl+V'); }
      else if (x === 'svg') download(new Blob([ECX.toSvg(r.doc)], { type: 'image/svg+xml' }), fileName(f.name) + '.svg');
      else if (x === 'png') download(await ECX.toPng(r.doc, 2), fileName(f.name) + '.png');
      else if (x === 'json') download(new Blob([JSON.stringify({ app: 'element-collector', v: 1, frames: S.frames }, null, 2)], { type: 'application/json' }), 'design-project.json');
    } catch (err) {
      toast('Export failed: ' + (err && err.message ? err.message : err));
    }
  });

  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const o = JSON.parse(await file.text());
      if (!o || !Array.isArray(o.frames)) throw new Error('Not a project file');
      Object.keys(R).forEach((id) => { R[id].el.remove(); delete R[id]; });
      S.frames = o.frames.map(normalizeFrame);
      S.sel = null; S.undo = []; S.redo = [];
      S.frames.forEach(mountFrame);
      renderLeft(); renderProps(); syncToolbar(); save();
      setTimeout(fitAll, 400);
    } catch (err) { toast('Could not open project: ' + err.message); }
  });

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------
  function onKey(e) {
    const t = e.target;
    if ((t.matches && t.matches('input,textarea,select')) || t.isContentEditable) {
      if (e.key === 'Escape' && t.isContentEditable) t.blur();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k === 'd') { e.preventDefault(); dupSel(); return; }
    if (mod && k === 'c' && selEl()) { e.preventDefault(); copySel(); return; }
    if (mod && k === 'v' && S.clip) { e.preventDefault(); pasteClip(); return; }
    if (mod) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (selEl()) { e.preventDefault(); delSel(); } return; }
    if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) selectParent(); else selectChild(); return; }
    if (e.key === 'Escape') { const f = curFrame(); if (f) select(f.id, null); return; }
    if (e.key === 'Tab' && selEl()) {
      e.preventDefault();
      const el = selEl();
      const n = e.shiftKey ? el.previousElementSibling : el.nextElementSibling;
      if (n && n.hasAttribute('data-eid')) select(S.sel.fid, n.getAttribute('data-eid'));
    }
  }
  document.addEventListener('keydown', onKey);

  init();
})();
