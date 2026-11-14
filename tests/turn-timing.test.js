'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  startTurn,
  pauseTurn,
  resumeTurn,
  turnElapsed,
  finishTurn,
  lastTurnTiming,
} = require('../renderer/turn-timing');

test('从用户发消息开始累计', () => {
  const turn = startTurn(1000);
  assert.equal(turnElapsed(turn, 4000), 3000);
  assert.equal(turnElapsed(turn, 61_000), 60_000);
});

test('等待用户确认时暂停，恢复后继续累计', () => {
  let turn = startTurn(1000);
  turn = pauseTurn(turn, 3000);
  assert.equal(turnElapsed(turn, 10_000), 2000);
  turn = resumeTurn(turn, 10_000);
  assert.equal(turnElapsed(turn, 12_000), 4000);
});

test('重复暂停/恢复不会重复扣减', () => {
  let turn = startTurn(1000);
  turn = pauseTurn(turn, 2000);
  turn = pauseTurn(turn, 3000);
  assert.equal(turnElapsed(turn, 4000), 1000);
  turn = resumeTurn(turn, 4000);
  turn = resumeTurn(turn, 5000);
  assert.equal(turnElapsed(turn, 6000), 3000);
});

test('回合结束优先使用服务端 duration_ms', () => {
  let turn = startTurn(1000);
  turn = finishTurn(turn, 12_500, 20_000);
  assert.equal(turn.lastDurationMs, 12_500);
  assert.equal(turn.pausedAt, 0);
});

test('没有 duration_ms 时用暂停后的本地计时兜底', () => {
  let turn = startTurn(1000);
  turn = pauseTurn(turn, 3000);
  turn = resumeTurn(turn, 8000);
  turn = finishTurn(turn, 0, 10_000);
  // 1000→3000 + 8000→10000 = 4000
  assert.equal(turn.lastDurationMs, 4000);
});

test('从用量日志恢复上一回合用时', () => {
  const turn = lastTurnTiming(18_188);
  assert.equal(turn.lastDurationMs, 18_188);
  assert.equal(turn.startedAt, 0);
  assert.equal(turnElapsed(turn, 999_999), 0);
});
