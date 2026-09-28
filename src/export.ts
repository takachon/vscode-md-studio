import * as vscode from 'vscode';
import * as path from 'node:path';
import { exportDocument, exporterHtml } from './html';
import type { ExporterToHost, HostToExporter } from './protocol';
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

export interface ExportResult {
  target: vscode.Uri;
  bytes: number;
  diagrams: number;
  images: number;
  problems: string[];
}

/** Reads the images referenced by `srcs` (relative to the Markdown file) as data URIs. */
async function readImages(doc: vscode.Uri, srcs: string[], problems: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const folder = vscode.workspace.getWorkspaceFolder(doc);
  for (const src of srcs) {
    if (/^https?:/i.test(src) || src.startsWith('//')) {
      problems.push(`Remote image not embedded (no network access at export): ${src}`);
      continue;
    }
    let uri: vscode.Uri;
    if (/^file:/i.test(src)) {
      uri = vscode.Uri.parse(src);
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src)) {
      problems.push(`Unsupported image URL: ${src}`);
      continue;
    } else {
      let p = src.replace(/[?#].*$/, '');
      try {
        p = decodeURI(p);
      } catch {
        /* keep as written */
      }
      if (/^[a-z]:[\\/]/i.test(p)) uri = vscode.Uri.file(p);
      else if (p.startsWith('/')) uri = vscode.Uri.joinPath(folder?.uri ?? doc.with({ path: '/' }), p);
      else uri = vscode.Uri.joinPath(doc, '..', p);
    }
    const mime = MIME[path.extname(uri.path).toLowerCase()];
    if (!mime) {
      problems.push(`Unknown image type: ${src}`);
      continue;
    }
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      out[src] = `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
    } catch {
      problems.push(`Image not found: ${src} (${uri.scheme === 'file' ? uri.fsPath : uri.toString()})`);
    }
  }
  return out;
}

function titleOf(markdown: string, fallback: string): string {
  const fm = /^﻿?---\r?\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$[\s\S]*?^---/m.exec(markdown);
  if (fm) return fm[1];
  const h1 = /^#[ \t]+(.+?)[ \t#]*$/m.exec(markdown);
  return h1 ? h1[1].replace(/[*_`]/g, '') : fallback;
}

/** Renders `doc` in a temporary webview and writes a self-contained HTML file to `target`. */
export async function exportHtml(
  context: vscode.ExtensionContext,
  log: Log,
  doc: vscode.TextDocument,
  target: vscode.Uri,
): Promise<ExportResult> {
  const ext = context.extensionUri;
  const mermaid = await resolveMermaid(ext, doc.uri);
  if (mermaid.warning) log.warn(mermaid.warning);
  const cfg = vscode.workspace.getConfiguration(SECTION, doc.uri);
  const markdown = doc.getText();
  const name = path.basename(doc.uri.path);

  const panel = vscode.window.createWebviewPanel(
    'mdStudio.export',
    `Exporting ${name}`,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, localResourceRoots: [ext, ...(mermaid.root ? [mermaid.root] : [])] },
  );
  const webview = panel.webview;
  const post = (m: HostToExporter) => void webview.postMessage(m);
  const problems: string[] = [];
  let imageCount = 0;

  try {
    const result = await new Promise<Extract<ExporterToHost, { type: 'done' }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Export timed out after 120 s')), 120_000);
      panel.onDidDispose(() => reject(new Error('Export cancelled')));
      webview.onDidReceiveMessage(async (m: ExporterToHost) => {
        switch (m.type) {
          case 'ready':
            post({ type: 'render', markdown, title: name });
            break;
          case 'needImages': {
            const images = await readImages(doc.uri, m.srcs, problems);
            imageCount = Object.keys(images).length;
            post({ type: 'images', images });
            break;
          }
          case 'done':
            clearTimeout(timer);
            resolve(m);
            break;
          case 'failed':
            clearTimeout(timer);
            reject(new Error(m.message));
            break;
          case 'log':
            log[m.level](`export ${name}: ${m.message}`);
            break;
        }
      });
      webview.html = exporterHtml({
        cspSource: webview.cspSource,
        scriptUrl: webview.asWebviewUri(vscode.Uri.joinPath(ext, 'dist', 'webview', 'exporter.js')).toString(),
        settings: {
          mermaid: toSetup(webview, mermaid),
          hljsUrl: webview.asWebviewUri(
            vscode.Uri.joinPath(ext, 'media', 'vendor', 'vditor', 'dist', 'js', 'highlight.js', 'highlight.min.js'),
          ).toString(),
        },
      });
    });

    const codeCss = Buffer.from(
      await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(ext, 'media', 'vendor', 'vditor', 'dist', 'js', 'highlight.js', 'styles', 'github.min.css'),
      ),
    ).toString('utf8');
    const version = String(context.extension.packageJSON.version ?? '');
    const html = exportDocument({
      title: titleOf(markdown, name.replace(/\.[^.]+$/, '')),
      body: result.html,
      codeCss,
      maxWidth: cfg.get<number>('export.maxWidth', 1180),
      generator: `MD Studio ${version}${result.mermaidVersion ? ` (Mermaid ${result.mermaidVersion})` : ''}`,
    });
    if (/<script[\s>]/i.test(html)) throw new Error('internal error: exported HTML contains <script>');
    const bytes = Buffer.from(html, 'utf8');
    await vscode.workspace.fs.writeFile(target, bytes);
    const all = [...new Set([...problems, ...result.problems])];
    log.info(
      `export ${name} -> ${target.fsPath}: ${bytes.length} bytes, ${imageCount} image(s), ${result.diagrams} diagram(s)` +
        (result.mermaidVersion ? `, Mermaid ${result.mermaidVersion} (${mermaid.label})` : ''),
    );
    for (const p of all) log.warn(`export ${name}: ${p}`);
    return { target, bytes: bytes.length, diagrams: result.diagrams, images: imageCount, problems: all };
  } finally {
    panel.dispose();
  }
}
