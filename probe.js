/* StyleProbe runtime. All returned page content is untrusted evidence. */
(() => {
  'use strict';
  if (globalThis.__StyleProbe) return;
  const documentId = crypto.randomUUID();
  const refs = new Map(), ids = new WeakMap(), snapshots = new Map(), transactions = [];
  let selected = null, sequence = 0;
  const properties = ['display','position','box-sizing','width','height','min-width','max-width','min-height','max-height',
    'margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left',
    'border-top-width','border-right-width','border-bottom-width','border-left-width','border-radius','border-color','border-style',
    'font-family','font-size','font-weight','line-height','letter-spacing','text-align','white-space','color','background-color','background-image',
    'opacity','visibility','overflow','overflow-x','overflow-y','z-index','transform','filter','isolation','contain','pointer-events',
    'flex','flex-direction','flex-wrap','align-items','align-self','justify-content','gap','row-gap','column-gap',
    'grid-template-columns','grid-template-rows','box-shadow','object-fit','top','right','bottom','left'];
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
  const bounded = (n, fallback, max) => Number.isFinite(n) ? Math.min(max, Math.max(0, Math.floor(n))) : fallback;
  const internal = el => el.matches?.('[class*="css-inspector-overlay"],[class*="css-inspector-spacing-"]');
  function reference(el) {
    if (!ids.has(el)) {
      if (refs.size >= 3000) {
        for (const [key, node] of refs) if (!node.isConnected) refs.delete(key);
        if (refs.size >= 3000) fail('REFERENCE_LIMIT', 'Reload the page to start a new probe session.');
      }
      const id = `${documentId}:${++sequence}`;
      ids.set(el, id); refs.set(id, el);
    }
    return ids.get(el);
  }
  function resolve(target) {
    let el;
    if (target?.ref) {
      el = refs.get(target.ref);
      if (!el?.isConnected) fail('STALE_REFERENCE', 'Element was removed or belongs to a different document. Inspect again.');
    } else if (target?.selector) {
      let nodes;
      try { nodes = document.querySelectorAll(target.selector); } catch { fail('INVALID_SELECTOR', 'Invalid CSS selector.'); }
      if (nodes.length !== 1) fail('AMBIGUOUS_TARGET', `Selector must match exactly one element; found ${nodes.length}.`);
      el = nodes[0];
    } else {
      el = selected;
      if (!el?.isConnected) fail('NO_SELECTION', 'Select an element or supply an explicit target.');
    }
    if (internal(el)) fail('INVALID_TARGET', 'Probe overlays cannot be inspected.');
    return el;
  }
  function selector(el) {
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
    const parts = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      let part = node.localName;
      if (node.parentElement) part += `:nth-child(${Array.from(node.parentElement.children).indexOf(node) + 1})`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  }
  function rect(el) {
    const r = el.getBoundingClientRect();
    return Object.fromEntries(['x','y','width','height','top','right','bottom','left'].map(k => [k, Math.round(r[k] * 100) / 100]));
  }
  function styles(el) {
    const computed = getComputedStyle(el);
    return Object.fromEntries(properties.map(p => [p, computed.getPropertyValue(p)]));
  }
  function textOf(el) {
    if (el.matches('input,textarea,select,[contenteditable="true"]')) return '[editable content omitted]';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = '', node;
    while ((node = walker.nextNode()) && text.length < 500) {
      if (!node.parentElement.closest('script,style,input,textarea,select,[contenteditable="true"],[data-probe-private]')) text += node.textContent + ' ';
    }
    return text.replace(/\s+/g, ' ').trim().slice(0, 500);
  }
  function summary(el, full = true) {
    const s = styles(el), r = rect(el);
    const source = el.closest('[data-source-file]');
    return { ref: reference(el), selector: selector(el), tag: el.localName, id: el.id,
      classes: Array.from(el.classList).slice(0, 12), role: el.getAttribute('role'), label: el.getAttribute('aria-label')?.slice(0, 200),
      text: textOf(el), rect: r, visible: r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0,
      ...(full ? { styles: s } : {}),
      ...(source ? { sourceHint: { file: source.dataset.sourceFile, line: source.dataset.sourceLine || null, provenance: 'page-annotation' } } : {}) };
  }
  function page() { return { documentId, url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scrollX, scrollY }, timestamp: new Date().toISOString() }; }
  function inspect({ target, depth = 2, maxNodes = 30 } = {}) {
    const el = resolve(target), parents = [];
    for (let p = el.parentElement; p && parents.length < 5; p = p.parentElement) parents.push(summary(p));
    let count = 0;
    const limit = bounded(maxNodes, 30, 100), levels = bounded(depth, 2, 4);
    function tree(node, level) {
      if (count >= limit) return null;
      count++;
      const item = summary(node);
      if (level < levels) item.children = Array.from(node.children).filter(n => !internal(n)).map(n => tree(n, level + 1)).filter(Boolean);
      return item;
    }
    return { schemaVersion: 1, trust: 'untrusted-page-evidence', page: page(), element: summary(el), ancestors: parents,
      siblings: Array.from(el.parentElement?.children || []).filter(n => n !== el && !internal(n)).slice(0, 10).map(n => summary(n)),
      subtree: tree(el, 0), limits: { maxNodes: limit, depth: levels, truncated: count >= limit } };
  }
  function measure({ target, other }) {
    const a = rect(resolve(target)), b = rect(resolve(other));
    return { a, b, horizontalGap: Math.max(0, b.left - a.right, a.left - b.right), verticalGap: Math.max(0, b.top - a.bottom, a.top - b.bottom),
      edges: { top: b.top - a.top, right: a.right - b.right, bottom: a.bottom - b.bottom, left: b.left - a.left },
      overlap: { width: Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)), height: Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) } };
  }
  function preview({ target, changes }) {
    const el = resolve(target);
    if (!changes || Array.isArray(changes) || typeof changes !== 'object' || !Object.keys(changes).length || Object.keys(changes).length > 40) fail('INVALID_CHANGES', 'Supply 1–40 CSS property/value pairs.');
    for (const [key, value] of Object.entries(changes)) {
      if (!/^--[\w-]+$|^[a-z][a-z-]*$/.test(key) || (value !== null && (typeof value !== 'string' || value.length > 2000 || !CSS.supports(key, value)))) fail('INVALID_CSS', `Invalid CSS: ${key}`);
    }
    if (transactions.length >= 100) fail('TRANSACTION_LIMIT', 'Undo previews before applying more.');
    const tx = { id: crypto.randomUUID(), el, before: el.getAttribute('style'), changes };
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) el.style.removeProperty(key); else el.style.setProperty(key, value, 'important');
    }
    tx.after = el.getAttribute('style'); transactions.push(tx);
    return { transactionId: tx.id, element: summary(el), temporary: true };
  }
  function undo({ transactionId } = {}) {
    const tx = transactions.at(-1);
    if (!tx) fail('NO_TRANSACTION', 'No preview to undo.');
    if (transactionId && transactionId !== tx.id) fail('UNDO_ORDER', 'Undo previews in reverse order.');
    if (!tx.el.isConnected) fail('STALE_REFERENCE', 'Preview target was removed. Reload clears this session.');
    if (tx.el.getAttribute('style') !== tx.after) fail('STYLE_CONFLICT', 'Page styles changed since preview; refusing to overwrite newer changes.');
    if (tx.before === null) tx.el.removeAttribute('style'); else tx.el.setAttribute('style', tx.before);
    transactions.pop();
    return { undone: tx.id, element: summary(tx.el) };
  }
  function snapshot(args = {}) {
    const data = inspect(args), id = crypto.randomUUID();
    if (snapshots.size >= 30) snapshots.delete(snapshots.keys().next().value);
    snapshots.set(id, data);
    return { snapshotId: id, ...data };
  }
  function diff({ snapshotId, target }) {
    const before = snapshots.get(snapshotId);
    if (!before) fail('SNAPSHOT_NOT_FOUND', 'Snapshot expired or belongs to another document.');
    const after = inspect({ target: target || { ref: before.element.ref } });
    const changes = [];
    for (const group of ['rect','styles']) for (const [key, value] of Object.entries(before.element[group])) {
      if (value !== after.element[group][key]) changes.push({ field: `${group}.${key}`, before: value, after: after.element[group][key] });
    }
    for (const key of ['text','visible']) if (before.element[key] !== after.element[key]) changes.push({ field: key, before: before.element[key], after: after.element[key] });
    return { snapshotId, before: before.page, after: after.page, changed: changes.length > 0, changes };
  }
  const methods = { inspect, measure, preview, undo, snapshot, diff,
    selected: () => ({ page: page(), element: selected?.isConnected ? summary(selected) : null }),
    select: ({ target }) => { selected = resolve(target); return summary(selected); } };
  globalThis.__StyleProbe = { methods, select(el) { selected = el; return summary(el); }, resolve, summary, page, inspect, fail, properties, rect, styles };
  if (globalThis.chrome?.runtime?.onMessage) chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (request.type !== 'probe') return;
    Promise.resolve().then(() => {
      if (!Object.hasOwn(methods, request.method)) fail('UNKNOWN_METHOD', `Unknown probe method: ${request.method}`);
      return methods[request.method](request.args || {});
    }).then(result => respond({ ok: true, result }), error => respond({ ok: false, error: { code: error.code || 'PROBE_ERROR', message: error.message } }));
    return true;
  });
})();
