'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ProviderStore,
  normalizeProfile,
  buildProviderEnv,
} = require('../electron/provider-store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudedesk-provider-'));
}

function fakeCodec() {
  return {
    encrypt: (value) => `enc:${Buffer.from(value, 'utf8').toString('base64')}`,
    decrypt: (value) => Buffer.from(value.slice(4), 'base64').toString('utf8'),
  };
}

const baseProfile = {
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/anthropic',
  authMode: 'authToken',
  models: { opus: 'deepseek-v4-pro', sonnet: 'deepseek-v4-flash', haiku: 'deepseek-v4-flash' },
  pricing: { input: 2, output: 8, cacheRead: 0.2, cacheCreation: 2 },
  costMultiplier: 1,
};

test('保存供应商时 Key 加密且不会出现在列表里', () => {
  const dir = tempDir();
  try {
    const store = new ProviderStore({ dir, ...fakeCodec() });
    const saved = store.save(baseProfile, { key: 'sk-secret' });
    assert.equal(saved.hasKey, true);
    assert.equal(saved.keyCipher, undefined);

    const list = store.list();
    assert.equal(list.profiles.length, 1);
    assert.equal(JSON.stringify(list).includes('sk-secret'), false);
    assert.equal(JSON.stringify(list).includes('enc:'), false);

    const active = store.getActive();
    assert.equal(active, null);
    store.activate(saved.id);
    assert.equal(store.getActive().key, 'sk-secret');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('留空 Key 保持原值，clearKey 才清除', () => {
  const dir = tempDir();
  try {
    const store = new ProviderStore({ dir, ...fakeCodec() });
    const saved = store.save(baseProfile, { key: 'sk-one' });
    store.save({ ...saved, name: 'DeepSeek 改名' }, {});
    store.activate(saved.id);
    assert.equal(store.getActive().key, 'sk-one');

    store.save({ ...saved, name: 'DeepSeek 改名' }, { clearKey: true });
    assert.equal(store.getActive().key, '');
    assert.equal(store.list().profiles[0].hasKey, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('校验供应商字段', () => {
  assert.throws(() => normalizeProfile({ ...baseProfile, name: '' }), /名称/);
  assert.throws(() => normalizeProfile({ ...baseProfile, baseUrl: 'ftp://x' }), /http/);
  assert.throws(() => normalizeProfile({ ...baseProfile, baseUrl: '不是地址' }), /有效/);
  assert.throws(
    () => normalizeProfile({ ...baseProfile, baseUrl: 'https://user:pass@example.com' }),
    /用户名或密码/
  );
  const profile = normalizeProfile({
    ...baseProfile,
    pricing: { input: -1, output: '8', cacheRead: 'x', cacheCreation: 2 },
    costMultiplier: 999,
    models: { opus: ' a ', sonnet: '', haiku: 'b' },
  });
  assert.deepEqual(profile.pricing, { input: 0, output: 8, cacheRead: 0, cacheCreation: 2 });
  assert.equal(profile.costMultiplier, 10);
  assert.deepEqual(profile.models, { opus: 'a', haiku: 'b' });
});

test('删除当前供应商会清空 activeId', () => {
  const dir = tempDir();
  try {
    const store = new ProviderStore({ dir, ...fakeCodec() });
    const saved = store.save(baseProfile, { key: 'k' });
    store.activate(saved.id);
    store.remove(saved.id);
    assert.equal(store.list().activeId, '');
    assert.equal(store.list().profiles.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('生成供应商环境变量并清掉继承的 CC Switch 值', () => {
  const { overrides, unset } = buildProviderEnv(
    { ...baseProfile, authMode: 'apiKey' },
    'sk-new'
  );
  assert.equal(overrides.ANTHROPIC_BASE_URL, baseProfile.baseUrl);
  assert.equal(overrides.ANTHROPIC_API_KEY, 'sk-new');
  assert.equal(overrides.ANTHROPIC_AUTH_TOKEN, '');
  assert.equal(overrides.ANTHROPIC_CUSTOM_HEADERS, '');
  assert.equal(overrides.ANTHROPIC_DEFAULT_OPUS_MODEL, 'deepseek-v4-pro');
  assert.equal(overrides.ANTHROPIC_DEFAULT_FABLE_MODEL, 'deepseek-v4-flash');
  assert.equal(overrides.CLAUDE_CODE_SUBAGENT_MODEL, 'deepseek-v4-flash');
  assert.ok(unset.includes('ANTHROPIC_AUTH_TOKEN'));
  assert.ok(unset.includes('ANTHROPIC_BASE_URL'));
});

test('供应商没有模型映射时清空旧映射，回退到 CLI 默认模型', () => {
  const { overrides } = buildProviderEnv({ ...baseProfile, models: {} }, 'k');
  assert.equal(overrides.ANTHROPIC_DEFAULT_OPUS_MODEL, '');
  assert.equal(overrides.ANTHROPIC_DEFAULT_SONNET_MODEL, '');
  assert.equal(overrides.ANTHROPIC_DEFAULT_HAIKU_MODEL, '');
  assert.equal(overrides.ANTHROPIC_DEFAULT_FABLE_MODEL, '');
  assert.equal(overrides.CLAUDE_CODE_SUBAGENT_MODEL, '');
});

test('供应商没填 Key 时也要清空继承的鉴权值', () => {
  const { overrides } = buildProviderEnv({ ...baseProfile, authMode: 'authToken' }, '');
  assert.equal(overrides.ANTHROPIC_AUTH_TOKEN, '');
  assert.equal(overrides.ANTHROPIC_API_KEY, '');
});

test('编辑供应商时未传 pricing/createdAt 会保留旧值', () => {
  const dir = tempDir();
  try {
    const store = new ProviderStore({ dir, ...fakeCodec() });
    const saved = store.save(baseProfile, { key: 'k' });
    const edited = store.save(
      {
        id: saved.id,
        name: 'DeepSeek 改名',
        baseUrl: saved.baseUrl,
        authMode: saved.authMode,
        models: saved.models,
        costMultiplier: saved.costMultiplier,
      },
      {}
    );
    assert.deepEqual(edited.pricing, baseProfile.pricing);
    assert.equal(edited.createdAt, saved.createdAt);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
