'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 成本公式与 CC Switch 一致：
 * 各项 tokens × 每百万单价 ÷ 1,000,000，最后乘供应商倍率。
 * Anthropic 的 input_tokens 不含缓存读/写，所以不重复扣减。
 * 1 小时缓存写入按 5 分钟缓存写入单价的 1.6 倍计。
 */
function computeCost(usage = {}, pricing = null, multiplier = 1) {
  if (!pricing) return null;
  const prices = [
    Number(pricing.input) || 0,
    Number(pricing.output) || 0,
    Number(pricing.cacheRead) || 0,
    Number(pricing.cacheCreation) || 0,
  ];
  if (!prices.some((value) => value > 0)) return null;

  const input = Number(usage.input_tokens) || 0;
  const output = Number(usage.output_tokens) || 0;
  const cacheRead = Number(usage.cache_read_input_tokens) || 0;
  const cacheCreation = Number(usage.cache_creation_input_tokens) || 0;
  const cache1h = Math.min(
    Number(usage.cache_creation?.ephemeral_1h_input_tokens) || 0,
    cacheCreation
  );

  const base =
    (input * prices[0] +
      output * prices[1] +
      cacheRead * prices[2] +
      (cacheCreation - cache1h + cache1h * 1.6) * prices[3]) /
    1_000_000;
  const factor = Number(multiplier);
  return base * (Number.isFinite(factor) && factor > 0 ? Math.min(factor, 10) : 1);
}

function appendUsage(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
}

function usageFromResult(usage = {}) {
  return {
    input: Number(usage.input_tokens) || 0,
    output: Number(usage.output_tokens) || 0,
    cacheRead: Number(usage.cache_read_input_tokens) || 0,
    cacheWrite: Number(usage.cache_creation_input_tokens) || 0,
    cache1h: Number(usage.cache_creation?.ephemeral_1h_input_tokens) || 0,
  };
}

function usageFromModelUsage(value = {}) {
  return {
    input: Number(value.inputTokens) || 0,
    output: Number(value.outputTokens) || 0,
    cacheRead: Number(value.cacheReadInputTokens) || 0,
    cacheWrite: Number(value.cacheCreationInputTokens) || 0,
    cache1h: Number(value.cacheCreationEphemeral1hInputTokens) || 0,
  };
}

/** modelUsage 是累计值，且包含子代理；按模型汇总后用于逐回合差分。 */
function aggregateModelUsage(modelUsage = {}) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cache1h: 0 };
  for (const value of Object.values(modelUsage || {})) {
    if (!value || typeof value !== 'object') continue;
    const item = usageFromModelUsage(value);
    total.input += item.input;
    total.output += item.output;
    total.cacheRead += item.cacheRead;
    total.cacheWrite += item.cacheWrite;
    total.cache1h += item.cache1h;
  }
  return total;
}

function diffUsage(current, previous) {
  const diff = {
    input: current.input - previous.input,
    output: current.output - previous.output,
    cacheRead: current.cacheRead - previous.cacheRead,
    cacheWrite: current.cacheWrite - previous.cacheWrite,
    cache1h: current.cache1h - previous.cache1h,
  };
  // /clear 会把累计值重置；出现负数时直接使用当前这一回合的累计值
  if (Object.values(diff).some((value) => value < 0)) return { ...current };
  return diff;
}

function costFromUsage(usage, pricing, multiplier = 1) {
  return computeCost(
    {
      input_tokens: usage.input,
      output_tokens: usage.output,
      cache_read_input_tokens: usage.cacheRead,
      cache_creation_input_tokens: usage.cacheWrite,
      cache_creation: { ephemeral_1h_input_tokens: usage.cache1h },
    },
    pricing,
    multiplier
  );
}

function readUsage(file, { since = 0, until = Infinity } = {}) {
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry.t === 'number' && entry.t >= since && entry.t <= until) {
        entries.push(entry);
      }
    } catch {
      /* 跳过坏行 */
    }
  }
  return entries;
}

function summarize(entries) {
  const input = entries.reduce((sum, item) => sum + (Number(item.input) || 0), 0);
  const output = entries.reduce((sum, item) => sum + (Number(item.output) || 0), 0);
  const cacheRead = entries.reduce((sum, item) => sum + (Number(item.cacheRead) || 0), 0);
  const cacheWrite = entries.reduce((sum, item) => sum + (Number(item.cacheWrite) || 0), 0);
  const known = entries.filter((item) => typeof item.costUsd === 'number');
  const costUsd = known.reduce((sum, item) => sum + item.costUsd, 0);
  const promptTokens = input + cacheRead + cacheWrite;
  const totalMs = entries.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0);
  const ttfts = entries
    .map((item) => Number(item.ttftMs))
    .filter((value) => Number.isFinite(value) && value >= 0);

  return {
    requests: entries.length,
    input,
    output,
    cacheRead,
    cacheWrite,
    tokens: input + output + cacheRead + cacheWrite,
    costUsd: known.length > 0 ? costUsd : null,
    costKnown: known.length === entries.length && entries.length > 0,
    costEntries: known.length,
    cacheHitRate: promptTokens > 0 ? cacheRead / promptTokens : null,
    avgTtftMs:
      ttfts.length > 0 ? ttfts.reduce((sum, value) => sum + value, 0) / ttfts.length : null,
    speed:
      totalMs > 0 && output > 0
        ? output / (Math.max(1, totalMs - (ttfts.length > 0 ? ttfts.reduce((s, v) => s + v, 0) : 0)) / 1000)
        : null,
  };
}

function rangeSince(range) {
  if (range === 'all') return 0;
  const now = new Date();
  if (range === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  const days = range === '30d' ? 30 : 7;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

module.exports = {
  computeCost,
  costFromUsage,
  usageFromResult,
  usageFromModelUsage,
  aggregateModelUsage,
  diffUsage,
  appendUsage,
  readUsage,
  summarize,
  rangeSince,
};
