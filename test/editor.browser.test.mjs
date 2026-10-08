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

async function openEditor(text, serverOpts = {}, viewport = { width: 1100, height: 900 }) {
  const srv = await startServer(serverOpts);
  servers.push(srv);
  const ctx = await offlinePage(browser, srv.origin, { viewport });
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
  const imgs = await page.evaluate(() => [...document.querySelectorAll('.vditor-reset img')].map((i) => i.naturalWidth));
  assert.ok(imgs.length >= 2 && imgs.every((w) => w > 0), `images: ${imgs}`);

  const p = page.locator('.vditor-reset p', { hasText: 'Hard break above' });
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
  const p = page.locator('.vditor-reset p').first();
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

test('the enlarge button on an image or a diagram opens the viewer; markdown is unchanged', async () => {
  const text = await readFile(join(fixtures, 'sample.md'), 'utf8');
  const { page, norm } = await openEditor(text);
  await page.waitForFunction(() => document.querySelectorAll('.md-diagram-expand:not(.md-image-expand)').length === 2, null, { timeout: 20000 });
  // Clicking the image itself only places the cursor (Word-like); the corner button opens the viewer.
  const img = page.locator('.vditor-reset img').first();
  await img.click();
  assert.equal(await page.locator('.md-lightbox').count(), 0);
  // 16 px icons get no corner button (it would cover them); the right-click menu has View Large.
  await img.hover();
  assert.equal(await page.locator('.md-image-expand--visible').count(), 0);
  await img.click({ button: 'right' });
  await page.locator('.md-context-menu button', { hasText: 'View Large' }).click();
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

test('Word-like editing: no Markdown symbols, Ctrl+B bolds the selection and does not reach VS Code', async () => {
  const { page } = await openEditor('Hello world\n');
  await page.evaluate(() => {
    window.__forwarded = [];
    // VS Code's webview host listens on the window (bubble) and forwards keys to the workbench.
    window.addEventListener('keydown', (e) => window.__forwarded.push(`${e.ctrlKey ? 'C+' : ''}${e.key}`));
  });
  const p = page.locator('.vditor-reset p').first();
  await p.dblclick({ position: { x: 60, y: 8 } }); // selects "world"
  await page.keyboard.press('Control+b');
  await page.waitForFunction(() => document.querySelector('.vditor-reset b, .vditor-reset strong'), null, { timeout: 3000 });
  assert.equal(await page.locator('.vditor-reset b, .vditor-reset strong').innerText(), 'world');
  assert.doesNotMatch(await p.innerText(), /\*\*/, 'no ** shown');
  assert.ok(!(await page.evaluate(() => window.__forwarded)).includes('C+b'), 'Ctrl+B was not forwarded');
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'edit'), null, { timeout: 5000 });
  assert.equal((await posted(page, 'edit')).at(-1).text.trim(), 'Hello **world**');
  // Ctrl+S is still forwarded (VS Code saves).
  await page.keyboard.press('Control+s');
  assert.ok((await page.evaluate(() => window.__forwarded)).includes('C+s'));
  await page.close();
});

test('right-click on an image changes its display size', async () => {
  const md = 'Intro\n\n![red](images/red.png)\n\n![blue](images/blue%20dot.png "Blue")\n';
  const { page } = await openEditor(md);
  const edits = async () => (await posted(page, 'edit')).at(-1)?.text;
  await page.locator('.vditor-reset img').nth(1).click({ button: 'right' });
  await page.locator('.md-context-menu button', { hasText: 'Medium (50%)' }).click();
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'edit'));
  assert.match(await edits(), /!\[red\]\(images\/red\.png\)\n\n<img src="images\/blue%20dot\.png" alt="blue" title="Blue" width="50%">/);
  await page.waitForFunction(() => [...document.querySelectorAll('.vditor-reset img')].some((i) => i.getAttribute('width') === '50%'));
  const w = await page.evaluate(() => [...document.querySelectorAll('.vditor-reset img')].map((i) => i.getBoundingClientRect().width));
  assert.ok(w[1] > 0);
  // Back to the original size -> plain Markdown again.
  const n = (await posted(page, 'edit')).length;
  await page.locator('.vditor-reset img[width="50%"]').click({ button: 'right' });
  await page.locator('.md-context-menu button', { hasText: 'Original Size' }).click();
  await page.waitForFunction((n) => window.__posted.filter((m) => m.type === 'edit').length > n, n);
  assert.match(await edits(), /!\[blue\]\(images\/blue%20dot\.png "Blue"\)/);
  await page.close();
});

