'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { THEMES, THEME_BACKGROUNDS, normalizeTheme } = require('../renderer/theme');

test('主题只有黑色和白色', () => {
  assert.deepEqual(THEMES, ['dark', 'light']);
  assert.equal(THEME_BACKGROUNDS.dark, '#14100e');
  assert.equal(THEME_BACKGROUNDS.light, '#f6f3ee');
});

test('规范化主题：只接受 light，其余回落到 dark', () => {
  assert.equal(normalizeTheme('light'), 'light');
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('LIGHT'), 'dark');
  assert.equal(normalizeTheme('white'), 'dark');
  assert.equal(normalizeTheme(''), 'dark');
  assert.equal(normalizeTheme(undefined), 'dark');
});
