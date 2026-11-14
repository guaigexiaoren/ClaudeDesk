'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_NAME = 80;
const MAX_URL = 500;
const MAX_KEY = 20_000;
const MODEL_KEYS = ['opus', 'sonnet', 'haiku', 'fable'];
const DEFAULT_DATA = { activeId: '', profiles: [] };

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(num, 100_000);
}

function normalizeProfile(input = {}) {
  const name = cleanText(input.name, MAX_NAME);
  if (!name) throw new Error('请填写供应商名称');

  const baseUrl = cleanText(input.baseUrl, MAX_URL);
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('Base URL 不是有效地址');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL 只支持 http/https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Base URL 不要包含用户名或密码，请把凭据填到 API Key');
  }

  const authMode = input.authMode === 'apiKey' ? 'apiKey' : 'authToken';
  const models = {};
  for (const key of MODEL_KEYS) {
    const value = cleanText(input.models?.[key], 200);
    if (value) models[key] = value;
  }

  const pricing = {
    input: cleanPrice(input.pricing?.input),
    output: cleanPrice(input.pricing?.output),
    cacheRead: cleanPrice(input.pricing?.cacheRead),
    cacheCreation: cleanPrice(input.pricing?.cacheCreation),
  };
  const multiplier = Number(input.costMultiplier);
  const costMultiplier = Number.isFinite(multiplier) && multiplier > 0
    ? Math.min(multiplier, 10)
    : 1;

  return {
    id: typeof input.id === 'string' && input.id ? input.id : randomUUID(),
    name,
    baseUrl,
    authMode,
    models,
    pricing,
    costMultiplier,
    createdAt: Number(input.createdAt) || Date.now(),
  };
}

function publicProfile(profile) {
  if (!profile) return null;
  const { keyCipher, ...rest } = profile;
  return { ...rest, hasKey: Boolean(keyCipher) };
}

/**
 * 把当前供应商转换成给 Claude CLI 的环境变量。
 * unset 里的变量会从继承的环境里删掉，避免 CC Switch 的旧值串进来。
 */
function buildProviderEnv(profile, key) {
  const unset = [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_FABLE_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL',
    'ANTHROPIC_CUSTOM_HEADERS',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_OAUTH_TOKEN',
  ];
  if (!profile) return { overrides: {}, unset };

  const overrides = { ANTHROPIC_BASE_URL: profile.baseUrl };
  const authKey = profile.authMode === 'apiKey' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN';
  const otherAuthKey =
    profile.authMode === 'apiKey' ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY';
  // 即使没填 Key 也要覆盖，防止把用户 settings.json 里的 CC Switch token 带到别的地址
  overrides[authKey] = typeof key === 'string' ? key : '';
  // 用户 settings.json 里的 env 优先级可能高于进程环境；把另一种鉴权方式清空，
  // 避免 CC Switch 的旧 token 继续生效（空字符串在 CLI 里按未设置处理）。
  overrides[otherAuthKey] = '';
  overrides.ANTHROPIC_CUSTOM_HEADERS = '';
  overrides.CLAUDE_CODE_USE_BEDROCK = '';
  overrides.CLAUDE_CODE_USE_VERTEX = '';
  overrides.CLAUDE_CODE_USE_GATEWAY = '';
  overrides.CLAUDE_CODE_OAUTH_TOKEN = '';
  const models = profile.models || {};
  const anyModel = models.opus || models.sonnet || models.haiku || models.fable;
  if (!anyModel) {
    // 全部留空：清掉用户 settings.json 里的模型映射，让 CLI 使用内置默认模型
    overrides.ANTHROPIC_DEFAULT_OPUS_MODEL = '';
    overrides.ANTHROPIC_DEFAULT_SONNET_MODEL = '';
    overrides.ANTHROPIC_DEFAULT_HAIKU_MODEL = '';
    overrides.ANTHROPIC_DEFAULT_FABLE_MODEL = '';
    overrides.CLAUDE_CODE_SUBAGENT_MODEL = '';
    return { overrides, unset };
  }
  const modelAliases = {
    opus: models.opus || models.sonnet || models.haiku || models.fable,
    sonnet: models.sonnet || models.opus || models.haiku || models.fable,
    haiku: models.haiku || models.sonnet || models.opus || models.fable,
    fable: models.fable || models.sonnet || models.opus || models.haiku,
  };
  if (modelAliases.opus) overrides.ANTHROPIC_DEFAULT_OPUS_MODEL = modelAliases.opus;
  if (modelAliases.sonnet) overrides.ANTHROPIC_DEFAULT_SONNET_MODEL = modelAliases.sonnet;
  if (modelAliases.haiku) overrides.ANTHROPIC_DEFAULT_HAIKU_MODEL = modelAliases.haiku;
  if (modelAliases.fable) overrides.ANTHROPIC_DEFAULT_FABLE_MODEL = modelAliases.fable;
  overrides.CLAUDE_CODE_SUBAGENT_MODEL =
    modelAliases.haiku || modelAliases.sonnet || modelAliases.opus || '';
  return { overrides, unset };
}

