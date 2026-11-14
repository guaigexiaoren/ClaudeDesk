'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  findSessionTranscript,
  buildPreCompactMessagesFromRaw,
  readPreCompactPage,
} = require('../electron/transcript');

const SESSION_ID = '11111111-2222-3333-4444-555555555555';

function line(obj) {
  return JSON.stringify(obj);
}

function user(uuid, parentUuid, text, extra = {}) {
  return {
    type: 'user',
    uuid,
    parentUuid,
    timestamp: '2026-01-01T00:00:00.000Z',
    message: { role: 'user', content: text },
    ...extra,
  };
}

function assistant(uuid, parentUuid, text, extra = {}) {
  return {
    type: 'assistant',
    uuid,
    parentUuid,
    timestamp: '2026-01-01T00:00:01.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    ...extra,
  };
}

function boundary(uuid, parentUuid, logicalParentUuid) {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    uuid,
    parentUuid,
    logicalParentUuid,
    timestamp: '2026-01-01T00:00:02.000Z',
  };
}

test('重建压缩前主链并过滤 sidechain/meta', () => {
  const raw = [
    user('u1', null, '第一个问题'),
    user('s1', 'u1', '子代理消息', { isSidechain: true }),
    user('m1', 's1', 'meta 消息', { isMeta: true }),
    assistant('a1', 'm1', '回答'),
    user('u2', 'a1', '工具结果', {
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }],
      },
    }),
    { type: 'attachment', uuid: 'x1', parentUuid: 'u2', attachment: {} },
    boundary('b1', null, 'u2'),
    user('summary', 'b1', 'summary', {
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    }),
  ]
    .map(line)
    .join('\n');

  const messages = buildPreCompactMessagesFromRaw(raw);
  assert.deepEqual(
    messages.map((item) => item.uuid),
    ['u1', 'a1', 'u2']
  );
  assert.equal(messages[2].message.content[0].type, 'tool_result');
});

test('分页从链尾向前取，页内保持旧到新顺序', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudedesk-transcript-'));
  try {
    const file = path.join(dir, `${SESSION_ID}.jsonl`);
    fs.writeFileSync(
      file,
      [
        user('u1', null, 'q1'),
        assistant('a1', 'u1', 'a1'),
        user('u2', 'a1', 'q2'),
        boundary('b1', null, 'u2'),
      ]
        .map(line)
        .join('\n'),
      'utf8'
    );
    const first = readPreCompactPage(file, { limit: 2, offset: 0 });
    assert.deepEqual(first.messages.map((item) => item.uuid), ['a1', 'u2']);
    assert.equal(first.total, 3);
    assert.equal(first.hasMore, true);
    assert.equal(first.nextOffset, 2);

    const second = readPreCompactPage(file, { limit: 2, offset: first.nextOffset });
    assert.deepEqual(second.messages.map((item) => item.uuid), ['u1']);
    assert.equal(second.hasMore, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('多次压缩通过 logicalParentUuid 串接更早的段', () => {
  const raw = [
    user('pre0', null, '旧问题'),
    boundary('b1', null, 'pre0'),
    { type: 'attachment', uuid: 'att1', parentUuid: 'b1', attachment: {} },
    user('sum1', 'att1', '更早的摘要', {
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    }),
    assistant('mid1', 'sum1', '第一次压缩后的回答'),
    boundary('b2', null, 'mid1'),
  ]
    .map(line)
    .join('\n');

  const messages = buildPreCompactMessagesFromRaw(raw);
  assert.deepEqual(
    messages.map((item) => item.uuid),
    ['pre0', 'sum1', 'mid1']
  );
});

test('查找 transcript 文件并拒绝非法 sessionId', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudedesk-home-'));
  try {
    const project = path.join(home, '.claude', 'projects', 'C--Windows-system32');
    fs.mkdirSync(project, { recursive: true });
    const file = path.join(project, `${SESSION_ID}.jsonl`);
    fs.writeFileSync(file, line(user('u1', null, 'q')), 'utf8');

    const found = findSessionTranscript(home, SESSION_ID);
    assert.equal(found.file, file);
    assert.equal(findSessionTranscript(home, '../evil'), null);
    assert.equal(findSessionTranscript(home, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
