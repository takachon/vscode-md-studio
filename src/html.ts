// HTML for the webviews and for exported files. No `vscode` import so it can be used from tests.
import type { EditorSettings, ExportOptions, ExportSettings, Heading } from './protocol';

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

/** `https://host:port` of an http(s) URL, or '' (for the CSP; nothing else is let through). */
export function originOf(url: string): string {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : '';
  } catch {
    return '';
  }
}

export function csp(cspSource: string, n: string, allowRemoteImages: boolean, imgOrigins: string[] = []): string {
  const extra = imgOrigins.filter(Boolean).map((o) => ` ${o}`).join('');
  return [
    `default-src 'none'`,
    `img-src ${cspSource} data: blob:${allowRemoteImages ? ' https:' : ''}${extra}`,
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
<meta http-equiv="Content-Security-Policy" content="${attr(csp(o.cspSource, n, o.allowRemoteImages, [originOf(o.settings.plantumlServer)]))}">
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

export function exportPanelHtml(o: { cspSource: string; scriptUrl: string; cssUrl: string; settings: ExportSettings }): string {
  const n = nonce();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${attr(csp(o.cspSource, n, false))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${attr(o.cssUrl)}">
<title>MD Studio export</title>
</head>
<body>
<div id="app"></div>
<main id="out" class="markdown-body" aria-hidden="true"></main>
<script type="application/json" id="md-studio-settings">${jsonForScript(o.settings)}</script>
<script nonce="${n}" src="${attr(o.scriptUrl)}"></script>
</body>
</html>`;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Table of contents. `pages` adds right-aligned page numbers (PDF); `placeholder` reserves the same
 * space with invisible digits so the first PDF pass lays out exactly like the final one.
 */
export function tocHtml(
  headings: Heading[],
  o: { depth: number; title: string; className: string; pages?: Map<string, number>; placeholder?: boolean },
): string {
  const items = headings.filter((h) => h.level <= o.depth && h.id);
  if (items.length === 0) return '';
  const min = Math.min(...items.map((h) => h.level));
  const lis = items
    .map((h) => {
      const page = o.pages?.get(h.id);
      const num = o.placeholder ? '<span class="toc-page toc-page--placeholder">000</span>' : page ? `<span class="toc-page">${page}</span>` : '';
      const dots = o.pages || o.placeholder ? '<span class="toc-dots"></span>' : '';
      return `<li class="toc-l${h.level - min + 1}"><a href="#${attr(h.id)}"><span class="toc-text">${escapeText(h.text)}</span>${dots}${num}</a></li>`;
    })
    .join('\n');
  return `<nav class="toc ${o.className}" aria-label="${attr(o.title)}">
<div class="toc-title">${escapeText(o.title)}</div>
<ul>
${lis}
</ul>
</nav>`;
}

export interface DocumentParts {
  title: string;
  body: string;
  /** github.min.css and github-dark.min.css (highlight.js); empty strings when highlighting is off. */
  codeCss: { light: string; dark: string };
  generator: string;
  theme: 'light' | 'dark' | 'auto';
  maxWidth: number;
  toc?: { html: string; position: 'top' | 'sidebar' | 'page' };
  /** Print layout for PDF. */
  print?: boolean;
  /** CSS font-family lists; Japanese fallbacks are appended. */
  font?: { family?: string; code?: string; pdfSize?: number };
  /** Document language (`ja` makes browsers pick Japanese glyphs). */
  lang?: string;
  /** @page rules for PDF (paper, margins, page numbers, header). */
  pageCss?: string;
  /** Extra CSS (KaTeX with its fonts as data URIs). */
  extraCss?: string;
}

/** Fallbacks so that Japanese never ends up in a Chinese or missing font, on any OS. */
export const JA_FALLBACK = `"Yu Gothic UI","Yu Gothic Medium","Meiryo","Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans CJK JP","Noto Sans JP","IPAPGothic",sans-serif`;
const DEFAULT_FAMILY = `-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial`;
const DEFAULT_CODE = `ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono"`;
/** Japanese glyphs inside code (comments, paths) in a fixed-width Japanese font. */
const JA_CODE_FALLBACK = `"BIZ UDGothic","MS Gothic","Osaka-Mono","Noto Sans Mono CJK JP","IPAGothic",monospace`;

/** The complete body font list (choice + defaults + Japanese fallbacks). */
export function bodyFontFamily(family?: string): string {
  return `${fontList(family, DEFAULT_FAMILY)},${JA_FALLBACK}`;
}

/** `ja` when the text contains kana or kanji, otherwise `en`. */
export function detectLang(text: string): string {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text) ? 'ja' : 'en';
}

/** Safe CSS font-family list (no braces / semicolons that could break out of the rule), or `fallback`. */
function fontList(list: string | undefined, fallback: string): string {
  const clean = (list ?? '').replace(/[{};<>\\]/g, '').trim().replace(/,\s*$/, '');
  return clean || fallback;
}

/** The exported single-file page. No <script>, everything inline. */
export function exportDocument(o: DocumentParts): string {
  const codeCss =
    o.theme === 'light'
      ? o.codeCss.light
      : o.theme === 'dark'
        ? o.codeCss.dark
        : `${o.codeCss.light}\n@media (prefers-color-scheme: dark) {\n${o.codeCss.dark}\n}`;
  const sidebar = o.toc?.position === 'sidebar';
  const main = `<main class="markdown-body">
${o.toc && o.toc.position !== 'sidebar' ? o.toc.html + '\n' : ''}${o.body}
</main>`;
  return `<!doctype html>
<html lang="${attr(o.lang ?? 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${attr(o.generator)}">
<title>${escapeText(o.title)}</title>
<style>
${codeCss}
${exportCss(o)}
${o.extraCss ?? ''}
${o.pageCss ?? ''}
</style>
</head>
<body class="theme-${o.theme}${sidebar ? ' with-sidebar' : ''}${o.print ? ' print' : ''}">
${sidebar ? `<div class="layout">\n${o.toc!.html}\n${main}\n</div>` : main}
</body>
</html>
`;
}

const LIGHT = `--fg:#1f2328;--muted:#59636e;--bg:#fff;--subtle:#f6f8fa;--border:#d1d9e0;--link:#0969da;--code-bg:rgba(129,139,152,.12);--error:#d1242f;--comment:#008000`;
const DARK = `--fg:#e6edf3;--muted:#9198a1;--bg:#0d1117;--subtle:#151b23;--border:#3d444d;--link:#4493f8;--code-bg:rgba(101,108,118,.2);--error:#f85149;--comment:#6a9955`;

function exportCss(o: DocumentParts): string {
  const vars =
    o.theme === 'light'
      ? `:root{${LIGHT}}`
      : o.theme === 'dark'
        ? `:root{${DARK};color-scheme:dark}`
        : `:root{${LIGHT}}@media (prefers-color-scheme: dark){:root{${DARK};color-scheme:dark}}`;
  // Diagrams and images are drawn for light backgrounds; give them a light card in dark mode.
  const darkCards = `.mermaid,.diagram,img{background:#fff}.mermaid,.diagram{padding:8px;border-radius:6px}.diagram-echarts,.diagram-mindmap{background:none;padding:0}`;
  const dark = o.theme === 'dark' ? darkCards : o.theme === 'auto' ? `@media (prefers-color-scheme: dark){${darkCards}}` : '';
  return `${vars}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:${bodyFontFamily(o.font?.family)};font-size:16px;line-height:1.6;word-wrap:break-word}
.markdown-body{max-width:${o.maxWidth}px;margin:0 auto;padding:32px 24px 64px;min-width:0}
.markdown-body>*:first-child{margin-top:0}
h1,h2,h3,h4,h5,h6{margin:24px 0 16px;font-weight:600;line-height:1.25;scroll-margin-top:16px}
h1{font-size:2em;padding-bottom:.3em;border-bottom:1px solid var(--border)}
h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid var(--border)}
h3{font-size:1.25em}h4{font-size:1em}h5{font-size:.875em}h6{font-size:.85em;color:var(--muted)}
p,blockquote,ul,ol,dl,table,pre,details,.mermaid,.diagram,.math-block{margin:0 0 16px}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
ul,ol{padding-left:2em}li+li{margin-top:.25em}
li>input[type=checkbox]{margin:0 .35em .2em -1.4em;vertical-align:middle}
ul:has(>li>input[type=checkbox]){list-style:none}
blockquote{padding:0 1em;color:var(--muted);border-left:.25em solid var(--border)}
hr{height:.25em;padding:0;margin:24px 0;background:var(--border);border:0}
img{max-width:100%;height:auto}
code,kbd,pre,samp{font-family:${fontList(o.font?.code, DEFAULT_CODE)},${JA_CODE_FALLBACK};font-size:85%}
:not(pre)>code{padding:.2em .4em;background:var(--code-bg);border-radius:6px}
pre{padding:16px;overflow:auto;line-height:1.45;background:var(--subtle);border-radius:6px}
pre>code{padding:0;background:transparent;font-size:100%}
pre code.hljs{padding:0;background:transparent}
.hljs-comment{color:var(--comment)}
table{display:block;width:max-content;max-width:100%;overflow:auto;border-spacing:0;border-collapse:collapse}
th,td{padding:6px 13px;border:1px solid var(--border)}
th{font-weight:600;background:var(--subtle)}
tr:nth-child(2n) td{background:var(--subtle)}
.mermaid,.diagram,.math-block{text-align:center;overflow-x:auto}
.mermaid svg,.diagram svg,.diagram img{max-width:100%;height:auto}
.diagram-smiles svg{max-width:min(100%,360px)}
.mermaid-error,.diagram-error{text-align:left;border:1px solid var(--error);border-radius:6px;padding:8px 12px;color:var(--error)}
${dark}
.toc{font-size:.95em}
.toc-title{font-weight:600;font-size:1.25em;margin:0 0 8px}
.toc ul{list-style:none;margin:0;padding:0}
.toc li{margin:0}
.toc a{display:flex;align-items:baseline;gap:6px;padding:2px 0;color:var(--fg)}
.toc a:hover{color:var(--link)}
.toc-text{min-width:0}
.toc-dots{flex:1;border-bottom:1px dotted var(--muted);transform:translateY(-4px);min-width:16px}
.toc-page{font-variant-numeric:tabular-nums}
.toc-page--placeholder{visibility:hidden}
.toc-l2{padding-left:1.25em}.toc-l3{padding-left:2.5em}.toc-l4{padding-left:3.75em}.toc-l5{padding-left:5em}.toc-l6{padding-left:6.25em}
.toc-l1>a{font-weight:600}
.toc-top{margin:0 0 32px;padding:16px 20px;background:var(--subtle);border-radius:6px}
.layout{display:block}
.toc-sidebar{padding:24px 16px 24px 24px;border-bottom:1px solid var(--border)}
@media (min-width:1000px){
.layout{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);align-items:start}
.toc-sidebar{position:sticky;top:0;max-height:100vh;overflow:auto;border-bottom:0;border-right:1px solid var(--border)}
.toc-sidebar .toc-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
}
.toc-page-break{break-after:page}
body.print{font-size:${o.font?.pdfSize ?? 10.5}pt}
body.print .markdown-body{max-width:none;padding:0}
body.print pre{white-space:pre-wrap;word-break:break-word;overflow:visible}
body.print table{display:table;width:auto;overflow:visible}
body.print .toc{font-size:10.5pt}
@media print{
.markdown-body{max-width:none;padding:0}
.toc-sidebar{display:none}
.layout{display:block}
h1,h2,h3,h4,h5,h6{break-after:avoid}
pre,table,.mermaid,.diagram,.math-block,img,blockquote{break-inside:avoid}
tr,li{break-inside:avoid}
}`;
}

const PAPER_MM: Record<string, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  B5: [182, 257],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
};
const MARGIN_MM = { narrow: 10, normal: 15, wide: 25 };

/** A CSS string literal (also safe inside <style>). */
function cssString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ').replace(/</g, '\\3c ')}"`;
}

/**
 * Paper, margins, page numbers and header as CSS @page rules, so that both print methods
 * (--print-to-pdf and the DevTools protocol) produce the same pages.
 */
export function pageCss(o: ExportOptions, title: string): string {
  let [w, h] = PAPER_MM[o.pdf.paper] ?? PAPER_MM.A4;
  if (o.pdf.landscape) [w, h] = [h, w];
  const m = MARGIN_MM[o.pdf.margin] ?? MARGIN_MM.normal;
  const top = o.pdf.headerTitle ? Math.max(m, 15) : m;
  const bottom = o.pdf.pageNumbers ? Math.max(m, 15) : m;
  const box = 'font-size:8pt;color:#777;font-family:sans-serif';
  const boxes =
    (o.pdf.pageNumbers ? `@bottom-center{content:counter(page) " / " counter(pages);${box}}` : '') +
    (o.pdf.headerTitle ? `@top-left{content:${cssString(title)};${box}}` : '');
  return `@page{size:${w}mm ${h}mm;margin:${top}mm ${m}mm ${bottom}mm;${boxes}}`;
}
