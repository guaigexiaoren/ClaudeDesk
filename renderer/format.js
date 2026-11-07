'use strict';

/**
 * 把毫秒格式化成「X 分 Y 秒」。
 * 不足一分钟只显示秒，整分钟时省略秒。
 */
function formatDuration(ms) {
  const total = Math.round((Number(ms) || 0) / 1000);
  if (total < 60) return `${total} 秒`;

  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds === 0 ? `${minutes} 分` : `${minutes} 分 ${seconds} 秒`;
}

/**
 * 长时间没有收到新事件时的提示文案。
 * 不足 30 秒返回空字符串；30 秒提醒可能只是长任务；2 分钟才提示可能卡住。
 */
function formatStallLabel(idleMs) {
  const seconds = Math.max(0, Math.round((Number(idleMs) || 0) / 1000));
  if (seconds >= 120) return `可能已卡住：${seconds} 秒没有新事件（可点停止）`;
  if (seconds >= 30) return `已等待 ${seconds} 秒，可能正在执行长任务…`;
  return '';
}

module.exports = { formatDuration, formatStallLabel };
