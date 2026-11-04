'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { MessageQueue } = require('../electron/session');

test('先入先出地消费队列', async () => {
  const queue = new MessageQueue();
  queue.push('a');
  queue.push('b');

  const iterator = queue[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value, 'a');
  assert.equal((await iterator.next()).value, 'b');
});

test('没有消息时挂起等待，push 后唤醒', async () => {
  const queue = new MessageQueue();
  const iterator = queue[Symbol.asyncIterator]();

  const pending = iterator.next();
  queue.push('later');

  const result = await pending;
  assert.equal(result.done, false);
  assert.equal(result.value, 'later');
});

test('close 后迭代器结束，且不再接收新消息', async () => {
  const queue = new MessageQueue();
  const iterator = queue[Symbol.asyncIterator]();

  const pending = iterator.next();
  queue.close();

  const result = await pending;
  assert.equal(result.done, true);

  queue.push('ignored');
  assert.equal((await iterator.next()).done, true);
});
