(() => {
  const $ = id => document.getElementById(id);
  let tabId, target, selectionRef, currentDocument, picking = false, latest, component, savedSnapshot, busy = false;
  function status(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }
  async function send(type, fields) {
    const response = await chrome.runtime.sendMessage({ type, ...fields });
    if (!response?.ok) throw new Error(response?.error?.message || '扩展没有响应');
    return response.result;
  }
  async function probe(method, args = {}) {
    if (tabId == null) throw new Error('请先打开一个网页');
    return send('agent', { method, args: { tabId, ...(target ? { target } : {}), ...args } });
  }
  function show(data) {
    latest = data;
    const { image, ...text } = data;
    $('result').textContent = JSON.stringify(text, null, 2);
    $('image').hidden = !image; if (image) $('image').src = 'data:image/png;base64,' + image;
    $('copy').disabled = false; $('download').disabled = false;
    $('resultSummary').textContent = data.pass !== undefined ? `${data.pass ? '通过' : '未通过'} · ${data.passed}/${data.total} 项` : data.outcome ? `操作结果：${data.outcome}` : data.findings ? `${data.findings.length} 条诊断证据` : data.truncated ? '已生成，内容达到节点上限，存在截断' : '已生成可导出的证据';
  }
  function renderSelection(data) {
    target = data ? { ref: data.ref } : null;
    $('selection').textContent = data ? data.selector : '在页面上点选一个元素';
    $('metrics').replaceChildren();
    if (data) for (const value of [`${data.rect.width} × ${data.rect.height}`, data.styles.display, data.styles['font-size']]) {
      const item = document.createElement('span'); item.className = 'metric'; item.textContent = value; $('metrics').appendChild(item);
    }
  }
  function reset() {
    target = null; selectionRef = null; currentDocument = null; savedSnapshot = null; component = null; latest = null; picking = false;
    $('pick').textContent = '选取元素'; renderSelection(null); $('diff').disabled = true; $('downloadComponent').disabled = true;
    $('copy').disabled = true; $('download').disabled = true; $('snapshotStatus').textContent = '还没有记录快照';
    $('result').textContent = '等待操作…'; $('image').hidden = true;
  }
  async function sync(force = false) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== tabId) {
      const old = tabId;
      if (old != null && picking) chrome.tabs.sendMessage(old, { action: 'stopPicking' }).catch(() => {});
      reset(); tabId = tab?.id;
    }
    $('pageInfo').textContent = tab?.url || '未打开网页';
    if (!tab || !/^(https?|file):/.test(tab.url || '')) return;
    const requestedTab = tabId;
    const data = await send('agent', { method: 'selected', args: { tabId: requestedTab } });
    if (requestedTab !== tabId) return;
    if (currentDocument && currentDocument !== data.page.documentId) reset();
    currentDocument = data.page.documentId;
    if (force || selectionRef !== data.element?.ref) { selectionRef = data.element?.ref; renderSelection(data.element); }
  }
  function bind(id, fn) { $(id).addEventListener('click', async () => {
    if (busy) return; busy = true; $(id).disabled = true; status('正在处理…');
    try { await sync(); await fn(); status('完成'); } catch (error) { status(error.message, true); } finally { $(id).disabled = false; busy = false; }
  }); }
  const parse = id => { try { return JSON.parse($(id).value); } catch { throw new Error('JSON 格式有误，请检查引号与逗号'); } };
  function download(name, value, type) {
    const url = URL.createObjectURL(new Blob([value], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b === button));
    document.querySelectorAll('.view').forEach(view => { view.hidden = view.id !== 'view-' + button.dataset.view; });
  }));
  bind('pick', async () => { await probe('selected'); const result = await chrome.tabs.sendMessage(tabId, { action: picking ? 'stopPicking' : 'startPicking' }); if (!result?.success) throw new Error('无法启动元素拾取'); picking = !picking; $('pick').textContent = picking ? '停止选取' : '选取元素'; });
  bind('refresh', () => sync(true));
  bind('locate', async () => { const data = await probe('select', { target: { selector: $('selector').value } }); selectionRef = data.ref; renderSelection(data); });
  bind('task', async () => show(await probe('task', { intent: $('intent').value })));
  bind('preview', async () => { show(await probe('preview', { changes: parse('changes') })); await sync(true); });
  bind('undo', async () => { show(await probe('undo')); await sync(true); });
  bind('assert', async () => show(await probe('assert', { checks: parse('designChecks') })));
  bind('capture', async () => show(await probe('capture')));
  bind('diagnose', async () => show(await probe('diagnose')));
  bind('measure', async () => show(await probe('measure', { other: { selector: $('other').value } })));
  bind('extract', async () => { component = await probe('extract'); show(component); $('downloadComponent').disabled = false; });
  bind('downloadComponent', async () => { if (!component) throw new Error('请先提取组件'); download('styleprobe-component.html', component.document, 'text/html'); });
  bind('snapshot', async () => { const data = await probe('snapshot'); savedSnapshot = data.snapshotId; $('diff').disabled = false; $('snapshotStatus').textContent = '已记录：' + data.page.timestamp; show(data); });
  bind('diff', async () => show(await probe('diff', { snapshotId: savedSnapshot })));
  bind('act', async () => show(await probe('act', { action: $('action').value, value: $('value').value, checks: parse('postconditions') })));
  bind('copy', () => navigator.clipboard.writeText(JSON.stringify(latest, null, 2)));
  bind('download', async () => download('styleprobe-evidence.json', JSON.stringify(latest, null, 2), 'application/json'));
  bind('connect', async () => { const data = await send('bridge', { action: 'connect', port: Number($('port').value), token: $('token').value }); $('connectionState').textContent = data.state; $('token').value = ''; });
  bind('disconnect', async () => { const data = await send('bridge', { action: 'disconnect' }); $('connectionState').textContent = data.state; });
  setInterval(async () => { if (busy || document.hidden) return; try { await sync(); const data = await send('bridge', { action: 'status' }); $('connectionState').textContent = data.state; } catch (error) { status(error.message, true); } }, 750);
  document.addEventListener('visibilitychange', () => { if (document.hidden && tabId != null && picking) { chrome.tabs.sendMessage(tabId, { action: 'stopPicking' }).catch(() => {}); picking = false; $('pick').textContent = '选取元素'; } });
  sync().catch(error => status(error.message, true));
})();