test('the outline highlights the section in view', async () => {
  const md = Array.from({ length: 12 }, (_, i) => `## Part ${i + 1}\n\n${'text '.repeat(200)}\n`).join('\n');
  const { page } = await openEditor(md);
  const active = () => page.evaluate(() => document.querySelector('.md-outline--active')?.textContent?.trim());
  await page.waitForFunction(() => document.querySelector('.md-outline--active'));
  assert.equal(await active(), 'Part 1');
  await page.evaluate(() => document.querySelectorAll('.vditor-reset h2')[7].scrollIntoView());
  await page.waitForFunction(() => document.querySelector('.md-outline--active')?.textContent?.trim() === 'Part 8', null, { timeout: 3000 });
  await page.close();
});

test('<img> inside a paragraph or table cell is drawn as an image and can be resized', async () => {
  const md = 'Text <img src="images/red.png" width="40"> more\n\n| a | b |\n|---|---|\n| ![blue](images/blue%20dot.png) | x |\n';
  const { page, norm } = await openEditor(md);
  await page.waitForFunction(() => document.querySelector('code.md-inline-img')?.style.backgroundImage);
  const box = await page.locator('code.md-inline-img').boundingBox();
  assert.ok(Math.abs(box.width - 40) < 1 && Math.abs(box.height - 40) < 1, JSON.stringify(box));
  // Drawing it does not change the Markdown.
  await page.evaluate(() => window.__send({ type: 'flush', requestId: 9 }));
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'flushed'));
  assert.equal((await posted(page, 'flushed'))[0].text, norm);
  // Resize the table image (a Markdown image inside a cell -> inline <img>, still drawn).
  await page.locator('td img').click({ button: 'right' });
  await page.locator('.md-context-menu button', { hasText: 'Large (75%)' }).click();
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'edit'));
  assert.match((await posted(page, 'edit')).at(-1).text, /\| <img src="images\/blue%20dot\.png" alt="blue" width="75%"> \| x \|/);
  await page.waitForFunction(() => document.querySelectorAll('code.md-inline-img').length === 2);
  // And it opens in the viewer.
  await page.locator('code.md-inline-img').nth(1).click({ button: 'right' });
  await page.locator('.md-context-menu button', { hasText: 'View Large' }).click();
  await page.waitForSelector('.md-lightbox img.md-lightbox__content');
  await page.close();
});

test('editor themes recolor the page and switch without touching the markdown', async () => {
  const text = await readFile(join(fixtures, 'sample.md'), 'utf8');
  const { page, errors } = await openEditor(text, { theme: 'warm' });
  const colors = () => page.evaluate(() => ({
    theme: document.body.dataset.mdTheme,
    dark: document.body.classList.contains('md-dark'),
    page: getComputedStyle(document.querySelector('.vditor-wysiwyg pre.vditor-reset')).backgroundColor,
    toolbar: getComputedStyle(document.querySelector('.vditor-toolbar')).backgroundColor,
    vditorDark: document.querySelector('.vditor').classList.contains('vditor--dark'),
  }));
  let c = await colors();
  assert.deepEqual(c, { theme: 'warm', dark: false, page: 'rgb(253, 249, 236)', toolbar: 'rgb(242, 234, 211)', vditorDark: false });

  await page.evaluate(() => window.__send({ type: 'theme', theme: 'dark' }));
  c = await colors();
  assert.deepEqual(c, { theme: 'dark', dark: true, page: 'rgb(30, 30, 30)', toolbar: 'rgb(42, 42, 43)', vditorDark: true });

  // `auto` goes back to VS Code's variables (none in this test page: light fallbacks).
  await page.evaluate(() => window.__send({ type: 'theme', theme: 'auto' }));
  c = await colors();
  assert.equal(c.theme, 'auto');
  assert.equal(c.vditorDark, false);
  assert.equal(await page.evaluate(() => document.body.style.getPropertyValue('--vscode-editor-background')), '');

  await page.click('[data-type="md-theme"]');
  assert.deepEqual((await posted(page, 'command')).map((m) => m.command), ['theme']);
  assert.deepEqual(await posted(page, 'edit'), [], 'switching themes is not an edit');
  assert.deepEqual(errors, []);
});

