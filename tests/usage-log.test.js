'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  computeCost,
  costFromUsage,
  usageFromResult,
  aggregateModelUsage,
  diffUsage,
  appendUsage,
  readUsage,
  summarize,
  rangeSince,
} = require('../electron/usage-log');

const pricing = { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 };

test('按 CC Switch 公式计算成本', () => {
  const cost = computeCost(
    {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
    },
    pricing,
    1
  );
  assert.ok(Math.abs(cost - (3 + 15 + 0.3)) < 1e-9);

  const withMultiplier = computeCost(
    { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    pricing,
    2
  );
  assert.equal(withMultiplier, 6);
});

test('1 小时缓存写入按 1.6 倍计价', () => {
  const fiveMinute = computeCost(
    { cache_creation_input_tokens: 1_000_000 },
    { cacheCreation: 10 },
    1
  );
  const oneHour = computeCost(
    { cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_1h_input_tokens: 1_000_000 } },
    { cacheCreation: 10 },
    1
  );
  assert.equal(fiveMinute, 10);
  assert.ok(Math.abs(oneHour - 16) < 1e-9);
});

test('没有配置价格时返回 null，而不是 0', () => {
  assert.equal(computeCost({ input_tokens: 100 }, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }), null);
  assert.equal(computeCost({ input_tokens: 100 }, null), null);
});

test('读写用量日志并按时间过滤', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudedesk-usage-'));
  try {
    const file = path.join(dir, 'usage.jsonl');
    const now = Date.now();
    appendUsage(file, { t: now - 10_000, input: 100, output: 20, cacheRead: 300, cacheWrite: 0, costUsd: 0.01, durationMs: 1000, ttftMs: 200 });
    appendUsage(file, { t: now, input: 50, output: 10, cacheRead: 100, cacheWrite: 50, costUsd: null, durationMs: 500, ttftMs: null });
    assert.equal(readUsage(file).length, 2);
    assert.equal(readUsage(file, { since: now - 1000 }).length, 1);
    assert.equal(readUsage(file, { until: now - 1000 }).length, 1);
    assert.equal(readUsage(file, { since: now - 1000, until: now }).length, 1);

    const summary = summarize(readUsage(file, { since: now - 1000 }));
    assert.equal(summary.requests, 1);
    assert.equal(summary.tokens, 50 + 10 + 100 + 50);
    assert.equal(summary.costUsd, null);
    assert.equal(summary.costKnown, false);
    assert.ok(Math.abs(summary.cacheHitRate - 100 / 200) < 1e-9);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('汇总请求数、成本、缓存命中率和速度', () => {
  const summary = summarize([
    { input: 100, output: 50, cacheRead: 300, cacheWrite: 0, costUsd: 0.1, durationMs: 1000, ttftMs: 200 },
    { input: 0, output: 50, cacheRead: 500, cacheWrite: 0, costUsd: 0.2, durationMs: 1000, ttftMs: 400 },
  ]);
  assert.equal(summary.requests, 2);
  assert.equal(summary.tokens, 1000);
  assert.ok(Math.abs(summary.costUsd - 0.3) < 1e-9);
  assert.equal(summary.costKnown, true);
  assert.ok(Math.abs(summary.cacheHitRate - 800 / 900) < 1e-9);
  assert.ok(summary.speed > 0);
  assert.equal(summary.avgTtftMs, 300);
});

test('时间范围：今天从本地零点开始', () => {
  const since = rangeSince('today');
  const now = new Date();
  assert.equal(new Date(since).getHours(), 0);
  assert.equal(new Date(since).getMinutes(), 0);
  assert.equal(rangeSince('all'), 0);
  assert.ok(rangeSince('7d') < Date.now());
});

test('汇总 modelUsage 并逐回合差分（包含子代理）', () => {
  const first = aggregateModelUsage({
    opus: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 300,
      cacheCreationInputTokens: 50,
      cacheCreationEphemeral1hInputTokens: 10,
    },
    haiku: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
  });
  assert.deepEqual(first, { input: 110, output: 25, cacheRead: 300, cacheWrite: 50, cache1h: 10 });

  const second = { ...first, input: 160, output: 45, cacheRead: 600 };
  assert.deepEqual(diffUsage(second, first), {
    input: 50,
    output: 20,
    cacheRead: 300,
    cacheWrite: 0,
    cache1h: 0,
  });

  // /clear 导致累计值变小：直接用当前值
  assert.deepEqual(diffUsage({ ...first, input: 5 }, first), { ...first, input: 5 });
});

test('从 result.usage 转换并计算成本', () => {
  const usage = usageFromResult({
    input_tokens: 100,
    output_tokens: 20,
    cache_read_input_tokens: 300,
    cache_creation_input_tokens: 50,
    cache_creation: { ephemeral_1h_input_tokens: 10 },
  });
  assert.deepEqual(usage, { input: 100, output: 20, cacheRead: 300, cacheWrite: 50, cache1h: 10 });
  const cost = costFromUsage(usage, { input: 1, output: 2, cacheRead: 0.1, cacheCreation: 1 }, 1);
  assert.ok(cost > 0);
});

test('读取超过 5000 行的用量日志时不丢早期记录', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudedesk-usage-'));
  try {
    const file = path.join(dir, 'usage.jsonl');
    const lines = [];
    for (let i = 1; i <= 5005; i += 1) {
      lines.push(JSON.stringify({ t: i, input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }));
    }
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    const entries = readUsage(file);
    assert.equal(entries.length, 5005);
    assert.equal(entries[0].t, 1);
    assert.equal(entries[entries.length - 1].t, 5005);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
