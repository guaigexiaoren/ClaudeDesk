'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ModelsDevPricingStore,
  normalizeModelId,
  deepSeekFamily,
  deepSeekSlot,
  deepSeekPricing,
  flattenModelsDev,
  resolvePricing,
} = require('../electron/pricing');

function utc(year, month, day, hour, minute = 0) {
  return Date.UTC(year, month - 1, day, hour, minute);
}

const deepseekProvider = { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic' };
const modelsDevStore = {
  get(modelId) {
    if (normalizeModelId(modelId) !== 'custom-model') return null;
    return {
      pricing: { input: 2, output: 8, cacheRead: 0.2, cacheCreation: 2 },
      source: 'models-dev',
      slot: null,
      discount: 1,
    };
  },
};

test('模型 ID 去掉命名空间、:变体和 [1m]', () => {
  assert.equal(normalizeModelId('deepseek/deepseek-flash[1m]'), 'deepseek-flash');
  assert.equal(normalizeModelId('deepseek-v4.1-flash:free'), 'deepseek-v4.1-flash');
  assert.equal(normalizeModelId('openai/gpt-5@2026-01-01'), 'gpt-5-2026-01-01');
  assert.equal(deepSeekFamily('deepseek-v4-flash'), 'flash');
  assert.equal(deepSeekFamily('deepseek-v4-pro'), 'pro');
  assert.equal(deepSeekFamily('deepseek-unknown'), null);
});

test('DeepSeek 北京时间高峰/空闲/周末/节假日', () => {
  // 2026-11-16 周一，北京时间 10:00
  assert.equal(deepSeekSlot(utc(2026, 11, 16, 2)).slot, 'peak');
  // 北京 12:00（午间空闲）
  assert.equal(deepSeekSlot(utc(2026, 11, 16, 4)).slot, 'offpeak');
  // 北京 13:30
  assert.equal(deepSeekSlot(utc(2026, 11, 16, 5, 30)).reason, 'offhours');
  // 北京 14:00 后重新高峰
  assert.equal(deepSeekSlot(utc(2026, 11, 16, 6)).slot, 'peak');
  // 北京 18:00 边界为空闲
  assert.equal(deepSeekSlot(utc(2026, 11, 16, 10)).slot, 'offpeak');
  // 周六全天
  assert.equal(deepSeekSlot(utc(2026, 11, 14, 2)).reason, 'weekend');
  // 2026 国庆
  assert.equal(deepSeekSlot(utc(2026, 10, 1, 2)).reason, 'holiday');
});

test('DeepSeek Flash/Pro 高峰价与空闲半价', () => {
  const peakAt = utc(2026, 11, 16, 2);
  const offpeakAt = utc(2026, 11, 16, 4);
  const flashPeak = deepSeekPricing('deepseek-flash[1m]', peakAt);
  const flashOff = deepSeekPricing('deepseek-flash[1m]', offpeakAt);
  assert.deepEqual(flashPeak.pricing, {
    input: 0.3,
    output: 1.2,
    cacheRead: 0.006,
    cacheCreation: 0,
  });
  assert.equal(flashOff.pricing.input, 0.15);
  assert.equal(flashOff.pricing.output, 0.6);
  assert.equal(flashOff.discount, 0.5);

  const pro = deepSeekPricing('deepseek-v4-pro', peakAt);
  assert.equal(pro.pricing.input, 1.32);
  assert.equal(pro.pricing.output, 3.96);
});

test('自动价格优先级：DeepSeek 官方 > models.dev > 旧手动', () => {
  const at = utc(2026, 11, 16, 2);
  const official = resolvePricing({
    provider: deepseekProvider,
    modelId: 'deepseek-flash',
    at,
    store: modelsDevStore,
    manualPricing: { input: 9, output: 9, cacheRead: 9, cacheCreation: 9 },
  });
  assert.equal(official.source, 'deepseek-official');
  assert.equal(official.pricing.input, 0.3);

  const claudeAlias = resolvePricing({
    provider: deepseekProvider,
    modelId: 'claude-opus-5',
    at,
    store: null,
  });
  assert.equal(claudeAlias.source, 'deepseek-official');
  assert.equal(claudeAlias.pricing.input, 1.32);
  assert.equal(claudeAlias.family, 'pro');

  const fromModelsDev = resolvePricing({
    provider: { name: 'Other', baseUrl: 'https://example.com' },
    modelId: 'custom-model',
    at,
    store: modelsDevStore,
  });
  assert.equal(fromModelsDev.source, 'models-dev');
  assert.equal(fromModelsDev.pricing.input, 2);

  const legacy = resolvePricing({
    provider: { name: 'Other', baseUrl: 'https://example.com' },
    modelId: 'unknown-model',
    at,
    store: modelsDevStore,
    manualPricing: { input: 9, output: 8, cacheRead: 1, cacheCreation: 2 },
  });
  assert.equal(legacy.source, 'legacy-manual');
  assert.equal(legacy.pricing.output, 8);

  assert.equal(
    resolvePricing({ provider: null, modelId: 'unknown-model', at, store: modelsDevStore }),
    null
  );
});

test('models.dev 数据扁平化与缓存持久化', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudedesk-pricing-'));
  try {
    const data = {
      deepseek: {
        name: 'DeepSeek',
        models: {
          'deepseek-flash': {
            name: 'DeepSeek Flash',
            cost: { input: 0.3, output: 1.2, cache_read: 0.006, cache_write: 0 },
          },
          deprecated: { status: 'deprecated', cost: { input: 1, output: 1 } },
        },
      },
      other: {
        name: 'Other',
        models: {
          'other/model[1m]': { name: 'Other Model', cost: { input: 2, output: 8 } },
        },
      },
    };
    const models = flattenModelsDev(data);
    assert.ok(models['deepseek-flash']);
    assert.ok(models['model']);
    assert.equal(models.deprecated, undefined);

    const store = new ModelsDevPricingStore(dir);
    assert.equal(store.isFresh(), false);
    const status = await store.sync(async () => JSON.stringify(data));
    assert.ok(status.fetchedAt > 0);
    assert.ok(status.count >= 2);
    assert.equal(store.get('deepseek-flash').pricing.output, 1.2);

    const reloaded = new ModelsDevPricingStore(dir);
    assert.equal(reloaded.get('deepseek-flash').pricing.input, 0.3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
