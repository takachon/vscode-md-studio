import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findImages, resizedImage } from '../src/webview/imageMenu.ts';

test('findImages skips code and keeps source order', () => {
  const md = '![a](x.png)\n\n```\n![no](code.png)\n```\n\n`![no](span.png)` <img src="y.png" width=10> ![c][ref] ![d](<my file.png> "T")\n';
  const refs = findImages(md);
  assert.deepEqual(refs.map((r) => [r.kind, r.src]), [['md', 'x.png'], ['html', 'y.png'], ['ref', ''], ['md', 'my file.png']]);
  assert.equal(refs[3].title, 'T');
});

test('resizedImage converts to <img width> and back', () => {
  const md = '![a b](dir/x%20y.png)';
  const [r] = findImages(md);
  const html = resizedImage(md, r, '50%');
  assert.equal(html, '<img src="dir/x%20y.png" alt="a b" width="50%">');
  const [r2] = findImages(html);
  assert.equal(resizedImage(html, r2, '300'), '<img src="dir/x%20y.png" alt="a b" width="300">');
  assert.equal(resizedImage(html, r2, ''), '![a b](dir/x%20y.png)');
  const titled = '<img src="x.png" alt="a" title="T" width="5">';
  assert.equal(resizedImage(titled, findImages(titled)[0], ''), '![a](x.png "T")');
  const keep = '<img src="x.png" class="c" height="20" width="5">';
  assert.equal(resizedImage(keep, findImages(keep)[0], ''), '<img src="x.png" class="c">');
});
