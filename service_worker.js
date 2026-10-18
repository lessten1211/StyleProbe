/* Extension router. Every page operation has an explicit tab identity. */
chrome.action.onClicked.addListener(tab => chrome.sidePanel.open({ tabId: tab.id }).catch(console.error));
const contentFiles = ['probe.js', 'features/mobile-adapter/touch-defense.js', 'content_script.js'];
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
