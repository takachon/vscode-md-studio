// Drives the exporter webview in Chromium like the extension does and checks acceptance criterion 4:
// no <script>, all images as data URIs, all diagrams as SVG, every in-page link has a target,
// and the result renders with the network cut off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './browser/server.mjs';
import { launch, offlinePage, fixtures, readFixtureImages } from './browser/util.mjs';
import { exportDocument } from '../src/html.ts';

let srv, browser;
before(async () => {
  srv = await startServer();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  srv?.close();
});

async function runExport(markdown, mermaidConfig) {
  if (mermaidConfig) {
    srv.close();
    srv = await startServer({ mermaidConfig });
  }
  const { page, external, errors } = await offlinePage(browser, srv.origin);
  await page.goto(`${srv.origin}/exporter.html`);
  await page.waitForFunction(() => window.__posted.some((m) => m.type === 'ready'));
  await page.evaluate((md) => window.__send({ type: 'render', markdown: md, title: 't' }), markdown);
  await page.waitForFunction(() => window.__posted.some((m) => ['needImages', 'done', 'failed'].includes(m.type)), null, { timeout: 30000 });
  const need = await page.evaluate(() => window.__posted.find((m) => m.type === 'needImages'));
  if (need) {
    const images = await readFixtureImages(need.srcs);
    await page.evaluate((images) => window.__send({ type: 'images', images }), images);
  }
  await page.waitForFunction(() => window.__posted.some((m) => ['done', 'failed'].includes(m.type)), null, { timeout: 30000 });
  const result = await page.evaluate(() => window.__posted.find((m) => ['done', 'failed'].includes(m.type)));
  await page.close();
  assert.equal(result.type, 'done', result.message);
  assert.deepEqual(external, []);
  return { result, errors };
}

test('sample.md exports to a self-contained file', async () => {
  const markdown = await readFile(join(fixtures, 'sample.md'), 'utf8');
  const { result } = await runExport(markdown);
  assert.equal(result.diagrams, 2);
  assert.match(result.mermaidVersion, /^12\./);
  assert.deepEqual(result.problems, []);

  const css = await readFile(new URL('../media/vendor/vditor/dist/js/highlight.js/styles/github.min.css', import.meta.url), 'utf8');
  const html = exportDocument({ title: 'Sample', body: result.html, codeCss: css, maxWidth: 1180, generator: 'test' });
  assert.doesNotMatch(html, /<script/i);
  const dir = await mkdtemp(join(tmpdir(), 'md-studio-'));
  const file = join(dir, 'out.html');
  await writeFile(file, html);

  // Open the file:// page with every request blocked.
  const { page, external } = await offlinePage(browser, `file://${file}`);
  await page.goto(`file://${file}`);
  const info = await page.evaluate(() => ({
    scripts: document.querySelectorAll('script').length,
    imgs: [...document.images].map((i) => ({ data: i.src.startsWith('data:'), ok: i.complete && i.naturalWidth > 0 })),
    svgs: document.querySelectorAll('.mermaid > svg').length,
    codeBlocksLeft: document.querySelectorAll('code.language-mermaid').length,
    ids: [...document.querySelectorAll('h1,h2,h3')].map((h) => h.id),
    missing: [...document.querySelectorAll('a[href^="#"]')]
      .map((a) => decodeURIComponent(a.getAttribute('href').slice(1)))
      .filter((id) => !document.getElementById(id)),
    highlighted: document.querySelectorAll('pre code.hljs .hljs-keyword').length,
  }));
  await page.close();
  assert.equal(info.scripts, 0);
  assert.equal(info.imgs.length, 3);
  assert.ok(info.imgs.every((i) => i.data && i.ok), JSON.stringify(info.imgs));
  assert.equal(info.svgs, 2);
  assert.equal(info.codeBlocksLeft, 0);
  assert.deepEqual(info.missing, []);
  assert.deepEqual(info.ids, ['md-studio-sample', '37-mermaid-with-frontmatter', 'mermaid-default', '日本語の見出し', 'duplicate', 'duplicate-1']);
  assert.ok(info.highlighted > 0);
  assert.deepEqual(external, []);
});

test('problems are reported: missing image, broken anchor, bad diagram, remote image', async () => {
  const md = '# T\n\n![x](images/nope.png)\n\n[bad](#nowhere)\n\n```mermaid\nflowchart LR\n  A --> \n```\n\n<img src="https://example.com/x.png">\n<script>alert(1)</script>\n<a href="javascript:alert(1)" onclick="x()">j</a>\n';
  const { result } = await runExport(md);
  const text = result.problems.join('\n');
  assert.match(text, /Image not embedded: images\/nope\.png/);
  assert.match(text, /Link target not found: #nowhere/);
  assert.match(text, /Diagram 1:/);
  assert.match(text, /https:\/\/example\.com\/x\.png/);
  assert.doesNotMatch(result.html, /<script|javascript:|onclick/i);
});

test('settings theme applies, frontmatter wins', async () => {
  const md = '```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\n---\nconfig:\n  theme: forest\n---\nflowchart LR\n  A --> B\n```\n';
  const { result } = await runExport(md, { theme: 'dark', look: 'classic', layout: 'dagre' });
  const [first, second] = result.html.split('<div class="mermaid"').slice(1);
  // dark theme background of nodes vs forest's green
  assert.match(first, /#1f2020|#1F2020/);
  assert.match(second, /#cde498/i);
});
