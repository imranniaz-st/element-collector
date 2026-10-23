// Element Collector - Live CSS content script (injected on demand from the side panel)
// Applies CSS to the open page in real time. Nothing is saved to the website:
// every change lives in one <style> tag that disappears when the page reloads.
(() => {
  if (window.__lcLoaded) return;
  window.__lcLoaded = true;

  const STYLE_ID = '__ec_live_css';
  const BLOCKED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick', 'contextmenu', 'touchstart', 'touchend'];

  let css = '';
  let enabled = true;
  let styleEl = null;
  let ui = null;
  let picker = null;
  let lastProps = [];
  let selection = { selector: '', els: [] };
  let drawQueued = false;
  let trackingScroll = false;

  // ---------------------------------------------------------------------------
  // Live stylesheet
  // ---------------------------------------------------------------------------
  function applyStyle() {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
    }
    if (!styleEl.isConnected) document.documentElement.appendChild(styleEl);
    styleEl.textContent = enabled ? css : '';
  }

  // ---------------------------------------------------------------------------
  // Overlay (selection boxes + picker bar), isolated in a closed shadow root
  // ---------------------------------------------------------------------------
  function div(css) {
    const n = document.createElement('div');
    n.style.cssText = css;
    return n;
  }

  function ensureUI() {
    if (ui && ui.host.isConnected) return ui;
    if (ui) { document.documentElement.appendChild(ui.host); return ui; }
    const host = div('all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;');
    const root = host.attachShadow({ mode: 'closed' });
    const hover = div('position:fixed;display:none;box-sizing:border-box;border:2px solid #4f46e5;background:rgba(79,70,229,.14);pointer-events:none;');
    const label = div('position:fixed;display:none;background:#1e1b4b;color:#fff;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;padding:3px 8px;border-radius:4px;pointer-events:none;white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis;');
    const bar = div('position:fixed;display:none;top:12px;left:50%;transform:translateX(-50%);background:#111827;color:#f9fafb;font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;padding:8px 14px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none;white-space:nowrap;');
    bar.textContent = 'Live CSS   |   Click an element to edit it   |   Esc: cancel';
    root.append(hover, label, bar);
    document.documentElement.appendChild(host);
    ui = { host, root, hover, label, bar, pool: [] };
    return ui;
  }

  function queueDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; drawSelection(); });
  }

  function drawSelection() {
    if (!ui) return;
    const els = selection.els.slice(0, 40);
    while (ui.pool.length < els.length) {
      const b = div('position:fixed;display:none;box-sizing:border-box;border:2px solid #059669;background:rgba(5,150,105,.12);pointer-events:none;');
      ui.root.appendChild(b);
      ui.pool.push(b);
    }
    ui.pool.forEach((b, i) => {
      const el = els[i];
      if (!el || !el.isConnected) { b.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      b.style.display = 'block';
      b.style.left = r.left + 'px';
      b.style.top = r.top + 'px';
      b.style.width = r.width + 'px';
      b.style.height = r.height + 'px';
    });
  }

  function trackLayout() {
    if (trackingScroll) return;
    trackingScroll = true;
    window.addEventListener('scroll', queueDraw, true);
    window.addEventListener('resize', queueDraw, true);
  }

  // ---------------------------------------------------------------------------
  // Selectors and element info
  // ---------------------------------------------------------------------------
  function count(sel) {
    try { return document.querySelectorAll(sel).length; } catch (e) { return -1; }
  }

  function uniqueSelector(el) {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      if (n.id) {
        const s = '#' + CSS.escape(n.id);
        if (count(s) === 1) { parts.unshift(s); return parts.join(' > '); }
      }
      let part = n.tagName.toLowerCase();
      if (n === document.body) { parts.unshift('body'); break; }
      const cls = Array.from(n.classList).filter((c) => /^[a-zA-Z_-][\w-]*$/.test(c)).slice(0, 2);
      if (cls.length) part += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const p = n.parentElement;
      if (p) {
        const same = Array.from(p.children).filter((c) => c.matches(part));
        if (same.length > 1) {
          const idx = Array.from(p.children).filter((c) => c.tagName === n.tagName).indexOf(n) + 1;
          part += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(part);
      const sel = parts.join(' > ');
      if (count(sel) === 1) return sel;
      n = n.parentElement;
    }
    return parts.join(' > ');
  }

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const c = Array.from(el.classList).slice(0, 2);
    if (c.length) s += '.' + c.join('.');
    return s;
  }

  function info(props) {
    const el = selection.els[0];
    const computed = {};
    if (el) {
      const cs = getComputedStyle(el);
      (props || lastProps).forEach((p) => { computed[p] = cs.getPropertyValue(p); });
    }
    return {
      selector: selection.selector,
      count: selection.els.length,
      tag: el ? describe(el) : '',
      computed
    };
  }

  function setSelection(els, selector) {
    selection = { selector, els };
    ensureUI();
    trackLayout();
    drawSelection();
  }

  // ---------------------------------------------------------------------------
  // Picker
  // ---------------------------------------------------------------------------
  function swallow(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function startPick() {
    if (picker) return;
    const u = ensureUI();
    u.bar.style.display = 'block';
    picker = { hover: null };
    BLOCKED.forEach((t) => window.addEventListener(t, swallow, true));
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
  }

  function stopPick(notify) {
    if (!picker) return;
    BLOCKED.forEach((t) => window.removeEventListener(t, swallow, true));
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
    picker = null;
    if (ui) {
      ui.bar.style.display = 'none';
      ui.hover.style.display = 'none';
      ui.label.style.display = 'none';
    }
    if (notify) chrome.runtime.sendMessage({ type: 'LC_PICK_ENDED' }).catch(() => {});
  }

  function onMove(e) {
    if (!picker) return;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    if (!t || t === picker.hover || t === ui.host) return;
    picker.hover = t;
    const r = t.getBoundingClientRect();
    Object.assign(ui.hover.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    ui.label.textContent = describe(t) + '  ' + Math.round(r.width) + ' x ' + Math.round(r.height);
    ui.label.style.display = 'block';
    ui.label.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 200)) + 'px';
    ui.label.style.top = (r.top > 28 ? r.top - 26 : r.bottom + 4) + 'px';
  }

  function onClick(e) {
    swallow(e);
    if (!picker) return;
    const target = picker.hover || document.elementFromPoint(e.clientX, e.clientY);
    if (!target) return;
    stopPick(false);
    const selector = uniqueSelector(target);
    setSelection([target], selector);
    chrome.runtime.sendMessage({ type: 'LC_PICKED', data: info() }).catch(() => {});
  }

  function onKey(e) {
    if (!picker) return;
    if (e.key === 'Escape') { swallow(e); stopPick(true); }
  }

  // ---------------------------------------------------------------------------
  // Messages from the side panel
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || msg.type.indexOf('LC_') !== 0) return false;
    if (msg.props) lastProps = msg.props;

    switch (msg.type) {
      case 'LC_PICK_START':
        startPick();
        sendResponse({ ok: true });
        break;

      case 'LC_PICK_STOP':
        stopPick(false);
        sendResponse({ ok: true });
        break;

      case 'LC_SELECT': {
        let els = [];
        let error = null;
        try { els = Array.from(document.querySelectorAll(msg.selector)); } catch (e) { error = 'Invalid selector'; }
        setSelection(els, msg.selector);
        sendResponse(Object.assign(info(), { ok: !error, error }));
        break;
      }

      case 'LC_NAV': {
        const el = selection.els[0];
        let next = null;
        if (el) {
          if (msg.dir === 'parent') next = el.parentElement;
          else if (msg.dir === 'child') next = el.firstElementChild;
          else if (msg.dir === 'prev') next = el.previousElementSibling;
          else if (msg.dir === 'next') next = el.nextElementSibling;
        }
        if (next && next !== document.documentElement && next !== (ui && ui.host)) {
          setSelection([next], uniqueSelector(next));
        }
        sendResponse(Object.assign(info(), { ok: !!next }));
        break;
      }

      case 'LC_APPLY':
        css = String(msg.css || '');
        applyStyle();
        setTimeout(queueDraw, 60);
        sendResponse({ ok: true });
        break;

      case 'LC_ENABLE':
        enabled = !!msg.enabled;
        applyStyle();
        setTimeout(queueDraw, 60);
        sendResponse({ ok: true });
        break;

      case 'LC_CLEAR':
        css = '';
        enabled = true;
        applyStyle();
        selection = { selector: '', els: [] };
        drawSelection();
        sendResponse({ ok: true });
        break;

      case 'LC_STATE':
        sendResponse({ ok: true, css, enabled, selector: selection.selector });
        break;

      default:
        sendResponse({ ok: false });
    }
    return false;
  });
})();
