import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEdit, matchLines, minimalReplace } from '../src/merge.ts';

test('no edit returns the original byte for byte', () => {
  const orig = '* a\r\n* b\r\n\r\n\r\n|x|y|\r\n|-|-|\r\n|1|2|\r\n';
  const norm = '* a\n* b\n\n| x | y |\n| - | - |\n| 1 | 2 |\n';
  assert.equal(mergeEdit(orig, norm, norm), orig);
});

test('edit in one paragraph keeps reformatted blocks elsewhere', () => {
  const orig = ['# Title', '', '* one', '* two', '', 'Hello world.', '', '|a|b|', '|-|-|', '|1|2|', ''].join('\n');
  const norm = ['# Title', '', '* one', '* two', '', 'Hello world.', '', '| a | b |', '| - | - |', '| 1 | 2 |', ''].join('\n');
  const next = norm.replace('Hello world.', 'Hello there.');
  assert.equal(mergeEdit(orig, norm, next), orig.replace('Hello world.', 'Hello there.'));
});

test('edit inside a reformatted table takes the new table only', () => {
  const orig = ['Intro', '', '|a|b|', '|-|-|', '|1|2|', '', 'Outro  ', ''].join('\n');
  const norm = ['Intro', '', '| a | b |', '| - | - |', '| 1 | 2 |', '', 'Outro', ''].join('\n');
  const next = norm.replace('| 1 | 2 |', '| 1 | 3 |');
  const out = mergeEdit(orig, norm, next);
  assert.equal(out, ['Intro', '', '| a | b |', '| - | - |', '| 1 | 3 |', '', 'Outro  ', ''].join('\n'));
});

test('insertions at start, middle, end and deletions', () => {
  const orig = 'a\n\n\n\nb\n\nc\n';
  const norm = 'a\n\nb\n\nc\n';
  assert.equal(mergeEdit(orig, norm, 'z\n\na\n\nb\n\nc\n'), 'z\n\na\n\n\n\nb\n\nc\n');
  assert.equal(mergeEdit(orig, norm, 'a\n\nb\n\nc\n\nz\n'), 'a\n\n\n\nb\n\nc\n\nz\n');
  assert.equal(mergeEdit(orig, norm, 'a\n\nc\n'), 'a\n\n\n\nc\n');
  assert.equal(mergeEdit(orig, norm, 'a\n\nb\nx\n\nc\n'), 'a\n\n\n\nb\nx\n\nc\n');
});

test('CRLF is preserved for new lines', () => {
  const orig = 'a\r\nb\r\n';
  assert.equal(mergeEdit(orig, 'a\nb\n', 'a\nb\nc\n'), 'a\r\nb\r\nc\r\n');
});

test('result equals next when everything is touched', () => {
  const orig = 'x\ny\n';
  const norm = 'x\ny\n';
  assert.equal(mergeEdit(orig, norm, 'p\nq\nr\n'), 'p\nq\nr\n');
});

test('matchLines finds an LCS on random input', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 200; t++) {
    const a = Array.from({ length: Math.floor(rnd() * 30) }, () => String(Math.floor(rnd() * 5)));
    const b = Array.from({ length: Math.floor(rnd() * 30) }, () => String(Math.floor(rnd() * 5)));
    const pairs = matchLines(a, b);
    let pi = -1, pj = -1;
    for (const [i, j] of pairs) {
      assert.equal(a[i], b[j]);
      assert.ok(i > pi && j > pj);
      pi = i; pj = j;
    }
    // Random merges must reproduce `next` when orig === norm.
    const na = a.join('\n'), nb = b.join('\n');
    assert.equal(mergeEdit(na, na, nb), nb);
  }
});

test('large documents are fast', () => {
  const lines = Array.from({ length: 20000 }, (_, k) => (k % 7 === 0 ? '' : `line ${k}`));
  const orig = lines.map((l) => (l.startsWith('line 1') ? `* ${l}` : l)).join('\n');
  const norm = lines.map((l) => (l.startsWith('line 1') ? `- ${l}` : l)).join('\n');
  const next = norm.replace('line 5000', 'line five thousand');
  const t0 = Date.now();
  const out = mergeEdit(orig, norm, next);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(out, orig.replace('line 5000', 'line five thousand'));
});

test('minimalReplace', () => {
  assert.equal(minimalReplace('abc', 'abc'), undefined);
  assert.deepEqual(minimalReplace('hello world', 'hello there world'), { start: 6, end: 6, text: 'there ' });
  assert.deepEqual(minimalReplace('a\r\nb', 'a\r\nc'), { start: 3, end: 4, text: 'c' });
  const r = minimalReplace('x\r\n', 'x\r\n\r\n');
  const from = 'x\r\n';
  assert.equal(from.slice(0, r.start) + r.text + from.slice(r.end), 'x\r\n\r\n');
});
