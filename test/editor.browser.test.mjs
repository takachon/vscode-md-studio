// Drives the editor webview (Vditor + Mermaid) in Chromium with the extension's CSP and the
// host-side merge, checking acceptance criteria 1-3 and 5 at the webview level.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer } from './browser/server.mjs';
import { launch, offlinePage, fixtures } from './browser/util.mjs';
import { mergeEdit } from '../src/merge.ts';

const browser = await launch();
const servers = [];
after(async () => {
  await browser.close();
  for (const s of servers) s.close();
});

async function openEditor(text, serverOpts = {}) {
  const srv = await startServer(serverOpts);
  servers.push(srv);
  const ctx = await offlinePage(browser, srv.origin, { viewport: { width: 1100, height: 900 } });
  const { page } = ctx;
  await page.goto(`${srv.origin}/editor.html`);
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'ready'));
  await page.evaluate((t) => window.__send({ type: 'init', text: t, syncId: 1 }), text);
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'baseline'), null, { timeout: 20000 });
  const norm = await page.evaluate(() => window.__posted.find((m) => m.type === 'baseline').norm);
  return { ...ctx, norm };
}

const posted = (page, type) => page.evaluate((t) => window.__posted.filter((m) => m.type === t), type);

function changedLines(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) out.push(i);
  return out;
}

test('editing one paragraph changes only that line; diagrams, images, offline', async () => {
  const text = await readFile(join(fixtures, 'sample.md'), 'utf8');
  const { page, norm, external, errors } = await openEditor(text);
  assert.notEqual(norm, text, 'Lute normalises the sample (otherwise this test proves nothing)');
  assert.equal(mergeEdit(text, norm, norm), text);

  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'mermaidLoaded'), null, { timeout: 20000 });
  assert.equal((await posted(page, 'mermaidLoaded'))[0].version, '12.0.0');
  await page.waitForFunction(() => document.querySelectorAll('.language-mermaid svg').length === 2, null, { timeout: 20000 });
  const imgs = await page.evaluate(() => [...document.querySelectorAll('.vditor-ir img')].map((i) => i.naturalWidth));
  assert.ok(imgs.length >= 2 && imgs.every((w) => w > 0), `images: ${imgs}`);

  const p = page.locator('.vditor-ir pre.vditor-reset p', { hasText: 'Hard break above' });
  await p.click({ position: { x: 5, y: 30 } });
  await page.keyboard.press('End');
  await page.keyboard.type(' EDITED');
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'edit'), null, { timeout: 5000 });
  const edit = (await posted(page, 'edit')).at(-1);
  const merged = mergeEdit(text, norm, edit.text);
  const lines = changedLines(text, merged);
  assert.equal(lines.length, 1, `changed lines: ${lines}`);
  assert.match(merged.split('\n')[lines[0]], /Japanese\]\(#日本語の見出し\)\. EDITED$/);

  assert.deepEqual(external, []);
  assert.deepEqual(await page.evaluate(() => window.__csp), []);
  assert.deepEqual(errors.filter((e) => !/404/.test(e)), []);
  await page.close();
});

test('update replaces content and re-sends a baseline; flush returns the current text', async () => {
  const { page } = await openEditor('# One\n');
  await page.evaluate(() => window.__send({ type: 'update', text: '# Two\n\nbody\n', syncId: 2 }));
  await page.waitForFunction(() => window.__posted.filter((m) => m.type === 'baseline').length === 2);
  const b = (await posted(page, 'baseline')).at(-1);
  assert.equal(b.syncId, 2);
  assert.match(b.norm, /# Two/);
  await page.evaluate(() => window.__send({ type: 'flush', requestId: 7 }));
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'flushed'));
  const f = (await posted(page, 'flushed'))[0];
  assert.equal(f.requestId, 7);
  assert.equal(f.syncId, 2);
  assert.match(f.text, /body/);
  await page.close();
});

test('a different mermaid.min.js is used when configured', async () => {
  // Vditor ships its own (older) Mermaid; use it as the "local file".
  const md = '```mermaid\nflowchart LR\n  A --> B\n```\n';
  const { page } = await openEditor(md, { mermaidUrl: '/node_modules/vditor/dist/js/mermaid/mermaid.min.js' });
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'mermaidLoaded'), null, { timeout: 20000 });
  const v = (await posted(page, 'mermaidLoaded'))[0].version;
  assert.match(v, /^11\./);
  await page.waitForFunction(() => document.querySelectorAll('.language-mermaid svg').length === 1, null, { timeout: 20000 });
  await page.close();
});

test('mermaid errors are shown in place', async () => {
  const { page } = await openEditor('```mermaid\nflowchart LR\n  A -->\n```\n');
  await page.waitForSelector('.md-studio-mermaid-error', { timeout: 20000 });
  await page.close();
});

test('Ctrl+wheel zooms the document and reports the level', async () => {
  const { page } = await openEditor('# Zoom\n\ntext\n');
  const p = page.locator('.vditor-ir pre.vditor-reset p').first();
  const before = (await p.boundingBox()).height;
  await p.hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  const zoom = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-zoom'));
  assert.equal(Number(zoom), 1.21);
  assert.ok((await p.boundingBox()).height > before * 1.15);
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'zoom'));
  assert.equal((await posted(page, 'zoom')).at(-1).value, 1.21);
  await page.close();
});

test('clicking an image or the diagram button opens the viewer; markdown is unchanged', async () => {
  const text = await readFile(join(fixtures, 'sample.md'), 'utf8');
  const { page, norm } = await openEditor(text);
  await page.waitForFunction(() => document.querySelectorAll('.md-diagram-expand').length === 2, null, { timeout: 20000 });
  await page.locator('.vditor-ir img').first().click();
  await page.waitForSelector('.md-lightbox img.md-lightbox__content');
  assert.match(await page.locator('.md-lightbox__title').innerText(), /red/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.md-lightbox').count(), 0);

  const diagram = page.locator('.language-mermaid[data-processed="true"]').first();
  await diagram.hover();
  await diagram.locator('.md-diagram-expand').click();
  await page.waitForSelector('.md-lightbox svg.md-lightbox__content');
  await page.locator('.md-lightbox button[data-act="in"]').click();
  await page.locator('.md-lightbox button[data-act="close"]').click();
  assert.equal(await page.locator('.md-lightbox').count(), 0);

  await page.evaluate(() => window.__send({ type: 'flush', requestId: 1 }));
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'flushed'));
  assert.equal((await posted(page, 'flushed'))[0].text, norm);
  await page.close();
});
