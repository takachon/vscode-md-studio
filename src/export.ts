import * as vscode from 'vscode';
import * as path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { exportDocument, exportPanelHtml, tocHtml } from './html';
import { PAPER_SIZES, PdfPrinter, findBrowser, namedDestinationPages, type PrintOptions } from './pdf';
import type { ExportOptions, ExporterToHost, Heading, HostToExporter, ImageMode } from './protocol';
import { SECTION, resolveMermaid, toSetup } from './settings';
import type { Log } from './log';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
};

/** Export options from the user's settings. */
export function defaultOptions(scope?: vscode.Uri): ExportOptions {
  const e = vscode.workspace.getConfiguration(`${SECTION}.export`, scope);
  const p = vscode.workspace.getConfiguration(`${SECTION}.pdf`, scope);
  return {
    format: e.get('format', 'html'),
    images: e.get('images', 'embed'),
    highlight: e.get('highlight', true),
    tocDepth: Math.min(Math.max(e.get('tocDepth', 3), 1), 6),
    tocTitle: e.get('tocTitle', 'Contents'),
    openAfter: e.get('openAfter', false),
    html: { toc: e.get('toc', 'none'), theme: e.get('theme', 'light'), maxWidth: e.get('maxWidth', 1180) },
    pdf: {
      toc: p.get('toc', true),
      bookmarks: p.get('bookmarks', true),
      paper: p.get('paper', 'A4'),
      landscape: p.get('landscape', false),
      margin: p.get('margin', 'normal'),
      pageNumbers: p.get('pageNumbers', true),
      headerTitle: p.get('headerTitle', false),
    },
  };
}

async function saveDefaults(o: ExportOptions): Promise<void> {
  const g = vscode.ConfigurationTarget.Global;
  const e = vscode.workspace.getConfiguration(`${SECTION}.export`);
  const p = vscode.workspace.getConfiguration(`${SECTION}.pdf`);
  await Promise.all([
    e.update('format', o.format, g),
    e.update('images', o.images, g),
    e.update('highlight', o.highlight, g),
    e.update('tocDepth', o.tocDepth, g),
    e.update('tocTitle', o.tocTitle, g),
    e.update('openAfter', o.openAfter, g),
    e.update('toc', o.html.toc, g),
    e.update('theme', o.html.theme, g),
    e.update('maxWidth', o.html.maxWidth, g),
    ...Object.entries(o.pdf).map(([k, v]) => p.update(k, v, g)),
  ]);
}

function titleOf(markdown: string, fallback: string): string {
  const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  const t = fm && /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm[1]);
  if (t) return t[1];
  const h1 = /^#[ \t]+(.+?)[ \t#]*$/m.exec(markdown);
  return h1 ? h1[1].replace(/[*_`]/g, '') : fallback;
}

/** Resolves an image src from the Markdown to a file, or explains why not. */
function imageUri(doc: vscode.Uri, src: string): vscode.Uri | string {
  if (/^https?:/i.test(src) || src.startsWith('//')) return `Remote image not embedded (no network access at export): ${src}`;
  if (/^file:/i.test(src)) return vscode.Uri.parse(src);
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src)) return `Unsupported image URL: ${src}`;
  let p = src.replace(/[?#].*$/, '');
  try {
    p = decodeURI(p);
  } catch {
    /* keep as written */
  }
  if (/^[a-z]:[\\/]/i.test(p)) return vscode.Uri.file(p);
  if (p.startsWith('/')) {
    const folder = vscode.workspace.getWorkspaceFolder(doc);
    return vscode.Uri.joinPath(folder?.uri ?? doc.with({ path: '/' }), p);
  }
  return vscode.Uri.joinPath(doc, '..', p);
}

function relativeUrl(fromDir: vscode.Uri, to: vscode.Uri): string {
  if (fromDir.scheme !== to.scheme || fromDir.authority !== to.authority) return to.toString();
  const rel = path.posix.relative(fromDir.path, to.path);
  return rel.split('/').map(encodeURIComponent).join('/');
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Maps image srcs according to `mode`; problems are appended. */
async function resolveImages(
  doc: vscode.Uri,
  target: vscode.Uri,
  mode: ImageMode,
  srcs: string[],
  problems: string[],
): Promise<{ map: Record<string, string>; count: number }> {
  const map: Record<string, string> = {};
  const outDir = vscode.Uri.joinPath(target, '..');
  const filesDirName = path.posix.basename(target.path).replace(/\.[^.]+$/, '') + '_files';
  const usedNames = new Set<string>();
  for (const src of srcs) {
    const uri = imageUri(doc, src);
    if (typeof uri === 'string') {
      problems.push(uri);
      continue;
    }
    const where = uri.scheme === 'file' ? uri.fsPath : uri.toString();
    if (!(await exists(uri))) {
      problems.push(`Image not found: ${src} (${where})`);
      continue;
    }
    if (mode === 'link') {
      map[src] = relativeUrl(outDir, uri);
    } else if (mode === 'copy') {
      const base = path.posix.basename(uri.path);
      const ext = path.posix.extname(base);
      let name = base;
      for (let i = 1; usedNames.has(name.toLowerCase()); i++) name = `${base.slice(0, base.length - ext.length)}-${i}${ext}`;
      usedNames.add(name.toLowerCase());
      const dest = vscode.Uri.joinPath(outDir, filesDirName, name);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(outDir, filesDirName));
      await vscode.workspace.fs.copy(uri, dest, { overwrite: true });
      map[src] = `${encodeURIComponent(filesDirName)}/${encodeURIComponent(name)}`;
    } else {
      const mime = MIME[path.extname(uri.path).toLowerCase()];
      if (!mime) {
        problems.push(`Unknown image type: ${src}`);
        continue;
      }
      const data = await vscode.workspace.fs.readFile(uri);
      map[src] = `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
    }
  }
  return { map, count: Object.keys(map).length };
}

