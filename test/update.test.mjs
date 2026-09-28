import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, newestVsix } from '../src/versions.ts';

test('compareVersions', () => {
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('1.2.3', '1.3.0') < 0);
});

test('newestVsix picks the highest version of this extension only', () => {
  const files = ['md-studio-0.2.0.vsix', 'md-studio-0.10.1.vsix', 'md-studio-0.9.0.vsix', 'other-9.9.9.vsix', 'md-studio-latest.vsix', 'README.txt'];
  assert.deepEqual(newestVsix(files, 'md-studio'), { file: 'md-studio-0.10.1.vsix', version: '0.10.1' });
  assert.equal(newestVsix(['x.vsix'], 'md-studio'), undefined);
});
