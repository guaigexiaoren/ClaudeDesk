'use strict';

/**
 * 单个回合的计时（参考 Codex 的 "Worked for"）：
 * - 从最后一次用户发消息开始累计
 * - 等待用户确认权限/回答/审批计划时暂停
 * - 回合结束后显示该回合完整的 duration_ms
 * 不跨回合累计，也不把两个回合之间的空闲时间算进去。
 */
function startTurn(startedAt) {
  return {
    startedAt: Number(startedAt) || 0,
    pausedAt: 0,
    pausedTotal: 0,
    lastDurationMs: 0,
  };
}

function pauseTurn(timing, now) {
  if (!timing || timing.pausedAt) return timing;
  return { ...timing, pausedAt: Number(now) || 0 };
}

function resumeTurn(timing, now) {
  if (!timing || !timing.pausedAt) return timing;
  const at = Number(now) || 0;
  return {
    ...timing,
    pausedAt: 0,
    pausedTotal: timing.pausedTotal + Math.max(0, at - timing.pausedAt),
  };
}

function turnElapsed(timing, now) {
  if (!timing || !timing.startedAt) return 0;
  const at = Number(now) || 0;
  const currentPause = timing.pausedAt ? Math.max(0, at - timing.pausedAt) : 0;
  return Math.max(0, at - timing.startedAt - timing.pausedTotal - currentPause);
}

function finishTurn(timing, durationMs, now) {
  if (!timing) timing = startTurn(now);
  const elapsed = turnElapsed(timing, now);
  const duration = Number(durationMs);
  return {
    ...timing,
    pausedAt: 0,
    lastDurationMs: Math.max(
      0,
      Math.round(Number.isFinite(duration) && duration > 0 ? duration : elapsed)
    ),
  };
}

function lastTurnTiming(durationMs) {
  return { ...startTurn(0), lastDurationMs: Math.max(0, Math.round(Number(durationMs) || 0)) };
}

module.exports = {
  startTurn,
  pauseTurn,
  resumeTurn,
  turnElapsed,
  finishTurn,
  lastTurnTiming,
};
