// The Export panel: a form for the export options, and the renderer used by the host.
import type { ExportOptions, ExportSettings, ExporterToHost, HostToExporter } from '../protocol';
import { escapeHtml } from './mermaidLoader';
import { renderMarkdown } from './render';

declare function acquireVsCodeApi(): { postMessage(msg: ExporterToHost): void };

const vscode = acquireVsCodeApi();
const post = (msg: ExporterToHost) => vscode.postMessage(msg);
const settings: ExportSettings = JSON.parse(document.getElementById('md-studio-settings')!.textContent!);
const app = document.getElementById('app')!;
const out = document.getElementById('out')!;

let options: ExportOptions | undefined;
let target = '';
let busy = false;
let imagesResolve: ((images: Record<string, string>) => void) | undefined;

window.addEventListener('error', (e) => post({ type: 'log', level: 'error', message: `export panel: ${e.message}` }));

window.addEventListener('message', (event: MessageEvent<HostToExporter>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      options = msg.options;
      target = msg.target;
      buildForm(msg.fileName, msg.browser);
      break;
    case 'target':
      target = msg.target;
      field<HTMLInputElement>('target').value = target;
      break;
    case 'start':
      startExport();
      break;
    case 'render':
      renderMarkdown(out, msg.markdown, settings, { highlight: msg.highlight, fontFamily: msg.fontFamily }, (srcs) =>
        new Promise((resolve) => {
          imagesResolve = resolve;
          post({ type: 'needImages', srcs });
        }),
      ).then(
        (r) => post({ type: 'rendered', ...r }),
        (e) => post({ type: 'failed', message: String(e?.stack ?? e) }),
      );
      break;
    case 'images':
      imagesResolve?.(msg.images);
      imagesResolve = undefined;
      break;
    case 'status':
      showStatus(msg.message, 'busy');
      break;
    case 'result':
      setBusy(false);
      showResult(msg.ok, msg.message, msg.problems);
      break;
  }
});

function field<T extends HTMLElement>(name: string): T {
  return app.querySelector<T>(`[name="${name}"]`)!;
}

const radio = (name: string, value: string, label: string, hint = '') =>
  `<label class="choice"><input type="radio" name="${name}" value="${value}"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
const check = (name: string, label: string, hint = '') =>
  `<label class="choice"><input type="checkbox" name="${name}"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