const MARGINS = { narrow: 0.4, normal: 0.6, wide: 1 };

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function printOptions(o: ExportOptions, title: string): PrintOptions {
  const [w, h] = PAPER_SIZES[o.pdf.paper] ?? PAPER_SIZES.A4;
  const m = MARGINS[o.pdf.margin] ?? MARGINS.normal;
  const hf = o.pdf.pageNumbers || o.pdf.headerTitle;
  const small = 'font-size:8pt;color:#777;width:100%;padding:0 0.5in;font-family:sans-serif';
  return {
    paperWidth: w,
    paperHeight: h,
    landscape: o.pdf.landscape,
    marginTop: o.pdf.headerTitle ? Math.max(m, 0.6) : m,
    marginBottom: o.pdf.pageNumbers ? Math.max(m, 0.6) : m,
    marginLeft: m,
    marginRight: m,
    printBackground: true,
    displayHeaderFooter: hf,
    headerTemplate: o.pdf.headerTitle ? `<div style="${small};text-align:left">${escapeHtml(title)}</div>` : '<span></span>',
    footerTemplate: o.pdf.pageNumbers
      ? `<div style="${small};text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`
      : '<span></span>',
    generateDocumentOutline: o.pdf.bookmarks,
  };
}

/** One Export panel per Markdown file. */
export class ExportPanels {
  private readonly panels = new Map<string, ExportPanel>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: Log,
  ) {}

  async show(doc: vscode.TextDocument, format?: 'html' | 'pdf', start = false): Promise<void> {
    const key = doc.uri.toString();
    let panel = this.panels.get(key);
    if (!panel) {
      panel = new ExportPanel(this.context, this.log, doc, format);
      this.panels.set(key, panel);
      panel.onDispose(() => this.panels.delete(key));
    } else {
      panel.reveal(format);
    }
    if (start) await panel.startWhenReady();
  }
}

class ExportPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly ready: Promise<void>;
  private options: ExportOptions;
  private lastTarget: vscode.Uri | undefined;
  private waiters: {
    images?: (srcs: string[]) => Promise<Record<string, string>>;
    rendered?: (m: Extract<ExporterToHost, { type: 'rendered' | 'failed' }>) => void;
  } = {};
  private readonly disposeHandlers: Array<() => void> = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: Log,
    private readonly doc: vscode.TextDocument,
    format?: 'html' | 'pdf',
  ) {
    this.options = defaultOptions(doc.uri);
    if (format) this.options.format = format;
    const name = path.posix.basename(doc.uri.path);
    this.panel = vscode.window.createWebviewPanel(
      'mdStudio.export',
      `Export ${name}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [context.extensionUri] },
    );
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'export.svg');
    let markReady!: () => void;
    this.ready = new Promise((r) => (markReady = r));
    this.panel.webview.onDidReceiveMessage((m: ExporterToHost) => this.onMessage(m, markReady));
    this.panel.onDidDispose(() => this.disposeHandlers.forEach((h) => h()));
    void this.render();
  }

  onDispose(h: () => void): void {
    this.disposeHandlers.push(h);
  }

  reveal(format?: 'html' | 'pdf'): void {
    this.panel.reveal();
    if (format && format !== this.options.format) {
      this.options.format = format;
      void this.render();
    }
  }

  async startWhenReady(): Promise<void> {
    await this.ready;
    this.post({ type: 'start' });
  }

  private post(m: HostToExporter): void {
    void this.panel.webview.postMessage(m);
  }

  private defaultTarget(format: 'html' | 'pdf'): string {
    if (this.doc.uri.scheme !== 'file') return '';
    return path.join(path.dirname(this.doc.uri.fsPath), path.basename(this.doc.uri.fsPath).replace(/\.[^.]+$/, '') + `.${format}`);
  }

  private async render(): Promise<void> {
    const ext = this.context.extensionUri;
    const webview = this.panel.webview;
    const mermaid = await resolveMermaid(ext, this.doc.uri);
    webview.options = { enableScripts: true, localResourceRoots: [ext, ...(mermaid.root ? [mermaid.root] : [])] };
    webview.html = exportPanelHtml({
      cspSource: webview.cspSource,
      scriptUrl: webview.asWebviewUri(vscode.Uri.joinPath(ext, 'dist', 'webview', 'export.js')).toString(),
      cssUrl: webview.asWebviewUri(vscode.Uri.joinPath(ext, 'media', 'export.css')).toString(),
      settings: {
        mermaid: toSetup(webview, mermaid),
        hljsUrl: webview.asWebviewUri(vscode.Uri.joinPath(ext, 'media', 'vendor', 'vditor', 'dist', 'js', 'highlight.js', 'highlight.min.js')).toString(),
      },
    });
  }

  private async onMessage(m: ExporterToHost, markReady: () => void): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.post({
          type: 'init',
          fileName: path.posix.basename(this.doc.uri.path),
          options: this.options,
          target: this.defaultTarget(this.options.format),
          browser: findBrowser(this.browserSetting()) ?? null,
        });
        markReady();
        break;
      case 'browse': {
        const current = m.target ? vscode.Uri.file(m.target) : undefined;
        const picked = await vscode.window.showSaveDialog({
          defaultUri: current ?? (this.defaultTarget(m.format) ? vscode.Uri.file(this.defaultTarget(m.format)) : undefined),
          filters: m.format === 'pdf' ? { PDF: ['pdf'] } : { HTML: ['html', 'htm'] },
          saveLabel: 'Select',
        });
        if (picked) this.post({ type: 'target', target: picked.fsPath });
        break;
      }
      case 'export':
        this.options = m.options;
        await this.runExport(m.options, m.target);
        break;
      case 'saveDefaults':
        await saveDefaults(m.options);
        this.log.info('Export options saved as default.');
        break;
      case 'openResult':
        if (this.lastTarget) {
          if (m.action === 'open') await vscode.env.openExternal(this.lastTarget);
          else await vscode.commands.executeCommand('revealFileInOS', this.lastTarget);
        }
        break;
      case 'needImages':
        this.post({ type: 'images', images: (await this.waiters.images?.(m.srcs)) ?? {} });
        break;
      case 'rendered':
      case 'failed':
        this.waiters.rendered?.(m);
        break;
      case 'log':
        this.log[m.level](`export: ${m.message}`);
        break;
    }
  }

  private browserSetting(): string | undefined {
    return vscode.workspace.getConfiguration(`${SECTION}.pdf`, this.doc.uri).get<string>('browserPath') || undefined;
  }

  /** Renders the current text of the document in the panel's webview. */
  private renderInWebview(options: ExportOptions, target: vscode.Uri, problems: string[]) {
    let imageCount = 0;
    const mode: ImageMode = options.format === 'pdf' ? 'embed' : options.images;
    this.waiters.images = async (srcs) => {
      const r = await resolveImages(this.doc.uri, target, mode, srcs, problems);
      imageCount = r.count;
      return r.map;
    };
    return new Promise<{ html: string; headings: Heading[]; mermaidVersion: string; diagrams: number; problems: string[]; images: number }>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Rendering timed out after 120 s')), 120_000);
        this.waiters.rendered = (m) => {
          clearTimeout(timer);
          if (m.type === 'failed') reject(new Error(m.message));
          else resolve({ ...m, images: imageCount });
        };
        this.post({ type: 'render', markdown: this.doc.getText(), highlight: options.highlight });
      },
    );
  }

  private async runExport(options: ExportOptions, targetPath: string): Promise<void> {
    const target = vscode.Uri.file(targetPath);
    const name = path.posix.basename(this.doc.uri.path);
    const problems: string[] = [];
    try {
      const r = await this.renderInWebview(options, target, problems);
      problems.push(...r.problems);
      const title = titleOf(this.doc.getText(), name.replace(/\.[^.]+$/, ''));
      const ext = this.context.extensionUri;
      const readCss = async (f: string) =>
        options.highlight
          ? Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(ext, 'media', 'vendor', 'vditor', 'dist', 'js', 'highlight.js', 'styles', f))).toString('utf8')
          : '';
      const codeCss = { light: await readCss('github.min.css'), dark: await readCss('github-dark.min.css') };
      const version = String(this.context.extension.packageJSON.version ?? '');
      const generator = `MD Studio ${version}${r.mermaidVersion ? ` (Mermaid ${r.mermaidVersion})` : ''}`;
      let bytes: Uint8Array;
      let pages = 0;

      if (options.format === 'html') {
        const toc =
          options.html.toc === 'none'
            ? undefined
            : {
                position: options.html.toc,
                html: tocHtml(r.headings, { depth: options.tocDepth, title: options.tocTitle, className: `toc-${options.html.toc}` }),
              };
        const html = exportDocument({ title, body: r.html, codeCss, generator, theme: options.html.theme, maxWidth: options.html.maxWidth, toc });
        if (/<script[\s>]/i.test(html)) throw new Error('internal error: exported HTML contains <script>');
        bytes = Buffer.from(html, 'utf8');
      } else {
        this.post({ type: 'status', message: 'Printing PDF…' });
        const browser = findBrowser(this.browserSetting());
        if (!browser) {
          throw new Error(
            'PDF export needs Microsoft Edge, Google Chrome or Chromium. Install one or set mdStudio.pdf.browserPath.',
          );
        }
        const build = (pageMap?: Map<string, number>) => {
          const toc = options.pdf.toc
            ? {
                position: 'page' as const,
                html:
                  tocHtml(r.headings, {
                    depth: options.tocDepth,
                    title: options.tocTitle,
                    className: 'toc-pdf',
                    pages: pageMap,
                    placeholder: !pageMap,
                  }) + '\n<div class="toc-page-break"></div>',
              }
            : undefined;
          return exportDocument({ title, body: r.html, codeCss, generator, theme: 'light', maxWidth: 0, toc, print: true });
        };
        const dir = mkdtempSync(path.join(tmpdir(), 'md-studio-export-'));
        const printer = await PdfPrinter.launch(browser);
        try {
          const file = path.join(dir, 'document.html');
          const print = printOptions(options, title);
          writeFileSync(file, build());
          let pdf = await printer.print(file, print);
          if (options.pdf.toc && r.headings.length > 0) {
            // Second pass with the page numbers the first pass produced (layout is identical).
            const found = namedDestinationPages(pdf);
            if (found.size === 0) problems.push('Could not read page numbers for the table of contents.');
            writeFileSync(file, build(found));
            pdf = await printer.print(file, print);
          }
          bytes = pdf;
          pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
          this.log.info(`export: printed with ${await printer.version()}`);
        } finally {
          await printer.close();
          rmSync(dir, { recursive: true, force: true });
        }
      }

      await vscode.workspace.fs.writeFile(target, bytes);
      this.lastTarget = target;
      const unique = [...new Set(problems)];
      const size = bytes.length >= 1024 * 1024 ? `${(bytes.length / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes.length / 1024)} KB`;
      const summary =
        `Exported ${path.basename(target.fsPath)} (${size}` +
        (pages ? `, ${pages} page(s)` : '') +
        `, ${r.images} image(s), ${r.diagrams} diagram(s)).`;
      this.log.info(`export ${name} -> ${target.fsPath}: ${summary}${r.mermaidVersion ? ` Mermaid ${r.mermaidVersion}.` : ''}`);
      for (const p of unique) this.log.warn(`export ${name}: ${p}`);
      this.post({ type: 'result', ok: true, message: summary, problems: unique });
      if (options.openAfter) await vscode.env.openExternal(target);
    } catch (e) {
      this.log.error(`export ${name} failed: ${(e as Error).stack ?? e}`);
      this.post({ type: 'result', ok: false, message: `Export failed: ${(e as Error).message}`, problems: [...new Set(problems)] });
    }
  }
}