test('math and the other diagram kinds are drawn in the editor; the Markdown is unchanged', async () => {
  const text = await readFile(join(fixtures, 'diagrams.md'), 'utf8');
  const server = 'https://plantuml.example.invalid/plantuml';
  const { page, errors } = await openEditor(text, { plantumlServer: server });
  await page.waitForFunction(() => document.querySelectorAll('[data-md-diagram] > .md-diagram-out').length === 8, null, { timeout: 30000 });
  const drawn = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-md-diagram]')].map((e) => [
    e.dataset.mdDiagram,
    e.querySelector('.md-diagram-out > svg') ? 'svg' : e.querySelector('.md-diagram-out > img')?.getAttribute('src') ?? e.textContent.slice(0, 120),
  ])));
  for (const kind of ['graphviz', 'flowchart', 'echarts', 'mindmap', 'markmap', 'abc', 'smiles']) assert.equal(drawn[kind], 'svg', kind);
  assert.match(drawn.plantuml, /^https:\/\/plantuml\.example\.invalid\/plantuml\/svg\/~1/);
  assert.ok(await page.evaluate(() => document.querySelectorAll('.vditor-reset .katex').length) >= 2, 'math is drawn');
  // Diagrams get the enlarge button; nothing was written back.
  assert.equal(await page.evaluate(() => document.querySelectorAll('.md-diagram > .md-diagram-expand').length), 8);
  assert.deepEqual(await posted(page, 'edit'), []);
  // The unreachable PlantUML host is the only failed load.
  assert.deepEqual(errors.filter((e) => !/ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(e)), []);
});

test('the corner button of an image opens the viewer, which keeps the aspect ratio beyond 100 %', async () => {
  const { page } = await openEditor('# T\n\n![wide](images/wide.png)\n', {}, { width: 900, height: 500 });
  const img = page.locator('.vditor-reset img').first();
  await page.waitForFunction(() => document.querySelector('.vditor-reset img')?.naturalWidth > 0);
  await img.hover();
  await page.locator('.md-image-expand.md-image-expand--visible').click();
  await page.waitForSelector('.md-lightbox img.md-lightbox__content');
  assert.equal(await page.locator('.md-lightbox__title').innerText(), 'wide');
  for (let i = 0; i < 10; i++) await page.locator('.md-lightbox button[data-act="in"]').click();
  const r = await page.evaluate(() => {
    const e = document.querySelector('.md-lightbox__content');
    const b = e.getBoundingClientRect();
    return { zoom: document.querySelector('.md-lightbox__zoom').textContent, w: b.width, h: b.height };
  });
  assert.ok(parseInt(r.zoom) > 500, r.zoom);
  assert.ok(r.h > 500, 'taller than the webview');
  assert.ok(Math.abs(r.w / r.h - 4) < 0.01, `ratio ${r.w / r.h}`);
});

test('jsonc code blocks are highlighted, with comments in green', async () => {
  const md = '```jsonc\n{\n  // line comment\n  "a": 1, /* block */\n  "b": [true, null]\n}\n```\n';
  const { page } = await openEditor(md);
  await page.waitForFunction(() => document.querySelectorAll('.vditor-reset .hljs-comment').length === 2, null, { timeout: 10000 });
  const c = await page.evaluate(() => ({
    attrs: document.querySelectorAll('.vditor-reset .hljs-attr').length,
    comment: getComputedStyle(document.querySelector('.vditor-reset .hljs-comment')).color,
  }));
  assert.equal(c.attrs, 2);
  assert.equal(c.comment, 'rgb(0, 128, 0)');
  await page.evaluate(() => window.__send({ type: 'theme', theme: 'dark' }));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.vditor-reset .hljs-comment')).color === 'rgb(106, 153, 85)');
  await page.close();
});

test('read-only mode blocks typing, checkboxes and resizing, and can be switched off', async () => {
  const md = 'Hello world\n\n- [ ] task\n\n![red](images/red.png)\n';
  const { page } = await openEditor(md, { readOnly: true });
  const state = () => page.evaluate(() => ({
    body: document.body.classList.contains('md-readonly'),
    button: document.querySelector('[data-type="md-readonly"]').classList.contains('vditor-menu--current'),
    editable: document.querySelector('.vditor-wysiwyg > .vditor-reset').getAttribute('contenteditable'),
  }));
  assert.deepEqual(await state(), { body: true, button: true, editable: 'false' });

  const p = page.locator('.vditor-reset p', { hasText: 'Hello world' });
  await p.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' EDITED');
  await page.locator('.vditor-reset input[type="checkbox"]').click();
  await page.locator('.vditor-reset img').click({ button: 'right' });
  const menu = await page.locator('.md-context-menu button').allTextContents();
  assert.deepEqual(menu, ['View Large', 'Open Image File']);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__send({ type: 'flush', requestId: 3 }));
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'flushed'));
  assert.equal((await posted(page, 'flushed'))[0].text, undefined);
  assert.deepEqual(await posted(page, 'edit'), []);
  assert.equal(await page.locator('.vditor-reset input[type="checkbox"]').isChecked(), false);
  assert.doesNotMatch(await p.textContent(), /EDITED/);

  // The toolbar button asks the host, which answers with the new state.
  await page.click('[data-type="md-readonly"]');
  assert.deepEqual((await posted(page, 'command')).map((m) => m.command), ['readOnly']);
  await page.evaluate(() => window.__send({ type: 'readOnly', value: false }));
  await page.waitForFunction(() => !document.body.classList.contains('md-readonly'));
  assert.deepEqual(await state(), { body: false, button: false, editable: 'true' });
  await p.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' EDITED');
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'edit'), null, { timeout: 5000 });
  assert.match((await posted(page, 'edit')).at(-1).text, /Hello world EDITED/);
  await page.close();
});

