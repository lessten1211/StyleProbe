import { test, expect } from '@playwright/test';
import path from 'node:path';
const root = path.resolve('.');
const fixture = `<style>.row{display:flex;gap:20px}.card{width:120px;height:80px;box-sizing:border-box;padding:10px;background:rgb(255,0,0)}</style>
<div class="row" data-source-file="src/Card.tsx" data-source-line="12"><article id="a" class="card" style="color: blue !important"><h2>Alpha</h2></article><article id="b" class="card">Beta</article></div><input id="secret" type="password" value="never-export">`;
export async function setup(page) { await page.route('http://localhost:4173/**', route => route.fulfill({ contentType: 'text/html', body: fixture })); await page.goto('http://localhost:4173/'); await page.addScriptTag({ path: path.join(root, 'probe.js') }); await page.addScriptTag({ path: path.join(root, 'workflows.js') }); }
export async function call(page, method, args = {}) { return page.evaluate(({ method, args }) => globalThis.__StyleProbe.methods[method](args), { method, args }); }
test.beforeEach(async ({ page }) => setup(page));
test('context, exact spacing, source hints and bounded tree', async ({ page }) => {
  const data = await call(page, 'inspect', { target: { selector: '#a' }, maxNodes: 1 });
  expect(data.element.styles['background-color']).toBe('rgb(255, 0, 0)');
  expect(data.element.sourceHint.file).toBe('src/Card.tsx');
  expect(data.siblings[0].id).toBe('b');
  expect(data.subtree.children).toEqual([]);
  expect((await call(page, 'measure', { target: { selector: '#a' }, other: { selector: '#b' } })).horizontalGap).toBe(20);
  expect(JSON.stringify(await call(page, 'inspect', { target: { selector: '#secret' } }))).not.toContain('never-export');
});
test('references fail after removal and ambiguous selectors never pick arbitrary elements', async ({ page }) => {
  const data = await call(page, 'inspect', { target: { selector: '#a' } });
  await page.locator('#a').evaluate(el => el.remove());
  await expect(call(page, 'inspect', { target: { ref: data.element.ref } })).rejects.toThrow('Element was removed');
  await expect(call(page, 'inspect', { target: { selector: 'div' } })).resolves.toBeDefined();
  await expect(call(page, 'inspect', { target: { selector: '*' } })).rejects.toThrow('exactly one');
});
test('nested previews restore original inline style exactly and detect conflicts', async ({ page }) => {
  const before = await page.locator('#a').getAttribute('style');
  const first = await call(page, 'preview', { target: { selector: '#a' }, changes: { color: 'green' } });
  await call(page, 'preview', { target: { selector: '#a' }, changes: { color: 'purple', width: '150px' } });
  await expect(call(page, 'undo', { transactionId: first.transactionId })).rejects.toThrow('reverse order');
  await call(page, 'undo'); await call(page, 'undo');
  expect(await page.locator('#a').getAttribute('style')).toBe(before);
  await call(page, 'preview', { target: { selector: '#a' }, changes: { color: 'green' } });
  await page.locator('#a').evaluate(el => el.style.height = '90px');
  await expect(call(page, 'undo')).rejects.toThrow('refusing to overwrite');
});
test('snapshots verify observed geometry changes', async ({ page }) => {
  const shot = await call(page, 'snapshot', { target: { selector: '#a' } });
  await call(page, 'preview', { target: { selector: '#a' }, changes: { width: '150px' } });
  const result = await call(page, 'diff', { snapshotId: shot.snapshotId });
  expect(result.changes).toContainEqual({ field: 'rect.width', before: 120, after: 150 });
});
test('different documents cannot share selection or references', async ({ page, context }) => {
  const selected = await call(page, 'select', { target: { selector: '#a' } });
  const other = await context.newPage(); await setup(other);
  expect((await call(other, 'selected')).element).toBeNull();
  await expect(call(other, 'preview', { target: { ref: selected.ref }, changes: { width: '200px' } })).rejects.toThrow('different document');
  await page.reload(); await page.addScriptTag({ path: path.join(root, 'probe.js') });
  await expect(call(page, 'inspect', { target: { ref: selected.ref } })).rejects.toThrow('different document');
});
test('task bundle captures intent and diagnostics without claiming source recovery', async ({ page }) => {
  const bundle = await call(page, 'task', { target: { selector: '#a' }, intent: 'Align the two cards' });
  expect(bundle.intent).toBe('Align the two cards'); expect(bundle.context.element.id).toBe('a');
  expect(bundle.diagnosis.hitTest).toBeDefined();
});
test('design checks distinguish exact styles, tolerance and gap failures', async ({ page }) => {
  const checks = [{ kind: 'rect', property: 'width', equals: 121, tolerance: 1 }, { kind: 'style', property: 'background-color', equals: 'rgb(255, 0, 0)' }, { kind: 'gap', property: 'horizontalGap', other: { selector: '#b' }, equals: 20 }];
  expect((await call(page, 'assert', { target: { selector: '#a' }, checks })).pass).toBe(true);
  checks[0].equals = 130;
  const failed = await call(page, 'assert', { target: { selector: '#a' }, checks });
  expect(failed.pass).toBe(false); expect(failed.results[0].actual).toBe(120);
});
test('diagnostics identify clipping, overflow and center obstruction with evidence', async ({ page }) => {
  await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<div id="clip" style="position:relative;overflow:hidden;width:100px;height:50px"><button id="covered" style="width:150px;height:80px">Button</button><div id="blocker" style="position:absolute;inset:0;z-index:3;background:red"></div></div>'); });
  const data = await call(page, 'diagnose', { target: { selector: '#covered' } });
  expect(data.findings.some(f => f.kind === 'clipping-ancestor')).toBe(true);
  expect(data.findings.some(f => f.kind === 'center-covered' && f.evidence.hit.id === 'blocker')).toBe(true);
  const parent = await call(page, 'diagnose', { target: { selector: '#clip' } });
  expect(parent.findings.some(f => f.kind === 'overflow')).toBe(true);
});
test('component extraction is scoped, bounded, inert and renders its exported geometry', async ({ page, context }) => {
  await page.locator('#a').evaluate(el => { el.insertAdjacentHTML('beforeend', '<input value="secret"><img src="https://example.com/p.png" onerror="alert(1)"><script>/* private script */</script>'); });
  const data = await call(page, 'extract', { target: { selector: '#a' } });
  expect(data.html).not.toContain('onerror'); expect(data.html).not.toContain('secret'); expect(data.html).not.toContain('<script');
  expect(data.assets).toContainEqual({ type: 'image', url: 'https://example.com/p.png' });
  const preview = await context.newPage(); await preview.route('**/p.png', route => route.abort()); await preview.setContent(data.document);
  expect(await preview.locator('article').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(120);
  expect((await call(page, 'extract', { target: { selector: '#a' }, maxNodes: 1 })).truncated).toBe(true);
});
test('actions verify state changes, report timeouts, and validate before mutation', async ({ page }) => {
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<button id="actionButton" aria-expanded="false">Open</button><input id="field"><span id="output"></span>');
    document.querySelector('#actionButton').onclick = e => setTimeout(() => e.target.setAttribute('aria-expanded', 'true'), 120);
    document.querySelector('#field').oninput = e => document.querySelector('#output').textContent = e.target.value;
  });
  const click = await call(page, 'act', { target: { selector: '#actionButton' }, action: 'click', checks: [{ kind: 'attribute', property: 'aria-expanded', equals: 'true' }] });
  expect(click.verified).toBe(true);
  const fill = await call(page, 'act', { target: { selector: '#field' }, action: 'fill', value: 'hello', checks: [{ target: { selector: '#output' }, kind: 'text', equals: 'hello' }] });
  expect(fill.outcome).toBe('passed');
  const timeout = await call(page, 'act', { target: { selector: '#field' }, action: 'fill', value: 'hello', timeoutMs: 50, checks: [{ target: { selector: '#output' }, kind: 'text', equals: 'missing' }] });
  expect(timeout.outcome).toBe('timeout'); expect(timeout.dispatched).toBe(true); expect(timeout.verified).toBe(false);
  await expect(call(page, 'act', { target: { selector: '#field' }, action: 'fill', value: 'should not apply', checks: [{ kind: 'rect', property: 'typo', equals: 5 }] })).rejects.toThrow('Unknown rect');
  expect(await page.locator('#field').inputValue()).toBe('hello');
});
