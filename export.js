// Element Collector - export helpers (shared by the editor)
(() => {
  const BPQ = { tablet: '(max-width: 900px)', mobile: '(max-width: 480px)' };

  // ---------------------------------------------------------------------------
  // Edit overrides -> CSS. Keys are "desktop" | "tablet" | "mobile", optionally ":hover" / ":focus" / ":active"
  // ---------------------------------------------------------------------------
  function editsCss(f, mode) {
    const exp = mode === 'export';
    const sel = (e, st) => (exp ? 'body .ec-' + e + '.ec-' + e + '.ec-' + e : 'body [data-eid="' + e + '"]') + (st ? ':' + st : '');
    const bang = exp ? '' : ' !important';
    const parts = { desktop: '', tablet: '', mobile: '' };
    for (const [eid, m] of Object.entries(f.edits || {})) {
      for (const [key, d] of Object.entries(m)) {
        const [bp, st] = key.split(':');
        const decl = Object.entries(d).map(([k, v]) => k + ': ' + v + bang + ';').join(' ');
        if (decl && parts[bp] != null) parts[bp] += '  ' + sel(eid, st) + ' { ' + decl + ' }\n';
      }
    }
    let css = parts.desktop;
    if (parts.tablet) css += '@media ' + BPQ.tablet + ' {\n' + parts.tablet + '}\n';
    if (parts.mobile) css += '@media ' + BPQ.mobile + ' {\n' + parts.mobile + '}\n';
    return css;
  }

  // Clean, shippable HTML + CSS for a frame (no editor attributes).
  function cleanFrame(f) {
    const t = document.createElement('template');
    t.innerHTML = f.html;
    t.content.querySelectorAll('[data-eid]').forEach((el) => {
      const id = el.getAttribute('data-eid');
      if (f.edits && f.edits[id]) el.classList.add('ec-' + id);
      el.removeAttribute('data-eid');
    });
    const css = [
      f.bg ? 'body { background: ' + f.bg + '; }' : '',
      f.css, f.responsive, editsCss(f, 'export')
    ].filter((s) => s && s.trim()).join('\n\n');
    return { html: t.innerHTML.trim(), css: css.trim() };
  }

  const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function standalone(f) {
    const c = cleanFrame(f);
    return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' +
      escHtml(f.name) + '</title>\n<style>\nbody { margin: 0; }\n' + c.css + '\n</style>\n</head>\n<body>\n' + c.html + '\n</body>\n</html>\n';
  }

  function snippet(f) {
    const c = cleanFrame(f);
    return (c.css ? '<style>\n' + c.css + '\n</style>\n\n' : '') + c.html;
  }

  // ---------------------------------------------------------------------------
  // HTML -> JSX
  // ---------------------------------------------------------------------------
  const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'area', 'col', 'embed', 'track', 'wbr']);
  const ATTR = { class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength', colspan: 'colSpan', rowspan: 'rowSpan', srcset: 'srcSet', autocomplete: 'autoComplete', crossorigin: 'crossOrigin', contenteditable: 'contentEditable', spellcheck: 'spellCheck', autofocus: 'autoFocus', 'accept-charset': 'acceptCharset' };
  const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  function toJsx(html, base) {
    const t = document.createElement('template');
    t.innerHTML = html;
    const styleObj = (str) => '{' + str.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(':');
      const k = d.slice(0, i).trim();
      const v = d.slice(i + 1).trim();
      return (k.startsWith('--') ? JSON.stringify(k) : camel(k)) + ': ' + JSON.stringify(v);
    }).join(', ') + '}';

    function node(n, ind) {
      const pad = '  '.repeat(ind);
      if (n.nodeType === 3) {
        const s = n.nodeValue.replace(/\s+/g, ' ').trim();
        return s ? pad + s.replace(/[{}<>]/g, (c) => "{'" + c + "'}") + '\n' : '';
      }
      if (n.nodeType !== 1) return '';
      const tag = n.localName;
      if (tag === 'script') return '';
      let attrs = '';
      for (const a of Array.from(n.attributes)) {
        if (/^on/i.test(a.name)) continue;
        let name = ATTR[a.name] || (a.name.indexOf('-') > 0 && !/^(data|aria)-/.test(a.name) ? camel(a.name) : a.name);
        if (a.name === 'xlink:href') name = 'xlinkHref';
        if (a.name === 'style') { attrs += ' style={' + styleObj(a.value) + '}'; continue; }
        attrs += a.value === '' && ['disabled', 'checked', 'required', 'hidden', 'autofocus', 'readonly'].includes(a.name)
          ? ' ' + name
          : ' ' + name + '=' + JSON.stringify(a.value);
      }
      if (VOID.has(tag)) return pad + '<' + tag + attrs + ' />\n';
      const kids = Array.from(n.childNodes).map((c) => node(c, ind + 1)).join('');
      if (!kids.trim()) return pad + '<' + tag + attrs + ' />\n';
      return pad + '<' + tag + attrs + '>\n' + kids + pad + '</' + tag + '>\n';
    }

    return Array.from(t.content.childNodes).map((c) => node(c, base || 0)).join('').replace(/\s+$/, '');
  }

  function componentName(name) {
    const s = String(name || 'Element').replace(/[^a-z0-9]+/gi, ' ').trim().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    return /^[A-Za-z]/.test(s) ? s : 'C' + s;
  }

  function reactFiles(f) {
    const c = cleanFrame(f);
    const name = componentName(f.name);
    const jsx = "import './" + name + ".css';\n\nexport default function " + name + "() {\n  return (\n    <>\n" +
      toJsx(c.html, 3) + '\n    </>\n  );\n}\n';
    return [{ name: name + '.jsx', data: jsx }, { name: name + '.css', data: c.css + '\n' }];
  }

  // ---------------------------------------------------------------------------
  // ZIP (store only)
  // ---------------------------------------------------------------------------
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  function zip(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  // ---------------------------------------------------------------------------
  // DOM -> SVG (real vector rects + text, layers named after elements). Pastes straight into Figma.
  // ---------------------------------------------------------------------------
  function toSvg(doc) {
    const win = doc.defaultView;
    const W = Math.ceil(doc.documentElement.scrollWidth);
    const H = Math.ceil(doc.documentElement.scrollHeight);
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const num = (v) => Math.round(v * 100) / 100;
    const px = (v) => parseFloat(v) || 0;
    let defs = '';
    let uid = 0;

    function paint(c) {
      const m = String(c).match(/rgba?\(([^)]+)\)/);
      if (!m) return { fill: c === 'transparent' ? '#000' : c, op: c === 'transparent' ? 0 : 1 };
      const p = m[1].split(/[,\s/]+/).filter(Boolean);
      return { fill: 'rgb(' + p[0] + ',' + p[1] + ',' + p[2] + ')', op: p.length > 3 ? parseFloat(p[3]) : 1 };
    }

    function splitTop(s) {
      const out = [];
      let depth = 0;
      let cur = '';
      for (const ch of s) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    }

    function gradient(bi) {
      const m = bi.match(/^(repeating-)?linear-gradient\((.*)\)$/);
      if (!m) return null;
      const parts = splitTop(m[2]);
      let angle = 180;
      const first = parts[0];
      if (/^-?[\d.]+deg$/.test(first)) { angle = parseFloat(first); parts.shift(); }
      else if (/^to /.test(first)) {
        const map = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135, 'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315 };
        angle = map[first] != null ? map[first] : 180;
        parts.shift();
      }
      const stops = parts.map((p, i) => {
        const cm = p.match(/^(rgba?\([^)]+\)|#[0-9a-f]+|[a-z]+)\s*(-?[\d.]+%)?/i);
        if (!cm) return null;
        const c = paint(cm[1]);
        return { c, off: cm[2] ? parseFloat(cm[2]) / 100 : i / Math.max(1, parts.length - 1) };
      }).filter(Boolean);
      if (stops.length < 2) return null;
      const a = (angle * Math.PI) / 180;
      const sx = Math.sin(a);
      const cy = -Math.cos(a);
      const id = 'g' + (++uid);
      defs += '<linearGradient id="' + id + '" x1="' + num(0.5 - sx / 2) + '" y1="' + num(0.5 - cy / 2) + '" x2="' + num(0.5 + sx / 2) + '" y2="' + num(0.5 + cy / 2) + '">' +
        stops.map((s) => '<stop offset="' + num(s.off) + '" stop-color="' + s.c.fill + '" stop-opacity="' + s.c.op + '"/>').join('') + '</linearGradient>';
      return id;
    }

    function textSvg(node, cs) {
      const raw = node.nodeValue;
      if (!raw || !raw.trim()) return '';
      const re = /\S+/g;
      const range = doc.createRange();
      const words = [];
      let m;
      while ((m = re.exec(raw))) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const rc = range.getClientRects();
        if (rc.length) words.push({ t: m[0], l: rc[0].left, top: rc[0].top, h: rc[0].height });
      }
      const lines = [];
      for (const w of words) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.top - w.top) < w.h * 0.5) last.text += ' ' + w.t;
        else lines.push({ top: w.top, left: w.l, h: w.h, text: w.t });
      }
      const fs = px(cs.fontSize);
      const c = paint(cs.color);
      const tt = cs.textTransform;
      const deco = cs.textDecorationLine && cs.textDecorationLine !== 'none' ? ' text-decoration="' + cs.textDecorationLine + '"' : '';
      return lines.map((L) => {
        let t = L.text;
        if (tt === 'uppercase') t = t.toUpperCase();
        else if (tt === 'lowercase') t = t.toLowerCase();
        else if (tt === 'capitalize') t = t.replace(/\b\w/g, (x) => x.toUpperCase());
        return '<text x="' + num(L.left) + '" y="' + num(L.top + L.h * 0.79) + '" font-family="' + esc(cs.fontFamily.replace(/"/g, "'")) + '" font-size="' + fs +
          '" font-weight="' + cs.fontWeight + '" font-style="' + cs.fontStyle + '"' + (cs.letterSpacing !== 'normal' ? ' letter-spacing="' + px(cs.letterSpacing) + '"' : '') +
          deco + ' fill="' + c.fill + '" fill-opacity="' + c.op + '" xml:space="preserve">' + esc(t) + '</text>';
      }).join('');
    }

    function imgData(img) {
      try {
        const c = doc.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.toDataURL('image/png');
      } catch (e) { return img.currentSrc || img.src; }
    }

    function label(el) {
      const cls = (el.getAttribute('class') || '').trim().split(/\s+/)[0];
      return (el.localName + (cls ? '.' + cls : '')).replace(/[^a-z0-9._-]/gi, '_');
    }

    function walk(el) {
      const tag = el.localName;
      if (['script', 'style', 'head', 'meta', 'link', 'title', 'noscript', 'template'].includes(tag)) return '';
      const cs = win.getComputedStyle(el);
      if (cs.display === 'none') return '';
      const r = el.getBoundingClientRect();
      const x = r.left, y = r.top, w = r.width, h = r.height;
      let s = '';

      if (tag === 'svg') {
        const clone = el.cloneNode(true);
        clone.setAttribute('x', num(x)); clone.setAttribute('y', num(y));
        clone.setAttribute('width', num(w)); clone.setAttribute('height', num(h));
        if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        return new XMLSerializer().serializeToString(clone).replace(/currentColor/g, cs.color);
      }

      const rad = Math.min(px(cs.borderTopLeftRadius), w / 2, h / 2);
      const rx = rad ? ' rx="' + num(rad) + '"' : '';
      const geo = 'x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h) + '"' + rx;

      let filt = '';
      const sh = cs.boxShadow !== 'none' && cs.boxShadow.match(/^(rgba?\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/);
      if (sh) {
        const id = 'f' + (++uid);
        const p = paint(sh[1]);
        defs += '<filter id="' + id + '" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="' + sh[2] + '" dy="' + sh[3] + '" stdDeviation="' + num(sh[4] / 2) + '" flood-color="' + p.fill + '" flood-opacity="' + p.op + '"/></filter>';
        filt = ' filter="url(#' + id + ')"';
      }

      if (w > 0 && h > 0) {
        const bg = paint(cs.backgroundColor);
        if (bg.op > 0) s += '<rect ' + geo + ' fill="' + bg.fill + '" fill-opacity="' + bg.op + '"' + filt + '/>';
        const bi = cs.backgroundImage;
        const um = bi.match(/url\(["']?([^"')]+)["']?\)/);
        if (um) {
          s += '<image ' + geo.replace(rx, '') + ' href="' + esc(um[1]) + '" preserveAspectRatio="' + (cs.backgroundSize === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice') + '"/>';
        } else if (/gradient/.test(bi)) {
          const gid = gradient(bi);
          if (gid) s += '<rect ' + geo + ' fill="url(#' + gid + ')"/>';
        }

        const bw = ['Top', 'Right', 'Bottom', 'Left'].map((k) => (cs['border' + k + 'Style'] === 'none' ? 0 : px(cs['border' + k + 'Width'])));
        const bc = ['Top', 'Right', 'Bottom', 'Left'].map((k) => paint(cs['border' + k + 'Color']));
        if (bw[0] > 0 && bw.every((v) => v === bw[0])) {
          s += '<rect x="' + num(x + bw[0] / 2) + '" y="' + num(y + bw[0] / 2) + '" width="' + num(w - bw[0]) + '" height="' + num(h - bw[0]) + '"' + (rad ? ' rx="' + num(Math.max(0, rad - bw[0] / 2)) + '"' : '') +
            ' fill="none" stroke="' + bc[0].fill + '" stroke-opacity="' + bc[0].op + '" stroke-width="' + bw[0] + '"/>';
        } else {
          const sides = [[x, y, w, bw[0]], [x + w - bw[1], y, bw[1], h], [x, y + h - bw[2], w, bw[2]], [x, y, bw[3], h]];
          sides.forEach((q, i) => { if (bw[i] > 0) s += '<rect x="' + num(q[0]) + '" y="' + num(q[1]) + '" width="' + num(q[2]) + '" height="' + num(q[3]) + '" fill="' + bc[i].fill + '" fill-opacity="' + bc[i].op + '"/>'; });
        }
      }

      let kids = '';
      if (tag === 'img') {
        const par = rad ? ' clip-path="inset(0 round ' + num(rad) + 'px)"' : '';
        kids += '<image ' + geo.replace(rx, '') + ' href="' + esc(imgData(el)) + '" preserveAspectRatio="' + (cs.objectFit === 'contain' ? 'xMidYMid meet' : cs.objectFit === 'fill' ? 'none' : 'xMidYMid slice') + '"' + par + '/>';
      } else if (tag === 'input' || tag === 'textarea') {
        const val = el.value || el.getAttribute('placeholder') || '';
        if (val) {
          const fs = px(cs.fontSize);
          const c = paint(el.value ? cs.color : 'rgb(117,117,117)');
          kids += '<text x="' + num(x + px(cs.paddingLeft) + px(cs.borderLeftWidth)) + '" y="' + num(y + h / 2 + fs * 0.35) + '" font-family="' + esc(cs.fontFamily.replace(/"/g, "'")) + '" font-size="' + fs + '" fill="' + c.fill + '">' + esc(val) + '</text>';
        }
      } else {
        for (const n of Array.from(el.childNodes)) {
          if (n.nodeType === 1) kids += walk(n);
          else if (n.nodeType === 3) kids += textSvg(n, cs);
        }
      }

      if (!s && !kids) return '';
      let attrs = ' id="' + esc(label(el)) + '"';
      if (px(cs.opacity) < 1) attrs += ' opacity="' + cs.opacity + '"';
      if (cs.overflow !== 'visible' && w > 0 && h > 0) {
        const cid = 'c' + (++uid);
        defs += '<clipPath id="' + cid + '"><rect ' + geo + '/></clipPath>';
        attrs += ' clip-path="url(#' + cid + ')"';
      }
      return '<g' + attrs + '>' + s + kids + '</g>';
    }

    let root = '';
    const hb = paint(win.getComputedStyle(doc.documentElement).backgroundColor);
    if (hb.op > 0) root += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + hb.fill + '" fill-opacity="' + hb.op + '"/>';
    root += walk(doc.body);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '"><defs>' + defs + '</defs>' + root + '</svg>';
  }

  // ---------------------------------------------------------------------------
  // PNG via foreignObject (exact browser rendering; remote images/fonts may be missing)
  // ---------------------------------------------------------------------------
  function toPng(doc, scale) {
    scale = scale || 2;
    const W = Math.ceil(doc.documentElement.scrollWidth);
    const H = Math.ceil(doc.documentElement.scrollHeight);
    const html = new XMLSerializer().serializeToString(doc.documentElement);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><foreignObject width="100%" height="100%">' + html + '</foreignObject></svg>';
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = W * scale; c.height = H * scale;
        const ctx = c.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG failed'))), 'image/png');
      };
      img.onerror = () => reject(new Error('PNG render failed'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  window.ECX = { editsCss, cleanFrame, standalone, snippet, reactFiles, zip, toSvg, toPng };
})();
