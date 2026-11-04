'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { formatDuration } = require('../renderer/format');

test('不足一分钟时显示秒', () => {
  assert.equal(formatDuration(3900), '4 秒');
  assert.equal(formatDuration(0), '0 秒');
});

test('超过一分钟时显示分和秒', () => {
  assert.equal(formatDuration(65000), '1 分 5 秒');
  assert.equal(formatDuration(119000), '1 分 59 秒');
});

test('整分钟不显示秒', () => {
  assert.equal(formatDuration(120000), '2 分');
});
