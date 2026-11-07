'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { formatDuration, formatStallLabel } = require('../renderer/format');

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

test('不足 30 秒没有卡住提示', () => {
  assert.equal(formatStallLabel(29000), '');
});

test('30 秒提示可能只是长任务', () => {
  assert.equal(formatStallLabel(30000), '已等待 30 秒，可能正在执行长任务…');
  assert.equal(formatStallLabel(90000), '已等待 90 秒，可能正在执行长任务…');
});

test('2 分钟提示可能卡住', () => {
  assert.equal(
    formatStallLabel(120000),
    '可能已卡住：120 秒没有新事件（可点停止）'
  );
});
