// HTML for the webviews and for exported files. No `vscode` import so it can be used from tests.
import type { EditorSettings, ExportSettings } from './protocol';

export function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** JSON that is safe inside <script type="application/json">. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function attr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function csp(cspSource: string, n: string, allowRemoteImages: boolean): string {
  return [
    `default-src 'none'`,
    `img-src ${cspSource} data: blob:${allowRemoteImages ? ' https:' : ''}`,
    `script-src ${cspSource} 'nonce-${n}'`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource} data:`,
    `connect-src ${cspSource}`,
  ].join('; ');
}

export function editorHtml(o: {
  cspSource: string;
  scriptUrl: string;
  cssUrl: string;
  settings: EditorSettings;
  allowRemoteImages: boolean;
}): string {
  const n = nonce();
  const cdn = o.settings.vditorCdn;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${attr(csp(o.cspSource, n, o.allowRemoteImages))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${attr(cdn)}/dist/index.css">
<link rel="stylesheet" href="${attr(o.cssUrl)}">
<title>MD Studio</title>
</head>
<body>
<div id="vditor"></div>
<script type="application/json" id="md-studio-settings">${jsonForScript(o.settings)}</script>
<script nonce="${n}" src="${attr(cdn)}/dist/js/icons/ant.js" id="vditorIconScript"></script>
<script nonce="${n}" src="${attr(cdn)}/dist/index.min.js"></script>
<script nonce="${n}" src="${attr(o.scriptUrl)}"></script>
</body>
</html>`;
}

export function exporterHtml(o: { cspSource: string; scriptUrl: string; settings: ExportSettings }): string {
  const n = nonce();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${attr(csp(o.cspSource, n, false))}">
<title>MD Studio export</title>
<style>body{background:#fff;color:#1f2328;font:14px sans-serif}#status{padding:12px}#out{position:absolute;left:0;top:40px;width:1180px;opacity:.02;pointer-events:none}</style>
</head>
<body>
<div id="status">Exporting to HTML&hellip;</div>
<main id="out" class="markdown-body"></main>
<script type="application/json" id="md-studio-settings">${jsonForScript(o.settings)}</script>
<script nonce="${n}" src="${attr(o.scriptUrl)}"></script>
</body>
</html>`;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The exported single-file page. No <script>, everything inline. */
export function exportDocument(o: { title: string; body: string; codeCss: string; maxWidth: number; generator: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${attr(o.generator)}">
<title>${escapeText(o.title)}</title>
<style>
${o.codeCss}
${exportCss(o.maxWidth)}
</style>
</head>
<body>
<main class="markdown-body">
${o.body}
</main>
</body>
</html>
`;
}

function exportCss(maxWidth: number): string {
  return `*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:#1f2328;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans","Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI",Meiryo,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;word-wrap:break-word}
.markdown-body{max-width:${maxWidth}px;margin:0 auto;padding:32px 24px 64px}
.markdown-body>*:first-child{margin-top:0}
h1,h2,h3,h4,h5,h6{margin:24px 0 16px;font-weight:600;line-height:1.25;scroll-margin-top:16px}
h1{font-size:2em;padding-bottom:.3em;border-bottom:1px solid #d1d9e0}
h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid #d1d9e0}
h3{font-size:1.25em}h4{font-size:1em}h5{font-size:.875em}h6{font-size:.85em;color:#59636e}
p,blockquote,ul,ol,dl,table,pre,details,.mermaid{margin:0 0 16px}
a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}
ul,ol{padding-left:2em}li+li{margin-top:.25em}
li>input[type=checkbox]{margin:0 .35em .2em -1.4em;vertical-align:middle}
ul:has(>li>input[type=checkbox]){list-style:none}
blockquote{padding:0 1em;color:#59636e;border-left:.25em solid #d1d9e0}
hr{height:.25em;padding:0;margin:24px 0;background:#d1d9e0;border:0}
img{max-width:100%;height:auto;background:#fff}
code,kbd,pre,samp{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;font-size:85%}
:not(pre)>code{padding:.2em .4em;background:rgba(129,139,152,.12);border-radius:6px}
pre{padding:16px;overflow:auto;line-height:1.45;background:#f6f8fa;border-radius:6px}
pre>code{padding:0;background:transparent;font-size:100%}
pre code.hljs{padding:0;background:transparent}
table{display:block;width:max-content;max-width:100%;overflow:auto;border-spacing:0;border-collapse:collapse}
th,td{padding:6px 13px;border:1px solid #d1d9e0}
th{font-weight:600;background:#f6f8fa}
tr:nth-child(2n) td{background:#f6f8fa}
.mermaid{text-align:center;overflow-x:auto}
.mermaid svg{max-width:100%;height:auto}
.mermaid-error{text-align:left;border:1px solid #d1242f;border-radius:6px;padding:8px 12px;color:#d1242f}
@media print{.markdown-body{max-width:none;padding:0}pre,table,.mermaid,img{break-inside:avoid}}`;
}
