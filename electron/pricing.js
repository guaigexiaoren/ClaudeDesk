'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MODELS_DEV_URL = 'https://models.dev/api.json';
const MODELS_DEV_FILE = 'models-dev-pricing.json';
const MODELS_DEV_REFRESH_MS = 6 * 60 * 60 * 1000;
const MODELS_DEV_MAX_BYTES = 32 * 1024 * 1024;

// 2026 年国务院办公厅放假安排（国办发明电〔2025〕7号）。
// DeepSeek 官方规则：周末和法定节假日全天按空闲时段（半价）计费。
const DEEPSEEK_HOLIDAYS = new Set();
for (const [month, from, to] of [
  [1, 1, 3],
  [2, 15, 23],
  [4, 4, 6],
  [5, 1, 5],
  [6, 19, 21],
  [9, 25, 27],
  [10, 1, 7],
]) {
  for (let day = from; day <= to; day += 1) {
    DEEPSEEK_HOLIDAYS.add(`2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
}
// 元旦是固定法定假日；2027 年完整安排尚未发布，先保住 1 月 1 日。
DEEPSEEK_HOLIDAYS.add('2027-01-01');

// DeepSeek 官方高峰价，单位：美元 / 百万 tokens。
// 空闲时段按官方规则乘以 0.5；DeepSeek 自动缓存不单收缓存写入费。
const DEEPSEEK_PEAK_PRICING = {
  flash: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheCreation: 0 },
  pro: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheCreation: 0 },
};

const DEEPSEEK_FLASH_MODELS = new Set([
  'deepseek-flash',
  'deepseek-v4-flash',
  'deepseek-v4.1-flash',
  'deepseek-v4.1-flash-1017',
  'deepseek-v4-flash-vision-exp',
  'deepseek-v4.1-flash-vision-exp',
]);
const DEEPSEEK_PRO_MODELS = new Set([
  'deepseek-pro',
  'deepseek-v4-pro',
  'deepseek-v4.1-pro',
  'deepseek-v4-pro-0813',
]);

function normalizeModelId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const afterSlash = text.slice(text.lastIndexOf('/') + 1);
  const beforeColon = afterSlash.split(':')[0] || '';
  let normalized = beforeColon.trim().replace(/@/g, '-').toLowerCase();
  if (normalized.endsWith('[1m]')) {
    normalized = normalized.slice(0, -'[1m]'.length).trim();
  }
  return normalized;
}

function isDeepSeekProvider(provider) {
  if (!provider) return false;
  return /deepseek/i.test(String(provider.baseUrl || '')) || /deepseek/i.test(String(provider.name || ''));
}

function deepSeekFamily(modelId) {
  const normalized = normalizeModelId(modelId);
  if (DEEPSEEK_FLASH_MODELS.has(normalized)) return 'flash';
  if (DEEPSEEK_PRO_MODELS.has(normalized)) return 'pro';
  return null;
}

/** DeepSeek 的 Anthropic 兼容端点会把 Claude 别名映射到自家模型。 */
function deepSeekFamilyForProvider(modelId, provider) {
  const family = deepSeekFamily(modelId);
  if (family) return family;
  if (!isDeepSeekProvider(provider)) return null;
  const normalized = normalizeModelId(modelId);
  if (normalized.startsWith('claude-opus')) return 'pro';
  if (/^claude-(sonnet|haiku|fable)/.test(normalized)) return 'flash';
  return null;
}

/** 北京时间（UTC+8）的高峰/空闲判断。 */
function deepSeekSlot(at = Date.now()) {
  const date = new Date(Number(at) || Date.now());
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = beijing.getUTCFullYear();
  const month = beijing.getUTCMonth() + 1;
  const day = beijing.getUTCDate();
  const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const weekday = beijing.getUTCDay();
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();

  if (weekday === 0 || weekday === 6) {
    return { slot: 'offpeak', discount: 0.5, reason: 'weekend', label: '空闲（周末，5 折）' };
  }
  if (DEEPSEEK_HOLIDAYS.has(dateKey)) {
    return { slot: 'offpeak', discount: 0.5, reason: 'holiday', label: '空闲（法定节假日，5 折）' };
  }
  const peak =
    (minutes >= 9 * 60 && minutes < 12 * 60) ||
    (minutes >= 14 * 60 && minutes < 18 * 60);
  if (peak) {
    return { slot: 'peak', discount: 1, reason: 'peak', label: '高峰（全价）' };
  }
  return { slot: 'offpeak', discount: 0.5, reason: 'offhours', label: '空闲（非高峰，5 折）' };
}

function deepSeekPricing(modelId, at = Date.now(), familyOverride = null) {
  const family = familyOverride || deepSeekFamily(modelId);
  if (!family) return null;
  const peak = DEEPSEEK_PEAK_PRICING[family];
  const time = deepSeekSlot(at);
  const factor = time.discount;
  return {
    pricing: {
      input: peak.input * factor,
      output: peak.output * factor,
      cacheRead: peak.cacheRead * factor,
      cacheCreation: peak.cacheCreation * factor,
    },
    source: 'deepseek-official',
    slot: time.slot,
    slotLabel: time.label,
    discount: factor,
    modelId: normalizeModelId(modelId),
    family,
  };
}

function flattenModelsDev(data) {
  const models = {};
  if (!data || typeof data !== 'object') return models;
  for (const [providerId, provider] of Object.entries(data)) {
    if (!provider || typeof provider !== 'object') continue;
    for (const [rawModelId, model] of Object.entries(provider.models || {})) {
      if (!model || typeof model !== 'object') continue;
      if (model.status && String(model.status).toLowerCase() === 'deprecated') continue;
      const cost = model.cost || {};
      const input = Number(cost.input);
      const output = Number(cost.output);
      if (!Number.isFinite(input) && !Number.isFinite(output)) continue;
      const normalized = normalizeModelId(model.id || rawModelId);
      if (!normalized) continue;
      // 同名模型保留先出现的条目；DeepSeek 官方价格另由内置表覆盖。
      if (models[normalized]) continue;
      models[normalized] = {
        input: Number.isFinite(input) ? input : 0,
        output: Number.isFinite(output) ? output : 0,
        cacheRead: Number(cost.cache_read) || 0,
        cacheCreation: Number(cost.cache_write) || 0,
        providerId,
        providerName: provider.name || providerId,
        modelId: rawModelId,
      };
    }
  }
  return models;
}

class ModelsDevPricingStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, MODELS_DEV_FILE);
    this.data = { fetchedAt: 0, models: {} };
    this.lastError = null;
    this.syncing = false;
    this._load();
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return;
      const models = parsed.models && typeof parsed.models === 'object' ? parsed.models : {};
      this.data = {
        fetchedAt: Number(parsed.fetchedAt) || 0,
        models: models && typeof models === 'object' ? models : {},
      };
    } catch {
      /* 文件不存在或损坏 */
    }
  }

  _save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data), 'utf8');
    fs.renameSync(temp, this.file);
  }

  isFresh(maxAge = MODELS_DEV_REFRESH_MS) {
    return this.data.fetchedAt > 0 && Date.now() - this.data.fetchedAt < maxAge;
  }

  get(modelId) {
    const normalized = normalizeModelId(modelId);
    if (!normalized) return null;
    const entry = this.data.models[normalized];
    if (!entry) return null;
    return {
      pricing: {
        input: Number(entry.input) || 0,
        output: Number(entry.output) || 0,
        cacheRead: Number(entry.cacheRead) || 0,
        cacheCreation: Number(entry.cacheCreation) || 0,
      },
      source: 'models-dev',
      providerId: entry.providerId,
      providerName: entry.providerName,
      modelId: entry.modelId,
      slot: null,
      slotLabel: '',
      discount: 1,
    };
  }

  status() {
    return {
      fetchedAt: this.data.fetchedAt,
      count: Object.keys(this.data.models).length,
      lastError: this.lastError,
      syncing: this.syncing,
      deepseek: deepSeekSlot(Date.now()),
    };
  }

  async sync(fetcher) {
    if (this.syncing) return this.status();
    this.syncing = true;
    this.lastError = null;
    try {
      const raw = await fetcher();
      const text = typeof raw === 'string' ? raw : String(raw || '');
      if (Buffer.byteLength(text, 'utf8') > MODELS_DEV_MAX_BYTES) {
        throw new Error('models.dev 返回内容过大');
      }
      const parsed = JSON.parse(text);
      const models = flattenModelsDev(parsed);
      if (Object.keys(models).length === 0) {
        throw new Error('models.dev 没有返回可用模型价格');
      }
      this.data = { fetchedAt: Date.now(), models };
      this._save();
      return this.status();
    } catch (error) {
      this.lastError = error?.message || String(error);
      throw error;
    } finally {
      this.syncing = false;
    }
  }
}

function hasUsablePricing(pricing) {
  return Boolean(
    pricing &&
      [pricing.input, pricing.output, pricing.cacheRead, pricing.cacheCreation].some(
        (value) => Number(value) > 0
      )
  );
}

/**
 * 自动价格优先级：
 * 1. DeepSeek 官方（含峰谷时段）
 * 2. models.dev 同步下来的模型价
 * 3. 旧版手动价格（兼容已有供应商配置）
 */
function resolvePricing({ provider, modelId, at = Date.now(), store, manualPricing } = {}) {
  const normalized = normalizeModelId(modelId);
  if (!normalized) return null;
  if (isDeepSeekProvider(provider)) {
    const official = deepSeekPricing(
      normalized,
      at,
      deepSeekFamilyForProvider(normalized, provider)
    );
    if (official) return official;
  }
  const fromModelsDev = store ? store.get(normalized) : null;
  if (fromModelsDev && hasUsablePricing(fromModelsDev.pricing)) return fromModelsDev;
  const officialFallback = deepSeekPricing(
    normalized,
    at,
    deepSeekFamilyForProvider(normalized, provider)
  );
  if (officialFallback) return officialFallback;
  if (hasUsablePricing(manualPricing)) {
    return {
      pricing: {
        input: Number(manualPricing.input) || 0,
        output: Number(manualPricing.output) || 0,
        cacheRead: Number(manualPricing.cacheRead) || 0,
        cacheCreation: Number(manualPricing.cacheCreation) || 0,
      },
      source: 'legacy-manual',
      slot: null,
      slotLabel: '',
      discount: 1,
      modelId: normalized,
    };
  }
  return null;
}

module.exports = {
  MODELS_DEV_URL,
  MODELS_DEV_REFRESH_MS,
  ModelsDevPricingStore,
  normalizeModelId,
  deepSeekFamily,
  deepSeekSlot,
  deepSeekPricing,
  flattenModelsDev,
  resolvePricing,
};
