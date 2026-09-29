// Serves the repository over HTTP and renders the webview pages the way the extension would,
// with the same CSP (cspSource = this server's origin).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { editorHtml, exportPanelHtml } from '../../src/html.ts';

const root = join(import.meta.dirname, '..', '..');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.json': 'application/json', '.md': 'text/markdown' };

export async function startServer({ mermaidUrl, mermaidConfig = {}, mode = 'wysiwyg', allowRemoteImages = false, theme = 'auto' } = {}) {
  let origin = '';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const inject = (html) => html.replace('<script type="application/json"', `<script src="${origin}/test/browser/fake-vscode.js"></script>\n<script type="application/json"`);
    if (url.pathname === '/editor.html') {
      const html = editorHtml({
        cspSource: origin,
        scriptUrl: `${origin}/dist/webview/editor.js`,
        cssUrl: `${origin}/media/editor.css`,
        allowRemoteImages,
        settings: {
          vditorCdn: `${origin}/media/vendor/vditor`,
          linkBase: `${origin}/test/fixtures/`,
          mode,
          toolbar: true,
          outline: true,
          theme,
          zoom: 1,
          font: { family: "'Segoe UI', sans-serif", size: 14, lineHeight: 1.6, codeFamily: 'monospace', codeSize: 13 },
          mermaid: { url: origin + (mermaidUrl ?? '/media/vendor/mermaid/mermaid.min.js'), label: 'test', config: { startOnLoad: false, securityLevel: 'loose', ...mermaidConfig } },
        },
      });
      res.writeHead(200, { 'content-type': 'text/html' }).end(inject(html));
      return;
    }
    if (url.pathname === '/exporter.html') {
      const html = exportPanelHtml({
        cspSource: origin,
        scriptUrl: `${origin}/dist/webview/export.js`,
        cssUrl: `${origin}/media/export.css`,
        settings: {
          mermaid: { url: origin + (mermaidUrl ?? '/media/vendor/mermaid/mermaid.min.js'), label: 'test', config: { startOnLoad: false, securityLevel: 'loose', ...mermaidConfig } },
          hljsUrl: `${origin}/media/vendor/vditor/dist/js/highlight.js/highlight.min.js`,
        },
      });
      res.writeHead(200, { 'content-type': 'text/html' }).end(inject(html));
      return;
    }
    const file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => server.close() };
}
