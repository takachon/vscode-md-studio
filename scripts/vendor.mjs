// Copies the third-party runtime files the webviews need into media/vendor.
// Everything is served from the extension folder: nothing is fetched at run time.
import { cpSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, '..');
const out = join(root, 'media', 'vendor');
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Vditor: keep the layout under dist/ because Vditor loads its helpers from `${cdn}/dist/...`.
// Only what MD Studio uses is copied (no MathJax, WaveDrom, Vditor's Mermaid).
const vditor = pkgDir('vditor');
const vOut = join(out, 'vditor');
for (const p of [
  'LICENSE',
  'dist/index.min.js',
  'dist/index.css',
  'dist/css',
  'dist/images',
  'dist/js/lute',
  'dist/js/i18n',
  'dist/js/icons',
  'dist/js/katex',
  // Diagram blocks (src/webview/diagrams.ts).
  'dist/js/graphviz',
  'dist/js/flowchart.js',
  'dist/js/echarts',
  'dist/js/markmap',
  'dist/js/abcjs',
  'dist/js/smiles-drawer',
  'dist/js/plantuml',
  'dist/js/highlight.js/LICENSE',
  'dist/js/highlight.js/highlight.min.js',
  'dist/js/highlight.js/third-languages.js',
  'dist/js/highlight.js/styles/github.min.css',
  'dist/js/highlight.js/styles/github-dark.min.css',
]) {
  cpSync(join(vditor, p), join(vOut, p), { recursive: true });
}

// Mermaid: the IIFE build (defines window.mermaid). Vditor's own copy is intentionally not used.
const mermaid = pkgDir('mermaid');
mkdirSync(join(out, 'mermaid'), { recursive: true });
cpSync(join(mermaid, 'dist', 'mermaid.min.js'), join(out, 'mermaid', 'mermaid.min.js'));
cpSync(join(mermaid, 'LICENSE'), join(out, 'mermaid', 'LICENSE'));
const mermaidVersion = JSON.parse(readFileSync(join(mermaid, 'package.json'), 'utf8')).version;

const vditorVersion = JSON.parse(readFileSync(join(vditor, 'package.json'), 'utf8')).version;
writeFileSync(
  join(out, 'versions.json'),
  JSON.stringify({ vditor: vditorVersion, mermaid: mermaidVersion }, null, 2) + '\n',
);
console.log(`vendor: vditor ${vditorVersion}, mermaid ${mermaidVersion} -> ${out}`);
console.log(readdirSync(out).join(', '));
