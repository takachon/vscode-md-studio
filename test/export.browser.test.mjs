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
import { exportDocument, pageCss, tocHtml } from '../src/html.ts';
import { PdfPrinter, namedDestinationPages, printPdfCli } from '../src/pdf.ts';

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
  await page.evaluate((md) => window.__send({ type: 'render', markdown: md, highlight: true }), markdown);
  await page.waitForFunction(() => window.__posted.some((m) => ['needImages', 'rendered', 'failed'].includes(m.type)), null, { timeout: 30000 });
  const need = await page.evaluate(() => window.__posted.find((m) => m.type === 'needImages'));
  if (need) {
    const images = await readFixtureImages(need.srcs);
    await page.evaluate((images) => window.__send({ type: 'images', images }), images);
  }
  await page.waitForFunction(() => window.__posted.some((m) => ['rendered', 'failed'].includes(m.type)), null, { timeout: 30000 });
  const result = await page.evaluate(() => window.__posted.find((m) => ['rendered', 'failed'].includes(m.type)));
  await page.close();
  assert.equal(result.type, 'rendered', result.message);
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
  const toc = tocHtml(result.headings, { depth: 3, title: 'Contents', className: 'toc-sidebar' });
  const html = exportDocument({ title: 'Sample', body: result.html, codeCss: { light: css, dark: '' }, maxWidth: 1180, generator: 'test', theme: 'light', toc: { html: toc, position: 'sidebar' } });
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
    tocLinks: document.querySelectorAll('nav.toc a').length,
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
  assert.equal(info.tocLinks, 6);
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

const pdfOptions = {
  pdf: { paper: 'A4', landscape: false, margin: 'normal', pageNumbers: true, headerTitle: true, toc: true, bookmarks: true, fontSize: 10.5 },
};
const pageSize = (pdf) => /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(pdf.toString('latin1')).slice(1).map(Number);

test('PDF: contents page with page numbers, bookmarks; --print-to-pdf and DevTools give the same pages', async () => {
  const markdown = await readFile(join(fixtures, 'sample.md'), 'utf8');
  const long = markdown + '\n\n' + Array.from({ length: 40 }, (_, i) => `## Section ${i + 1}\n\n${'Lorem ipsum dolor sit amet. '.repeat(30)}\n`).join('\n');
  const { result } = await runExport(long);
  const css = await readFile(new URL('../media/vendor/vditor/dist/js/highlight.js/styles/github.min.css', import.meta.url), 'utf8');
  const build = (pages) =>
    exportDocument({
      title: 'Sample', body: result.html, codeCss: { light: css, dark: '' }, maxWidth: 0, generator: 'test', theme: 'light', print: true,
      pageCss: pageCss(pdfOptions, 'Sample "title"'),
      toc: { position: 'page', html: tocHtml(result.headings, { depth: 2, title: 'Contents', className: 'toc-pdf', pages, placeholder: !pages }) + '<div class="toc-page-break"></div>' },
    });
  const dir = await mkdtemp(join(tmpdir(), 'md-studio-pdf-'));
  const file = join(dir, 'doc.html');
  const exe = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

  // --print-to-pdf (the default method)
  await writeFile(file, build());
  const pass1 = await printPdfCli(exe, file, { outline: true });
  const pages = namedDestinationPages(pass1);
  assert.ok(pages.size >= 40, `named destinations: ${pages.size}`);
  assert.ok(pages.get('md-studio-sample') >= 2, 'contents pages come first');
  assert.ok(pages.get('section-40') > pages.get('section-1'));
  await writeFile(file, build(pages));
  const pass2 = await printPdfCli(exe, file, { outline: true });
  assert.deepEqual([...namedDestinationPages(pass2)], [...pages], 'page numbers do not move in the second pass');
  assert.match(pass2.toString('latin1'), /\/Outlines/);
  const [w, h] = pageSize(pass2);
  assert.ok(Math.abs(w - 595.3) < 1 && Math.abs(h - 841.9) < 1, `A4 size: ${w} x ${h}`);
  await writeFile(join(dir, 'out.pdf'), pass2);

  // DevTools protocol (the fallback) lays out the same pages.
  const printer = await PdfPrinter.launch(exe);
  try {
    const viaCdp = await printer.print(file, { printBackground: true, preferCSSPageSize: true, generateDocumentOutline: true });
    assert.deepEqual([...namedDestinationPages(viaCdp)], [...pages]);
    assert.deepEqual(pageSize(viaCdp).map(Math.round), [w, h].map(Math.round));
  } finally {
    await printer.close();
  }
});

test('PDF: a browser that cannot start gives a clear error', async () => {
  await assert.rejects(printPdfCli('/nonexistent/msedge', '/tmp/x.html', { outline: false }), /cannot start \/nonexistent\/msedge/);
});