const select = (name: string, items: Array<[string, string]>) =>
  `<select name="${name}">${items.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;

function buildForm(fileName: string, browser: string | null): void {
  app.innerHTML = `
  <h1>Export <span class="file">${escapeHtml(fileName)}</span></h1>
  <form id="form" autocomplete="off">
    <section>
      <h2>Format</h2>
      <div class="row">
        ${radio('format', 'html', 'HTML', 'One self-contained file you can mail or put on a share')}
        ${radio('format', 'pdf', 'PDF', 'With a table of contents, bookmarks and page numbers')}
      </div>
      <div class="field">
        <label for="target">Save to</label>
        <div class="path"><input id="target" name="target" type="text" spellcheck="false"><button type="button" id="browse" class="secondary">Browse&hellip;</button></div>
      </div>
    </section>

    <section>
      <h2>Contents</h2>
      <div class="grid">
        <div class="field only-html"><label>Table of contents (HTML)</label>
          ${select('html.toc', [['none', 'None'], ['top', 'At the top'], ['sidebar', 'Sidebar (wide screens)']])}</div>
        <div class="field only-pdf"><label>Table of contents (PDF)</label>${check('pdf.toc', 'Contents page with page numbers')}</div>
        <div class="field"><label>Headings in the contents</label>
          ${select('tocDepth', [['1', 'Level 1'], ['2', 'Levels 1–2'], ['3', 'Levels 1–3'], ['4', 'Levels 1–4'], ['6', 'All levels']])}</div>
        <div class="field"><label for="tocTitle">Contents title</label><input id="tocTitle" name="tocTitle" type="text"></div>
      </div>
      ${check('highlight', 'Syntax highlighting for code blocks')}
    </section>

    <section>
      <h2>Font</h2>
      <div class="grid">
        <div class="field"><label>Text font</label>
          ${select('font', [
            ['editor', 'Same as the editor (VS Code setting)'],
            ['yugothic', 'Yu Gothic (游ゴシック)'],
            ['meiryo', 'Meiryo (メイリオ)'],
            ['bizud-gothic', 'BIZ UDPGothic (BIZ UDPゴシック)'],
            ['yumincho', 'Yu Mincho (游明朝)'],
            ['bizud-mincho', 'BIZ UDPMincho (BIZ UDP明朝)'],
            ['custom', 'Other…'],
          ])}</div>
        <div class="field only-custom-font"><label for="fontCustom">Font names (CSS)</label>
          <input id="fontCustom" name="fontCustom" type="text" placeholder="&quot;Noto Sans JP&quot;, Meiryo" spellcheck="false"></div>
        <div class="field only-pdf"><label>Text size (PDF)</label>
          ${select('pdf.fontSize', [['9', '9 pt'], ['10', '10 pt'], ['10.5', '10.5 pt'], ['11', '11 pt'], ['12', '12 pt']])}</div>
      </div>
      <p class="note">Code uses the editor font (<code>editor.fontFamily</code>). The font must be installed on the PC that opens the HTML; PDF embeds it.</p>
    </section>

    <section class="only-html">
      <h2>Images (HTML)</h2>
      ${radio('images', 'embed', 'Embed in the HTML', 'Everything in one file (base64). Best for sending by mail.')}
      ${radio('images', 'link', 'Link to the original files', 'Small HTML; images must stay where they are.')}
      ${radio('images', 'copy', 'Copy next to the HTML', 'Images go to a “&lt;name&gt;_files” folder beside the HTML.')}
    </section>

    <section class="only-html">
      <h2>Appearance (HTML)</h2>
      <div class="grid">
        <div class="field"><label>Theme</label>
          ${select('html.theme', [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Follow the viewer’s OS setting']])}</div>
        <div class="field"><label for="maxWidth">Body width (px)</label><input id="maxWidth" name="html.maxWidth" type="number" min="600" max="4000" step="20"></div>
      </div>
    </section>

    <section class="only-pdf">
      <h2>Page (PDF)</h2>
      <div class="grid">
        <div class="field"><label>Paper</label>
          ${select('pdf.paper', [['A4', 'A4'], ['A3', 'A3'], ['B5', 'B5 (JIS)'], ['Letter', 'Letter'], ['Legal', 'Legal']])}</div>
        <div class="field"><label>Orientation</label>
          ${select('pdf.landscape', [['false', 'Portrait'], ['true', 'Landscape']])}</div>
        <div class="field"><label>Margins</label>
          ${select('pdf.margin', [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']])}</div>
      </div>
      ${check('pdf.pageNumbers', 'Page numbers in the footer')}
      ${check('pdf.headerTitle', 'Document title in the header')}
      ${check('pdf.bookmarks', 'Bookmarks (PDF outline) from the headings')}
      <p class="note">${
        browser
          ? `PDF is printed with <code>${escapeHtml(browser)}</code> in the background (no network access).`
          : `<strong>No Edge / Chrome / Chromium found.</strong> Set <code>mdStudio.pdf.browserPath</code> to use PDF export.`
      }</p>
    </section>

    <section>
      ${check('openAfter', 'Open the file after exporting')}
    </section>

    <div class="actions">
      <button type="submit" id="export">Export</button>
      <button type="button" id="defaults" class="secondary" title="Use these options for future exports (user settings)">Save as Default</button>
      <span id="status"></span>
    </div>
    <div id="result"></div>
  </form>`;

  fill(options!);
  field<HTMLInputElement>('target').value = target;
  app.querySelector('#browse')!.addEventListener('click', () => post({ type: 'browse', format: read().format, target: field<HTMLInputElement>('target').value }));
  app.querySelector('#defaults')!.addEventListener('click', () => {
    post({ type: 'saveDefaults', options: read() });
    showStatus('Saved as default.', 'ok');
  });
  app.querySelector('#form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    startExport();
  });
  for (const r of app.querySelectorAll<HTMLInputElement>('input[name="format"]')) {
    r.addEventListener('change', () => {
      const t = field<HTMLInputElement>('target');
      t.value = t.value.replace(/\.(html?|pdf)$/i, '') + (read().format === 'pdf' ? '.pdf' : '.html');
      updateVisibility();
    });
  }
  field<HTMLSelectElement>('font').addEventListener('change', updateVisibility);
  updateVisibility();
}

function fill(o: ExportOptions): void {
  const set = (name: string, value: unknown) => {
    const els = app.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
    for (const el of els) {
      if (el instanceof HTMLInputElement && el.type === 'radio') el.checked = el.value === String(value);
      else if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!value;
      else el.value = String(value);
    }
  };
  set('format', o.format);
  set('images', o.images);
  set('highlight', o.highlight);
  set('tocDepth', o.tocDepth);
  set('tocTitle', o.tocTitle);
  set('openAfter', o.openAfter);
  set('font', o.font);
  set('fontCustom', o.fontCustom);
  set('html.toc', o.html.toc);
  set('html.theme', o.html.theme);
  set('html.maxWidth', o.html.maxWidth);
  for (const [k, v] of Object.entries(o.pdf)) set(`pdf.${k}`, v);
}

function read(): ExportOptions {
  const val = (name: string) => {
    const el = app.querySelector<HTMLInputElement>(`[name="${name}"]:checked`) ?? field<HTMLInputElement>(name);
    return el.type === 'checkbox' ? el.checked : el.value;
  };
  const bool = (name: string) => {
    const el = field<HTMLInputElement>(name);
    return el.type === 'checkbox' ? el.checked : el.value === 'true';
  };
  return {
    format: val('format') as ExportOptions['format'],
    images: val('images') as ExportOptions['images'],
    highlight: bool('highlight'),
    tocDepth: Number(val('tocDepth')),
    tocTitle: String(val('tocTitle')),
    openAfter: bool('openAfter'),
    font: val('font') as ExportOptions['font'],
    fontCustom: String(val('fontCustom')),
    html: {
      toc: val('html.toc') as ExportOptions['html']['toc'],
      theme: val('html.theme') as ExportOptions['html']['theme'],
      maxWidth: Number(val('html.maxWidth')) || 1180,
    },
    pdf: {
      toc: bool('pdf.toc'),
      bookmarks: bool('pdf.bookmarks'),
      paper: val('pdf.paper') as ExportOptions['pdf']['paper'],
      landscape: bool('pdf.landscape'),
      margin: val('pdf.margin') as ExportOptions['pdf']['margin'],
      pageNumbers: bool('pdf.pageNumbers'),
      headerTitle: bool('pdf.headerTitle'),
      fontSize: Number(val('pdf.fontSize')) || 10.5,
    },
  };
}

function updateVisibility(): void {
  const format = read().format;
  app.classList.toggle('is-pdf', format === 'pdf');
  app.classList.toggle('is-html', format === 'html');
  app.classList.toggle('is-custom-font', read().font === 'custom');
}

function setBusy(b: boolean): void {
  busy = b;
  app.querySelector<HTMLButtonElement>('#export')!.disabled = b;
}

function startExport(): void {
  if (busy || !options) return;
  const t = field<HTMLInputElement>('target').value.trim();
  if (!t) {
    showStatus('Choose where to save the file.', 'error');
    return;
  }
  setBusy(true);
  app.querySelector('#result')!.innerHTML = '';
  showStatus('Exporting…', 'busy');
  post({ type: 'export', options: read(), target: t });
}

function showStatus(message: string, kind: 'busy' | 'ok' | 'error'): void {
  const s = app.querySelector('#status');
  if (!s) return;
  s.className = kind;
  s.textContent = message;
}

function showResult(ok: boolean, message: string, problems: string[]): void {
  showStatus('', ok ? 'ok' : 'error');
  const r = app.querySelector('#result')!;
  r.className = ok ? (problems.length ? 'warn' : 'ok') : 'error';
  r.innerHTML = `<p>${escapeHtml(message)}</p>${
    ok ? '<p class="buttons"><button type="button" data-act="open" class="secondary">Open</button> <button type="button" data-act="reveal" class="secondary">Show in Folder</button></p>' : ''
  }${problems.length ? `<details open><summary>${problems.length} problem(s)</summary><ul>${problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul></details>` : ''}`;
  for (const b of r.querySelectorAll<HTMLButtonElement>('button[data-act]')) {
    b.addEventListener('click', () => post({ type: 'openResult', action: b.dataset.act as 'open' | 'reveal' }));
  }
}

post({ type: 'ready' });
