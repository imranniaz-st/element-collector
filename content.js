// Element Collector - content script (injected on demand from the side panel)
(() => {
  if (window.__ecLoaded) return;
  window.__ecLoaded = true;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const REMOVE_TAGS = new Set(['script', 'style', 'noscript', 'link', 'template', 'iframe', 'object', 'embed']);
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const WS = /[ \t\r\n\f]+/g;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg && msg.type) {
      case 'EC_START': startPicker(); break;
      case 'EC_STOP': stopPicker(true); break;
      case 'EC_PARENT': goParent(); break;
      case 'EC_CHILD': goChild(); break;
      case 'EC_COLLECT': if (picker && picker.current) capture(picker.current); break;
    }
  });

  // ---------------------------------------------------------------------------
  // Picker UI
  // ---------------------------------------------------------------------------
  let picker = null;
  const BLOCKED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick', 'contextmenu', 'touchstart', 'touchend'];

  function h(tag, css, text) {
    const n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text) n.textContent = text;
    return n;
  }

  function buildUI() {
    const host = h('div', 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;');
    const root = host.attachShadow({ mode: 'closed' });
    const box = h('div', 'position:fixed;display:none;box-sizing:border-box;border:2px solid #4f46e5;background:rgba(79,70,229,.14);pointer-events:none;');
    const label = h('div', 'position:fixed;display:none;background:#1e1b4b;color:#fff;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;padding:3px 8px;border-radius:4px;pointer-events:none;white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis;');
    const bar = h('div', 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#111827;color:#f9fafb;font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;padding:8px 14px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);pointer-events:none;white-space:nowrap;',
      'Click to collect   |   Up / Down: parent / child   |   Esc: cancel');
    root.append(box, label, bar);
    document.documentElement.appendChild(host);
    return { host, box, label, bar };
  }

  function startPicker() {
    if (picker) return;
    picker = { ui: buildUI(), current: null, hover: null, stack: [] };
    BLOCKED.forEach((t) => window.addEventListener(t, swallow, true));
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', draw, true);
    window.addEventListener('resize', draw, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  }

  function stopPicker(notify) {
    if (!picker) return;
    BLOCKED.forEach((t) => window.removeEventListener(t, swallow, true));
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', draw, true);
    window.removeEventListener('resize', draw, true);
    window.removeEventListener('wheel', onWheel, true);
    picker.ui.host.remove();
    picker = null;
    if (notify) chrome.runtime.sendMessage({ type: 'PICK_ENDED' }).catch(() => {});
  }

  function swallow(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onMove(e) {
    if (!picker) return;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    if (!t || t === picker.hover) return;
    picker.hover = t;
    picker.current = t;
    picker.stack = [];
    draw();
  }

  function onClick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!picker) return;
    const target = picker.current || document.elementFromPoint(e.clientX, e.clientY);
    if (target) capture(target);
  }

  function onKey(e) {
    if (!picker) return;
    if (e.key === 'Escape') { swallow(e); stopPicker(true); }
    else if (e.key === 'ArrowUp') { swallow(e); goParent(); }
    else if (e.key === 'ArrowDown') { swallow(e); goChild(); }
    else if (e.key === 'Enter' && picker.current) { swallow(e); capture(picker.current); }
  }

  function onWheel(e) {
    if (!picker || !e.shiftKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if ((e.deltaY || e.deltaX) < 0) goParent(); else goChild();
  }

  function goParent() {
    if (!picker || !picker.current) return;
    const p = picker.current.parentElement;
    if (p && p !== document.documentElement) {
      picker.stack.push(picker.current);
      picker.current = p;
      draw();
    }
  }

  function goChild() {
    if (!picker || !picker.stack.length) return;
    picker.current = picker.stack.pop();
    draw();
  }

  function describe(el) {
    let s = el.localName;
    if (el.id) s += '#' + el.id;
    const raw = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
    const cls = raw.trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  }

  function draw() {
    if (!picker || !picker.current) return;
    const { box, label } = picker.ui;
    const r = picker.current.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    label.textContent = describe(picker.current) + '   ' + Math.round(r.width) + ' x ' + Math.round(r.height);
    label.style.display = 'block';
    let top = r.top > 30 ? r.top - 26 : r.bottom + 4;
    if (top > window.innerHeight - 30) top = r.top + 4;
    label.style.top = Math.max(2, top) + 'px';
    label.style.left = Math.min(Math.max(2, r.left), Math.max(2, window.innerWidth - 220)) + 'px';
  }

  function toast(text, isError) {
    const t = h('div', 'all:initial;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483647;background:' + (isError ? '#991b1b' : '#111827') + ';color:#fff;font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;padding:9px 16px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);', text);
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  // ---------------------------------------------------------------------------
  // Capture flow
  // ---------------------------------------------------------------------------
  async function capture(el) {
    stopPicker(false);
    const r = el.getBoundingClientRect();
    const rect = { x: r.left, y: r.top, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };

    // Drop the hover state so computed styles reflect the resting state of the element.
    const root = document.documentElement;
    const prevPE = root.style.pointerEvents;
    root.style.pointerEvents = 'none';
    await sleep(160);

    let payload = null;
    try {
      payload = await buildPayload(el);
    } catch (err) {
      console.error('Element Collector:', err);
    } finally {
      root.style.pointerEvents = prevPE;
    }

    if (!payload) {
      toast('Could not collect this element', true);
      chrome.runtime.sendMessage({ type: 'PICK_ENDED' }).catch(() => {});
      return;
    }

    await sleep(40);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SAVE_CAPTURE', payload, rect });
      toast(res && res.ok ? 'Element collected' : 'Could not save the element', !(res && res.ok));
    } catch (err) {
      toast('Could not save the element', true);
    }
    chrome.runtime.sendMessage({ type: 'PICK_ENDED' }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Stylesheet access
  // ---------------------------------------------------------------------------
  async function getSheets() {
    const slots = [];
    let skipped = 0;
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        if (sheet.media && /^print$/i.test(sheet.media.mediaText)) continue;
      } catch (e) { /* ignore */ }
      let rules = null;
      try { rules = sheet.cssRules; } catch (e) { rules = null; }
      if (rules) {
        slots.push({ rules, base: sheet.href || document.baseURI });
      } else if (sheet.href) {
        slots.push(fetchSheet(sheet.href).then((s) => { if (!s) skipped++; return s; }));
      } else {
        skipped++;
      }
    }
    const resolved = (await Promise.all(slots)).filter(Boolean);
    try {
      for (const s of document.adoptedStyleSheets || []) resolved.push({ rules: s.cssRules, base: document.baseURI });
    } catch (e) { /* ignore */ }
    return { list: resolved, skipped };
  }

  async function fetchSheet(href) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'FETCH_CSS', url: href });
      if (!res || !res.ok) return null;
      const s = new CSSStyleSheet();
      s.replaceSync(res.text);
      return { rules: s.cssRules, base: href };
    } catch (e) {
      return null;
    }
  }

  // Flattens style rules into [{chain, selectorText, style, base}] keeping only rules we may need.
  function walk(list, chain, base, out, depth) {
    if (depth > 8) return;
    let arr;
    try { arr = Array.from(list); } catch (e) { return; }
    for (const rule of arr) {
      if (rule instanceof CSSStyleRule) {
        const sel = rule.selectorText;
        const hasSize = !chain.length && (rule.style.getPropertyValue('width') || rule.style.getPropertyValue('height'));
        const hasState = /:(hover|focus|active|focus-visible|focus-within)/.test(sel);
        if (chain.length || hasState || hasSize) out.push({ chain, selectorText: sel, style: rule.style, base });
      } else if (rule instanceof CSSMediaRule || (window.CSSContainerRule && rule instanceof CSSContainerRule)) {
        const t = rule.cssText;
        const header = t.slice(0, t.indexOf('{')).trim();
        const isAll = rule instanceof CSSMediaRule && (!rule.media.mediaText || rule.media.mediaText === 'all');
        walk(rule.cssRules, isAll ? chain : chain.concat(header), base, out, depth + 1);
      } else if (rule instanceof CSSImportRule) {
        try { walk(rule.styleSheet.cssRules, chain, rule.styleSheet.href || base, out, depth + 1); } catch (e) { /* cross-origin */ }
      } else if ((window.CSSSupportsRule && rule instanceof CSSSupportsRule) || (window.CSSLayerBlockRule && rule instanceof CSSLayerBlockRule)) {
        walk(rule.cssRules, chain, base, out, depth + 1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Selector helpers
  // ---------------------------------------------------------------------------
  function splitSelectors(s) {
    const out = [];
    let depth = 0, cur = '', q = null;
    for (const ch of s) {
      if (q) { cur += ch; if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  const SUFFIX_RE = /((?::(?:hover|focus-visible|focus-within|focus|active))+)?(::?(?:before|after))?$/;
  function parseSel(sel) {
    const s = sel.trim();
    const m = SUFFIX_RE.exec(s);
    const suffix = m ? m[0] : '';
    return { base: s.slice(0, s.length - suffix.length).trim(), suffix };
  }

  // ---------------------------------------------------------------------------
  // Value helpers
  // ---------------------------------------------------------------------------
  function absUrl(v) {
    if (!v || v.charAt(0) === '#' || /^(data:|blob:|mailto:|tel:)/i.test(v)) return v;
    if (/^javascript:/i.test(v)) return '#';
    try { return new URL(v, document.baseURI).href; } catch (e) { return v; }
  }

  function absCssUrls(text, base) {
    return text.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (m, q, u) => {
      if (/^(data:|#|https?:|blob:)/i.test(u)) return m;
      try { return 'url("' + new URL(u, base).href + '")'; } catch (e) { return m; }
    });
  }

  function replaceVars(text, el) {
    if (!text || text.indexOf('var(') === -1) return text;
    const cs = getComputedStyle(el);
    let out = text;
    for (let i = 0; i < 6 && out.indexOf('var(') !== -1; i++) {
      out = out.replace(/var\(\s*(--[^,)\s]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (m, name, fb) => {
        const v = cs.getPropertyValue(name).trim();
        return v || (fb !== undefined ? fb.trim() : m);
      });
    }
    return out;
  }

  function declBlock(style, el, base) {
    let txt = style.cssText;
    if (!txt) return '';
    txt = absCssUrls(replaceVars(txt, el), base);
    return txt
      .split(/;\s*(?=[-\w]+\s*:)/)
      .map((s) => s.trim().replace(/;$/, ''))
      .filter(Boolean)
      .map((s) => '  ' + s + ';')
      .join('\n');
  }

  // ---------------------------------------------------------------------------
  // Computed style diffing
  // ---------------------------------------------------------------------------
  const SKIP = new RegExp([
    '^-(?!webkit-(line-clamp|box-orient|text-fill-color|background-clip|text-stroke|mask))',
    '^(width|height|inline-size|block-size|perspective-origin|transform-origin|pointer-events|interactivity|overlay|interpolate-size|view-transition-name|field-sizing|app-region)$',
    '^(anchor|position-|view-timeline|scroll-timeline|timeline-scope|animation-timeline|animation-range|container-)',
    '-(inline|block)-(start|end)',
    '^border-(start|end)-(start|end)-radius$',
    '^(min|max)-(inline|block)-size$',
    '^inset-',
    '^(d|cx|cy|r|rx|ry|x|y)$'
  ].join('|'));

  const INHERITED = new Set(('color cursor direction font font-family font-feature-settings font-kerning font-optical-sizing font-size font-size-adjust font-stretch font-style font-synthesis font-variant font-variant-caps font-variant-east-asian font-variant-ligatures font-variant-numeric font-variant-alternates font-variant-position font-variation-settings font-weight hyphens image-rendering letter-spacing line-break line-height list-style-image list-style-position list-style-type orphans overflow-wrap paint-order quotes tab-size text-align text-align-last text-indent text-justify text-rendering text-shadow text-transform text-wrap text-wrap-mode text-wrap-style text-underline-position text-underline-offset text-decoration-skip-ink visibility white-space white-space-collapse widows word-break word-spacing writing-mode fill fill-opacity fill-rule stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width color-interpolation color-scheme caret-color accent-color text-anchor shape-rendering clip-rule marker-start marker-mid marker-end -webkit-text-fill-color -webkit-text-stroke-color -webkit-text-stroke-width border-collapse border-spacing caption-side empty-cells text-emphasis-color text-emphasis-style text-emphasis-position').split(' '));

  const CC_PROPS = new Set(['-webkit-text-fill-color', '-webkit-text-stroke-color', 'caret-color', 'text-emphasis-color']);
  const SIDES = ['top', 'right', 'bottom', 'left'];

  function irrelevant(p, cs) {
    const m = /^border-(top|right|bottom|left)-(width|color)$/.exec(p);
    if (m) {
      const st = cs.getPropertyValue('border-' + m[1] + '-style');
      return st === 'none' || st === 'hidden';
    }
    if (/^outline-(width|color|offset)$/.test(p)) return cs.getPropertyValue('outline-style') === 'none';
    if (/^column-rule-(width|color)$/.test(p)) return cs.getPropertyValue('column-rule-style') === 'none';
    if (/^text-decoration-(color|style|thickness)$/.test(p)) return cs.getPropertyValue('text-decoration-line') === 'none';
    if (/^text-emphasis-/.test(p)) return cs.getPropertyValue('text-emphasis-style') === 'none';
    if (/^border-image-/.test(p)) return cs.getPropertyValue('border-image-source') === 'none';
    return false;
  }

  function makeSandbox() {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, { position: 'fixed', left: '-99999px', top: '0', width: '1200px', height: '800px', border: '0', visibility: 'hidden', pointerEvents: 'none' });
    document.documentElement.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    try { doc.open(); doc.write('<!doctype html><html><head></head><body></body></html>'); doc.close(); } catch (e) { /* quirks mode fallback */ }
    const cache = new Map();
    return {
      frame,
      get(ns, tag, color) {
        const key = (ns || 'h') + '|' + tag + '|' + (color || '');
        if (cache.has(key)) return cache.get(key);
        let el;
        try { el = ns ? doc.createElementNS(ns, tag) : doc.createElement(tag); } catch (e) { el = doc.createElement('span'); }
        if (color) el.style.color = color;
        const body = doc.body || doc.documentElement;
        body.appendChild(el);
        const cs = win.getComputedStyle(el);
        const o = {};
        for (let i = 0; i < cs.length; i++) { const p = cs[i]; o[p] = cs.getPropertyValue(p); }
        body.removeChild(el);
        cache.set(key, o);
        return o;
      }
    };
  }

  function box4(a, b, c, d) {
    if (a === c && b === d) return a === b ? a : a + ' ' + b;
    if (b === d) return a + ' ' + b + ' ' + c;
    return a + ' ' + b + ' ' + c + ' ' + d;
  }

  function compact(m, cs) {
    const res = new Map();
    for (const base of ['margin', 'padding']) {
      const keys = SIDES.map((s) => base + '-' + s);
      if (keys.some((k) => m.has(k))) {
        keys.forEach((k) => m.delete(k));
        res.set(base, box4(...keys.map((k) => cs.getPropertyValue(k))));
      }
    }
    const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => 'border-' + c + '-radius');
    if (corners.some((k) => m.has(k))) {
      corners.forEach((k) => m.delete(k));
      const vals = corners.map((k) => cs.getPropertyValue(k));
      if (vals.some((v) => v.indexOf(' ') !== -1)) corners.forEach((k, i) => res.set(k, vals[i]));
      else res.set('border-radius', box4(...vals));
    }
    const bprops = [];
    SIDES.forEach((s) => ['width', 'style', 'color'].forEach((k) => bprops.push('border-' + s + '-' + k)));
    if (bprops.some((k) => m.has(k))) {
      bprops.forEach((k) => m.delete(k));
      const sd = SIDES.map((s) => {
        const st = cs.getPropertyValue('border-' + s + '-style');
        if (st === 'none' || st === 'hidden') return null;
        return cs.getPropertyValue('border-' + s + '-width') + ' ' + st + ' ' + cs.getPropertyValue('border-' + s + '-color');
      });
      if (sd.every((x) => x && x === sd[0])) res.set('border', sd[0]);
      else SIDES.forEach((s, i) => { if (sd[i]) res.set('border-' + s, sd[i]); });
    }
    const pairUp = (a, b, name) => {
      if (m.has(a) && m.has(b) && m.get(a) === m.get(b)) { res.set(name, m.get(a)); m.delete(a); m.delete(b); }
    };
    pairUp('overflow-x', 'overflow-y', 'overflow');
    pairUp('row-gap', 'column-gap', 'gap');
    for (const [k, v] of m) res.set(k, v);
    return res;
  }

  function diffStyle(sb, el, cs, parentCs, isRoot, pseudo) {
    const ns = !pseudo && el.namespaceURI === SVG_NS ? SVG_NS : null;
    const tag = pseudo ? 'span' : el.localName;
    const defBase = sb.get(ns, tag, null);
    const defTint = sb.get(ns, tag, cs.getPropertyValue('color'));
    const own = cs.getPropertyValue('color');
    const out = new Map();
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i];
      if (p.charAt(0) === '-' && p.charAt(1) === '-') continue;
      const v = cs.getPropertyValue(p);
      if (v === '') continue;
      if (p === 'width' || p === 'height') {
        if (pseudo && cs.getPropertyValue('display') !== 'inline' && v !== 'auto') out.set(p, v);
        continue;
      }
      if (SKIP.test(p)) continue;
      if ((p === 'min-width' || p === 'min-height') && v === 'auto') continue;
      if (irrelevant(p, cs)) continue;
      if (CC_PROPS.has(p) && v === own) continue;
      let changed;
      if (!isRoot && INHERITED.has(p)) changed = v !== parentCs.getPropertyValue(p);
      else changed = v !== (p === 'color' ? defBase : defTint)[p];
      if (changed) out.set(p, v);
    }
    return compact(out, cs);
  }

  // ---------------------------------------------------------------------------
  // HTML output
  // ---------------------------------------------------------------------------
  const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
  const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\u00a0/g, '&nbsp;');
  const isBlank = (s) => /^[ \t\r\n\f]*$/.test(s);
  const trimWs = (s) => s.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '');

  function openTag(node) {
    let s = '<' + node.localName;
    for (const a of Array.from(node.attributes)) {
      s += ' ' + a.name + (a.value === '' ? '' : '="' + escAttr(a.value) + '"');
    }
    return s + '>';
  }

  function fmt(node, depth, out) {
    const pad = '  '.repeat(depth);
    if (node.nodeType === 3) {
      const t = trimWs(node.nodeValue.replace(WS, ' '));
      if (t) out.push(pad + escText(t));
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    const svg = node.namespaceURI === SVG_NS;
    const open = openTag(node);
    if (VOID.has(tag) && !svg) { out.push(pad + open); return; }
    if (tag === 'pre' || tag === 'textarea') { out.push(pad + node.outerHTML); return; }
    const kids = Array.from(node.childNodes).filter((n) => n.nodeType === 1 || n.nodeType === 3);
    if (!kids.length) { out.push(svg ? pad + open.replace(/>$/, ' />') : pad + open + '</' + tag + '>'); return; }
    const hasText = kids.some((n) => n.nodeType === 3 && !isBlank(n.nodeValue));
    if (hasText) {
      const inner = trimWs(Array.from(node.childNodes).map((n) => {
        if (n.nodeType === 1) return n.outerHTML;
        if (n.nodeType === 3) return escText(n.nodeValue);
        return '';
      }).join('').replace(WS, ' '));
      out.push(pad + open + inner + '</' + tag + '>');
      return;
    }
    out.push(pad + open);
    kids.forEach((k) => fmt(k, depth + 1, out));
    out.push(pad + '</' + tag + '>');
  }

  function prettyHtml(root) {
    const out = [];
    fmt(root, 0, out);
    return out.join('\n');
  }

  function cleanAttrs(o, c) {
    for (const a of Array.from(c.attributes)) {
      const n = a.name.toLowerCase();
      if (n === 'class' || n === 'style' || n.indexOf('on') === 0 || n.indexOf('data-') === 0 || n.indexOf('_ng') === 0 ||
          n === 'nonce' || n === 'integrity' || n === 'crossorigin' || n === 'loading' || n === 'decoding' || n === 'fetchpriority') {
        c.removeAttribute(a.name);
      }
    }
    for (const n of ['src', 'href', 'poster', 'action', 'data', 'xlink:href']) {
      if (c.hasAttribute(n)) c.setAttribute(n, absUrl(c.getAttribute(n)));
    }
    if (c.localName === 'img' && o.currentSrc) {
      c.setAttribute('src', o.currentSrc);
      c.removeAttribute('srcset');
      c.removeAttribute('sizes');
    }
    if (c.hasAttribute('srcset')) {
      c.setAttribute('srcset', c.getAttribute('srcset').split(',').map((s) => {
        const p = s.trim().split(/\s+/);
        p[0] = absUrl(p[0]);
        return p.join(' ');
      }).join(', '));
    }
  }

  // ---------------------------------------------------------------------------
  // Main extraction
  // ---------------------------------------------------------------------------
  async function buildPayload(el) {
    const { list: sheets, skipped } = await getSheets();
    const rules = [];
    for (const s of sheets) walk(s.rules, [], s.base, rules, 0);

    const origList = [el, ...el.querySelectorAll('*')];
    const clone = el.cloneNode(true);
    const cloneList = [clone, ...clone.querySelectorAll('*')];
    const pairs = [];
    const dropped = new Set();
    for (let i = 0; i < origList.length; i++) {
      const o = origList[i];
      const c = cloneList[i];
      if (i > 0 && ((c.parentElement && dropped.has(c.parentElement)) || REMOVE_TAGS.has(o.localName))) { dropped.add(c); continue; }
      pairs.push({ o, c, cls: '' });
    }
    dropped.forEach((c) => c.remove());

    const counts = {};
    pairs.forEach((p, i) => {
      const tag = p.o.localName.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'el';
      if (i === 0) p.cls = tag + '-root';
      else { counts[tag] = (counts[tag] || 0) + 1; p.cls = tag + '-' + counts[tag]; }
    });
    const origToCls = new Map(pairs.map((p) => [p.o, p.cls]));

    const matchCache = new Map();
    const matchIn = (base) => {
      if (matchCache.has(base)) return matchCache.get(base);
      let res = [];
      try {
        if (el.matches(base)) res.push(el);
        res = res.concat(Array.from(el.querySelectorAll(base)));
      } catch (e) { res = []; }
      matchCache.set(base, res);
      return res;
    };

    // Authored width/height (computed sizes are pixel-locked, authored ones stay fluid).
    const authored = new Map();
    for (const r of rules) {
      if (r.chain.length) continue;
      const w = r.style.getPropertyValue('width');
      const hgt = r.style.getPropertyValue('height');
      if (!w && !hgt) continue;
      for (const sel of splitSelectors(r.selectorText)) {
        const ps = parseSel(sel);
        if (ps.suffix || !ps.base) continue;
        for (const m of matchIn(ps.base)) {
          if (!origToCls.has(m)) continue;
          const a = authored.get(m) || {};
          if (w) a.width = replaceVars(w, m);
          if (hgt) a.height = replaceVars(hgt, m);
          authored.set(m, a);
        }
      }
    }

    const used = new Set();
    const addBlock = (map, selector, body) => {
      let b = map.get(body);
      if (!b) { b = { sels: [], body }; map.set(body, b); }
      if (b.sels.indexOf(selector) === -1) b.sels.push(selector);
    };
    const bodyOf = (decls) => Array.from(decls, ([k, v]) => '  ' + k + ': ' + v + ';').join('\n');
    const emit = (map) => Array.from(map.values()).map((b) => b.sels.join(',\n') + ' {\n' + b.body + '\n}').join('\n\n');

    const sb = makeSandbox();
    const baseBlocks = new Map();
    try {
      for (const p of pairs) {
        const isRoot = p.o === el;
        const cs = getComputedStyle(p.o);
        const parentCs = isRoot ? null : getComputedStyle(p.o.parentElement);
        const decls = diffStyle(sb, p.o, cs, parentCs, isRoot, false);
        const a = authored.get(p.o) || {};
        const w = p.o.style && p.o.style.width ? p.o.style.width : a.width;
        const hgt = p.o.style && p.o.style.height ? p.o.style.height : a.height;
        if (w) decls.set('width', w);
        if (hgt) decls.set('height', hgt);
        if (decls.size) { addBlock(baseBlocks, '.' + p.cls, bodyOf(decls)); used.add(p.cls); }

        for (const pe of ['::before', '::after']) {
          let pcs;
          try { pcs = getComputedStyle(p.o, pe); } catch (e) { continue; }
          const content = pcs.getPropertyValue('content');
          if (!content || content === 'none' || content === 'normal') continue;
          const pd = diffStyle(sb, p.o, pcs, cs, false, true);
          if (pd.size) { addBlock(baseBlocks, '.' + p.cls + pe, bodyOf(pd)); used.add(p.cls); }
        }
      }
    } finally {
      sb.frame.remove();
    }

    // States and responsive rules
    const stateBlocks = new Map();
    const mediaMap = new Map();
    for (const r of rules) {
      const chain = r.chain;
      if (chain.length && chain.some((c) => /^@media[^{]*\bprint\b/i.test(c) && !/\bscreen\b/i.test(c))) continue;
      const key = chain.join(' >> ');
      for (const sel of splitSelectors(r.selectorText)) {
        const ps = parseSel(sel);
        if (!chain.length && !ps.suffix) continue;
        if (!ps.base || ps.base === '*') continue;
        for (const m of matchIn(ps.base)) {
          const cls = origToCls.get(m);
          if (!cls) continue;
          const body = declBlock(r.style, m, r.base);
          if (!body) continue;
          used.add(cls);
          const selector = '.' + cls + ps.suffix;
          if (!chain.length) addBlock(stateBlocks, selector, body);
          else {
            if (!mediaMap.has(key)) mediaMap.set(key, { chain, blocks: new Map() });
            addBlock(mediaMap.get(key).blocks, selector, body);
          }
        }
      }
    }

    let css = emit(baseBlocks);
    if (stateBlocks.size) css += (css ? '\n\n' : '') + '/* Interactive states */\n' + emit(stateBlocks);

    const indent = (t) => t.split('\n').map((l) => (l ? '  ' + l : l)).join('\n');
    const responsive = Array.from(mediaMap.values()).map(({ chain, blocks }) => {
      let text = emit(blocks);
      for (let i = chain.length - 1; i >= 0; i--) text = chain[i] + ' {\n' + indent(text) + '\n}';
      return text;
    }).join('\n\n');

    for (const p of pairs) {
      cleanAttrs(p.o, p.c);
      if (used.has(p.cls)) p.c.setAttribute('class', p.cls);
    }

    return {
      name: describe(el),
      tag: el.localName,
      html: prettyHtml(clone),
      css,
      responsive,
      url: location.href,
      title: document.title,
      nodes: pairs.length,
      skippedSheets: skipped
    };
  }
})();
