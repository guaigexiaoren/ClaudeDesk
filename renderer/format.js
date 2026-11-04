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

module.exports = { formatDuration };
