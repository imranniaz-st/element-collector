// Element Collector - service worker

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;

  // Cross-origin stylesheets cannot be read from the page, so the worker fetches the text.
  if (msg.type === 'FETCH_CSS') {
    fetch(msg.url, { credentials: 'omit' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((text) => sendResponse({ ok: true, text }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === 'SAVE_CAPTURE') {
    saveCapture(msg.payload, msg.rect, sender.tab)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  return false;
});

async function saveCapture(payload, rect, tab) {
  let thumb = null;
  try {
    thumb = await makeThumbnail(tab.windowId, rect);
  } catch (e) {
    console.warn('Thumbnail failed:', e);
  }
  const item = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    thumb,
    ...payload
  };
  const { items = [] } = await chrome.storage.local.get('items');
  items.unshift(item);
  await chrome.storage.local.set({ items });
}

async function makeThumbnail(windowId, rect) {
  const shot = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const blob = await (await fetch(shot)).blob();
  const bmp = await createImageBitmap(blob);

  const scale = bmp.width / rect.vw;
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(rect.vw, rect.x + rect.w);
  const y1 = Math.min(rect.vh, rect.y + rect.h);
  const sx = x0 * scale;
  const sy = y0 * scale;
  const sw = (x1 - x0) * scale;
  const sh = (y1 - y0) * scale;
  if (sw < 2 || sh < 2) return null;

  const k = Math.min(1, 480 / sw, 360 / sh);
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, h);
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });

  const bytes = new Uint8Array(await out.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return 'data:image/jpeg;base64,' + btoa(bin);
}
