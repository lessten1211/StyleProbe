import { test, expect } from '@playwright/test';
import path from 'node:path';
const root = path.resolve('.');
const fixture = `<style>.row{display:flex;gap:20px}.card{width:120px;height:80px;box-sizing:border-box;padding:10px;background:rgb(255,0,0)}</style>
<div class="row" data-source-file="src/Card.tsx" data-source-line="12"><article id="a" class="card" style="color: blue !important"><h2>Alpha</h2></article><article id="b" class="card">Beta</article></div><input id="secret" type="password" value="never-export">`;
export async function setup(page) { await page.route('http://localhost:4173/**', route => route.fulfill({ contentType: 'text/html', body: fixture })); await page.goto('http://localhost:4173/'); await page.addScriptTag({ path: path.join(root, 'probe.js') }); }
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
