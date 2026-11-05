'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildSessionGroups } = require('../renderer/session-groups');

const SESSIONS = [
  { sessionId: 'a', cwd: 'C:\\work\\alpha', lastModified: 100, createdAt: 100 },
  { sessionId: 'b', cwd: 'C:\\work\\alpha', lastModified: 50, createdAt: 300 },
  { sessionId: 'c', cwd: 'C:\\work\\beta', lastModified: 999, createdAt: 200 },
];

test('按目录分组，并按创建时间排序', () => {
  const groups = buildSessionGroups(SESSIONS, [], '');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, 'alpha');
  assert.deepEqual(
    groups[0].sessions.map((session) => session.sessionId),
    ['b', 'a']
  );
});

test('发消息更新最后修改时间后，顺序保持不变', () => {
  const updated = SESSIONS.map((session) =>
    session.sessionId === 'a' ? { ...session, lastModified: 99999 } : session
  );
  const groups = buildSessionGroups(updated, [], '');
  assert.deepEqual(
    groups.find((group) => group.name === 'alpha').sessions.map((session) => session.sessionId),
    ['b', 'a']
  );
});

test('回收站里的会话不出现在列表中', () => {
  const groups = buildSessionGroups(SESSIONS, [{ sessionId: 'b' }], '');
  const alpha = groups.find((group) => group.name === 'alpha');
  assert.deepEqual(
    alpha.sessions.map((session) => session.sessionId),
    ['a']
  );
});

test('当前目录没有会话时也会显示这个分组', () => {
  const groups = buildSessionGroups(SESSIONS, [], 'C:\\work\\gamma');
  const gamma = groups.find((group) => group.dir === 'C:\\work\\gamma');
  assert.ok(gamma, '应该包含当前目录');
  assert.equal(gamma.sessions.length, 0);
});

test('置顶会话单独成组并排在最前', () => {
  const sessions = SESSIONS.map((session, index) => ({
    ...session,
    title: ['构建界面', '修复滚动', '导出功能'][index],
  }));
  const groups = buildSessionGroups(sessions, [], '', { pinned: ['a', 'c'] });

  assert.equal(groups[0].name, '置顶');
  assert.deepEqual(
    groups[0].sessions.map((session) => session.sessionId),
    ['c', 'a']
  );
  const alpha = groups.find((group) => group.name === 'alpha');
  assert.deepEqual(
    alpha.sessions.map((session) => session.sessionId),
    ['b']
  );
});

test('搜索按标题和目录过滤，搜索时不显示空目录', () => {
  const sessions = SESSIONS.map((session, index) => ({
    ...session,
    title: ['构建界面', '修复滚动', '导出功能'][index],
  }));

  const byTitle = buildSessionGroups(sessions, [], 'C:\\work\\empty', { query: '滚动' });
  assert.equal(byTitle.length, 1);
  assert.deepEqual(
    byTitle[0].sessions.map((session) => session.sessionId),
    ['b']
  );

  const byDir = buildSessionGroups(sessions, [], '', { query: 'beta' });
  assert.deepEqual(
    byDir[0].sessions.map((session) => session.sessionId),
    ['c']
  );

  const none = buildSessionGroups(sessions, [], 'C:\\work\\empty', { query: '不存在' });
  assert.equal(none.length, 0);
});