class ProviderStore {
  constructor({ dir, encrypt = null, decrypt = null } = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'providers.json');
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.data = { ...DEFAULT_DATA, profiles: [] };
    this._load();
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return;
      this.data = {
        activeId: typeof parsed.activeId === 'string' ? parsed.activeId : '',
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      };
    } catch {
      /* 文件不存在或损坏 */
    }
  }

  _save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temp, this.file);
  }

  list() {
    return {
      activeId: this.data.activeId,
      profiles: this.data.profiles.map(publicProfile),
    };
  }

  save(input = {}, { key = '', clearKey = false } = {}) {
    const profile = normalizeProfile(input);
    if (typeof key === 'string' && key.length > MAX_KEY) {
      throw new Error('API Key 太长');
    }
    const profiles = this.data.profiles.slice();
    const index = profiles.findIndex((item) => item.id === profile.id);
    const existing = index >= 0 ? profiles[index] : null;

    let keyCipher = existing?.keyCipher || null;
    if (clearKey) keyCipher = null;
    if (typeof key === 'string' && key.trim().length > 0) {
      if (!this.encrypt) throw new Error('当前系统不支持安全存储，无法保存 API Key');
      keyCipher = this.encrypt(key.trim());
    }

    const record = { ...profile, keyCipher };
    if (existing) {
      // 编辑表单不回传这两个字段：保留旧价格和创建时间，避免每次保存都被归零/重置
      if (input.pricing == null) record.pricing = existing.pricing;
      if (input.createdAt == null) record.createdAt = existing.createdAt;
    }
    if (index >= 0) profiles[index] = record;
    else profiles.push(record);
    this.data.profiles = profiles;
    this._save();
    return publicProfile(record);
  }

  remove(id) {
    this.data.profiles = this.data.profiles.filter((item) => item.id !== id);
    if (this.data.activeId === id) this.data.activeId = '';
    this._save();
    return this.list();
  }

  activate(id) {
    if (id && !this.data.profiles.some((item) => item.id === id)) {
      throw new Error('供应商不存在');
    }
    this.data.activeId = id || '';
    this._save();
    return this.list();
  }

  /** 只给主进程用：返回当前供应商和已解密的 Key。 */
  getActive() {
    if (!this.data.activeId) return null;
    const profile = this.data.profiles.find((item) => item.id === this.data.activeId);
    if (!profile) return null;
    let key = '';
    if (profile.keyCipher) {
      if (!this.decrypt) throw new Error('当前系统不支持安全存储，无法读取 API Key');
      key = this.decrypt(profile.keyCipher);
    }
    return { profile, key };
  }
}

module.exports = {
  ProviderStore,
  normalizeProfile,
  buildProviderEnv,
};