test('scroll bars follow the editor theme', async () => {
  const { page } = await openEditor('# A\n', { theme: 'light' });
  const scheme = () => page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).colorScheme,
    thumb: getComputedStyle(document.body).getPropertyValue('--vscode-scrollbarSlider-background').trim(),
  }));
  assert.deepEqual(await scheme(), { html: 'light', thumb: 'rgba(100,100,100,.4)' });
  await page.evaluate(() => window.__send({ type: 'theme', theme: 'midnight' }));
  await page.waitForFunction(() => document.body.dataset.mdTheme === 'midnight');
  assert.deepEqual(await scheme(), { html: 'dark', thumb: 'rgba(121,121,121,.4)' });
  await page.close();
});

test('popovers sit above their block at any zoom and follow zoom changes; toolbar zoom control', async () => {
  const text = '# T\n\n' + 'para\n\n'.repeat(12) + '```mermaid\nflowchart TB\n    A[x] --> B[y]\n```\n\n'
    + 'para\n\n'.repeat(4) + '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n' + 'tail\n\n'.repeat(30);
  const { page } = await openEditor(text, {}, { width: 1100, height: 600 });
  await page.waitForFunction(() => document.querySelectorAll('.language-mermaid svg').length === 1, null, { timeout: 20000 });
  const level = () => page.locator('.vditor-toolbar .md-zoom-level').textContent();
  assert.equal(await level(), '100%');
  const gap = (sel) => page.evaluate((sel) => {
    const pop = document.querySelector('.vditor-wysiwyg > .vditor-panel--none').getBoundingClientRect();
    const box = document.querySelector(sel).getBoundingClientRect();
    return { below: box.top - pop.bottom, left: pop.left - box.left };
  }, sel);
  const check = async (sel, what) => {
    const g = await gap(sel);
    assert.ok(g.below >= -3 && g.below <= 6, `${what}: popover is ${g.below}px above the block`);
    assert.ok(Math.abs(g.left) <= 1, `${what}: popover is ${g.left}px off the block's left edge`);
  };
  const cases = [
    { sel: '.vditor-wysiwyg__block[data-type="code-block"] > pre.vditor-wysiwyg__pre', block: '.vditor-wysiwyg__block[data-type="code-block"]', open: (p) => p.locator('.vditor-wysiwyg__block[data-type="code-block"] .vditor-wysiwyg__preview').click() },
    { sel: '.vditor-reset table', block: '.vditor-reset table', open: (p) => p.locator('.vditor-reset td', { hasText: '3' }).click() },
  ];
  for (const c of cases) {
    for (const zoom of ['in', 'in', 'in', 'out', 'out', 'out', 'out', 'out']) {
      await page.locator('.vditor-reset p', { hasText: 'tail' }).first().click();
      await page.locator(c.block).scrollIntoViewIfNeeded();
      await page.evaluate(() => document.querySelector('.vditor-wysiwyg > .vditor-reset').scrollBy(0, -80));
      // Vditor places the popover a moment after the click, rewriting data-top.
      await page.evaluate(() => document.querySelector('.vditor-wysiwyg > .vditor-panel--none').setAttribute('data-top', 'stale'));
      await c.open(page);
      await page.waitForFunction(() => {
        const pop = document.querySelector('.vditor-wysiwyg > .vditor-panel--none');
        return pop.style.display === 'block' && pop.getAttribute('data-top') !== 'stale';
      });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await check(c.sel, `${c.sel} at ${await level()}`);
      // Zooming while the popover is open moves it with the block (Ctrl+wheel and the toolbar).
      await page.mouse.move(600, 300);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, zoom === 'in' ? -100 : 100);
      await page.keyboard.up('Control');
      await check(c.sel, `${c.sel} after Ctrl+wheel to ${await level()}`);
      await page.locator(`.vditor-toolbar button[data-type="md-zoom-${zoom}"]`).click();
      await check(c.sel, `${c.sel} after the toolbar button to ${await level()}`);
    }
  }
  await page.locator('.vditor-toolbar button[data-type="md-zoom-reset"]').click();
  assert.equal(await level(), '100%');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-zoom')), '1');
  await page.close();
});
