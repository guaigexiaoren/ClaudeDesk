'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createDraftStore } = require('../renderer/composer-drafts');

test('保存并恢复文字和附件', () => {
  const store = createDraftStore();
  const attachments = [{ name: 'a.png', data: 'AAAA' }];
  store.set('k1', { text: '你好', attachments, start: 2, end: 2 });
  const draft = store.get('k1');
  assert.equal(draft.text, '你好');
  assert.deepEqual(draft.attachments, attachments);
  assert.equal(draft.start, 2);
});

test('附件数组是副本', () => {
  const store = createDraftStore();
  const attachments = [{ name: 'a.png' }];
  store.set('k1', { text: '', attachments });
  attachments.push({ name: 'b.png' });
  assert.equal(store.get('k1').attachments.length, 1);
});

test('超过数量时淘汰最久未用', () => {
  const store = createDraftStore({ maxEntries: 2 });
  store.set('a', { text: 'a' });
  store.set('b', { text: 'b' });
  store.set('c', { text: 'c' });
  assert.equal(store.size, 2);
  assert.equal(store.get('a'), null);
  assert.equal(store.get('c').text, 'c');
});

test('get 会刷新使用顺序', () => {
  const store = createDraftStore({ maxEntries: 2 });
  store.set('a', { text: 'a' });
  store.set('b', { text: 'b' });
  store.get('a');
  store.set('c', { text: 'c' });
  assert.equal(store.get('b'), null);
  assert.equal(store.get('a').text, 'a');
});

test('超过字节上限淘汰旧草稿，最新一条保留', () => {
  const store = createDraftStore({ maxEntries: 10, maxBytes: 100 });
  store.set('old', { text: 'a'.repeat(30) });
  store.set('new', { text: 'b'.repeat(60) });
  assert.equal(store.get('old'), null);
  assert.equal(store.get('new').text.length, 60);
  assert.ok(store.bytes > 100);
});
