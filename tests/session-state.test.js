'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { SessionManager, MessageQueue } = require('../electron/session');

function fakeQuery(messages) {
  return (async function* () {
    for (const message of messages) yield message;
  })();
}

test('回合中发送的消息带 priority、uuid 和 human 来源', () => {
  const session = new SessionManager();
  session.queue = new MessageQueue();
  session.query = {};

  const result = session.send('插入一句', { priority: 'next' });
  const message = session.queue.items[0];

  assert.equal(result.ok, true);
  assert.equal(result.uuid, message.uuid);
  assert.equal(message.priority, 'next');
  assert.equal(message.origin.kind, 'human');
  assert.ok(message.uuid);
});

test('init 到达时不会把 running 改回 idle', async () => {
  const session = new SessionManager();
  const query = fakeQuery([
    { type: 'system', subtype: 'init', session_id: 's1', model: 'm', cwd: '/tmp', tools: [] },
  ]);
  session.query = query;
  session.status = 'running';

  let statusAtInit = null;
  session.on('state', (state) => {
    if (state.tools) statusAtInit = state.status;
  });

  await session._pump(query);
  assert.equal(statusAtInit, 'running');
});

test('旧查询的收尾不会污染新会话', async () => {
  const session = new SessionManager();
  const oldQuery = fakeQuery([{ type: 'assistant', message: { content: [] } }]);
  session.query = oldQuery;

  const events = [];
  session.on('state', (state) => events.push(state));

  const pumping = session._pump(oldQuery);
  session.query = {}; // 模拟已切换到新会话
  await pumping;

  assert.equal(events.some((state) => state.ended), false);
});
