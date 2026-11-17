'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  compareVersions,
  evaluateUpdate,
  pickNewestCommit,
} = require('../electron/update-check');

test('版本号按数字段比较', () => {
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('v1.0.10', '1.0.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
});

test('远程版本更高时提示更新', () => {
  const result = evaluateUpdate({
    currentVersion: '1.0.0',
    buildTime: '2026-11-14T10:00:00.000Z',
    buildCommit: 'aaa',
    remoteVersion: '1.0.1',
    remoteCommit: { sha: 'bbb', date: '2026-11-13T10:00:00.000Z', message: 'x' },
  });
  assert.equal(result.hasUpdate, true);
  assert.equal(result.reason, 'version');
});

test('版本相同但 main 有新提交时提示更新', () => {
  const result = evaluateUpdate({
    currentVersion: '1.0.0',
    buildTime: '2026-11-14T10:00:00.000Z',
    buildCommit: 'aaa',
    remoteVersion: '1.0.0',
    remoteCommit: { sha: 'bbb', date: '2026-11-15T10:00:00.000Z', message: '新提交' },
  });
  assert.equal(result.hasUpdate, true);
  assert.equal(result.reason, 'commit');
});

test('同一提交或更早提交不提示更新', () => {
  const same = evaluateUpdate({
    currentVersion: '1.0.0',
    buildTime: '2026-11-14T10:00:00.000Z',
    buildCommit: 'aaa',
    remoteVersion: '1.0.0',
    remoteCommit: { sha: 'aaa', date: '2026-11-15T10:00:00.000Z' },
  });
  assert.equal(same.hasUpdate, false);

  const older = evaluateUpdate({
    currentVersion: '1.0.0',
    buildTime: '2026-11-14T10:00:00.000Z',
    buildCommit: 'aaa',
    remoteVersion: '1.0.0',
    remoteCommit: { sha: 'bbb', date: '2026-11-13T10:00:00.000Z' },
  });
  assert.equal(older.hasUpdate, false);
});

test('从多个分支提交中选出最新提交', () => {
  const latest = pickNewestCommit([
    { branch: 'main', sha: 'aaa', date: '2026-11-12T08:44:25Z' },
    { branch: 'feat/ui-ticket-desk', sha: 'bbb', date: '2026-11-16T16:17:06Z' },
    { branch: 'feat/old', sha: 'ccc', date: '2026-11-15T10:00:00Z' },
  ]);
  assert.equal(latest.sha, 'bbb');
  assert.equal(latest.branch, 'feat/ui-ticket-desk');
  assert.equal(pickNewestCommit([]), null);
  assert.equal(pickNewestCommit([{ branch: 'x', sha: '', date: '' }]), null);
});

test('远端分支领先构建提交时提示更新（即使提交时间早于构建时间）', () => {
  const result = evaluateUpdate({
    currentVersion: '1.0.0',
    buildTime: '2026-11-17T10:00:00.000Z',
    buildCommit: 'a9c0018',
    remoteVersion: '1.0.0',
    remoteCommit: { sha: 'ec222dd', date: '2026-11-16T16:17:06.000Z' },
    comparison: { status: 'ahead', aheadBy: 1 },
  });
  assert.equal(result.hasUpdate, true);
  assert.equal(result.reason, 'commit');
});
