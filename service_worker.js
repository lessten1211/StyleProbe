/* Extension router. Every page operation has an explicit tab identity. */
chrome.action.onClicked.addListener(tab => chrome.sidePanel.open({ tabId: tab.id }).catch(console.error));
const contentFiles = ['probe.js', 'workflows.js', 'features/mobile-adapter/touch-defense.js', 'content_script.js'];
async function ensureProbe(tabId) {
  if (!Number.isInteger(tabId)) throw new Error('An explicit integer tabId is required.');
  const tab = await chrome.tabs.get(tabId);
  if (!/^(https?|file):/.test(tab.url || '')) throw new Error('This browser page cannot be inspected.');
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'probe', method: 'selected' });
    if (!pong?.ok) throw new Error('Probe not ready');
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: contentFiles });
  }
}
async function dispatch(method, args = {}) {
  if (method === 'list_tabs') {
    const tabs = await chrome.tabs.query({});
    return tabs.filter(t => /^(https?|file):/.test(t.url || '')).map(t => ({ tabId: t.id, windowId: t.windowId, title: t.title, url: t.url, active: t.active }));
  }
  if (method === 'capture') return capture(args);
  const { tabId, ...parameters } = args;
  await ensureProbe(tabId);
  const response = await chrome.tabs.sendMessage(tabId, { type: 'probe', method, args: parameters });
  if (!response?.ok) throw Object.assign(new Error(response?.error?.message || 'No probe response'), { code: response?.error?.code });
  return response.result;
}
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (request.type === 'probe') return;
  if (request.action === 'forwardToPanel') {
    if (sender.tab?.id == null) return;
    chrome.storage.session.set({ [`selection:${sender.tab.id}`]: { data: request.data, timestamp: Date.now(), documentId: sender.documentId } }).then(() => respond({ success: true }));
    return true;
  }
  if (request.type === 'agent') {
    dispatch(request.method, request.args).then(result => respond({ ok: true, result }), error => respond({ ok: false, error: { code: error.code || 'ROUTING_ERROR', message: error.message } }));
    return true;
  }
});
chrome.tabs.onRemoved.addListener(tabId => chrome.storage.session.remove(`selection:${tabId}`));
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === 'loading') chrome.storage.session.remove(`selection:${tabId}`); });

async function capture({ tabId, target }) {
  const tab = await chrome.tabs.get(tabId);
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (active?.id !== tabId) throw new Error('Activate the requested tab before capturing it.');
  const data = target ? await dispatch('inspect', { tabId, target, depth: 0, maxNodes: 1 }) : await dispatch('selected', { tabId });
  const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const [nowActive] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  const current = await dispatch('selected', { tabId });
  if (nowActive?.id !== tabId || current.page.documentId !== data.page.documentId) throw new Error('Tab changed during capture; retry.');
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const scaleX = bitmap.width / data.page.viewport.width, scaleY = bitmap.height / data.page.viewport.height;
  const r = target ? data.element.rect : { x: 0, y: 0, width: data.page.viewport.width, height: data.page.viewport.height };
  const x = Math.max(0, r.x), y = Math.max(0, r.y), width = Math.min(r.x + r.width, data.page.viewport.width) - x, height = Math.min(r.y + r.height, data.page.viewport.height) - y;
  if (width <= 0 || height <= 0) { bitmap.close(); throw new Error('Element is outside the viewport. Scroll it into view first.'); }
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scaleX)), Math.max(1, Math.round(height * scaleY)));
  canvas.getContext('2d').drawImage(bitmap, x * scaleX, y * scaleY, width * scaleX, height * scaleY, 0, 0, canvas.width, canvas.height); bitmap.close();
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  if (bytes.length > 7 * 1024 * 1024) throw new Error('Capture too large. Capture a smaller region.');
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { image: btoa(binary), mimeType: 'image/png', page: data.page, bounds: { x, y, width, height }, clipped: width !== r.width || height !== r.height };
}
let socket, heartbeat, connectionState = 'disconnected';
async function connectBridge() {
  const { bridgeConfig: config } = await chrome.storage.local.get('bridgeConfig');
  if (!config?.enabled || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  connectionState = 'connecting';
  const ws = new WebSocket(`ws://127.0.0.1:${config.port}/probe`); socket = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token: config.token }));
  ws.onmessage = async ({ data }) => {
    let request;
    try { request = JSON.parse(data); } catch { return; }
    if (request.type === 'ready') { connectionState = 'connected'; clearInterval(heartbeat); heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' })); }, 20000); return; }
    if (!request.id) return;
    try {
      const result = request.method === 'capture' ? await capture(request.args) : await dispatch(request.method, request.args);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: request.id, ok: true, result }));
    } catch (error) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: request.id, ok: false, error: { code: error.code || 'EXTENSION_ERROR', message: error.message } })); }
  };
  ws.onclose = () => { if (socket !== ws) return; clearInterval(heartbeat); connectionState = 'disconnected'; socket = null; chrome.alarms.create('bridge-reconnect', { delayInMinutes: 1 }); };
  ws.onerror = () => { connectionState = 'connection failed'; };
}
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (request.type !== 'bridge') return;
  (async () => {
    if (request.action === 'connect') {
      const port = Number(request.port), token = request.token;
      if (!Number.isInteger(port) || port < 1024 || port > 65535 || typeof token !== 'string' || token.length < 24) throw new Error('Use a port from 1024–65535 and the pairing token (at least 24 characters).');
      await chrome.storage.local.set({ bridgeConfig: { port, token, enabled: true } });
      const old = socket; socket = null; old?.close(); clearInterval(heartbeat);
      await connectBridge();
    } else if (request.action === 'disconnect') {
      await chrome.storage.local.remove('bridgeConfig'); await chrome.alarms.clear('bridge-reconnect');
      const old = socket; socket = null; old?.close(); clearInterval(heartbeat); connectionState = 'disconnected';
    }
    return { state: connectionState };
  })().then(result => respond({ ok: true, result }), error => respond({ ok: false, error: { message: error.message } }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'bridge-reconnect') connectBridge(); });
chrome.runtime.onStartup.addListener(connectBridge);
connectBridge();
