import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const common = { bundle: true, minify: !watch, sourcemap: watch ? 'inline' : false, logLevel: 'info' };

const configs = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: { editor: 'src/webview/editor.ts', export: 'src/webview/exportPanel.ts' },
    loader: { '.svg': 'text' },
    outdir: 'dist/webview',
    platform: 'browser',
    format: 'iife',
    target: 'chrome114',
  },
];

if (watch) {
  for (const c of configs) await (await esbuild.context(c)).watch();
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
}
