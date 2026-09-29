import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, exportDocument, JA_FALLBACK } from '../src/html.ts';

const base = { title: 't', body: '<p>x</p>', codeCss: { light: '', dark: '' }, generator: 'g', theme: 'light', maxWidth: 900 };

test('Japanese documents are marked lang="ja" and always have Japanese fallbacks', () => {
  assert.equal(detectLang('概要です'), 'ja');
  assert.equal(detectLang('カタカナ'), 'ja');
  assert.equal(detectLang('plain text'), 'en');
  const html = exportDocument({ ...base, lang: 'ja', font: { family: '"Yu Mincho", serif', code: 'Consolas', pdfSize: 12 }, print: true });
  assert.match(html, /<html lang="ja">/);
  assert.ok(html.includes(`font-family:"Yu Mincho", serif,${JA_FALLBACK}`));
  assert.match(html, /code,kbd,pre,samp\{font-family:Consolas,"BIZ UDGothic","MS Gothic",.*monospace;/);
  assert.match(html, /body\.print\{font-size:12pt\}/);
});

test('font names cannot break out of the CSS rule', () => {
  const html = exportDocument({ ...base, font: { family: 'x;}</style><script>alert(1)</script>{' } });
  assert.doesNotMatch(html, /<script/);
  assert.equal((html.match(/<\/style>/g) ?? []).length, 1);
});

test('default font stack without settings', () => {
  const html = exportDocument(base);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /font-family:-apple-system,BlinkMacSystemFont,"Segoe UI"/);
});
