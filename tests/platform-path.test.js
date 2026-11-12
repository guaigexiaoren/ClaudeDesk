'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { withDarwinPath } = require('../electron/platform-path');

test('macOS 补充 Homebrew 路径且去重', () => {
  const env = withDarwinPath({ PATH: '/usr/bin:/usr/local/bin' }, 'darwin');
  const parts = env.PATH.split(':');
  assert.ok(parts.includes('/opt/homebrew/bin'));
  assert.ok(parts.includes('/usr/local/bin'));
  assert.equal(parts.filter((p) => p === '/usr/local/bin').length, 1);
});

test('非 macOS 不改 PATH', () => {
  const original = { PATH: 'C:\\Windows' };
  assert.equal(withDarwinPath(original, 'win32'), original);
});
