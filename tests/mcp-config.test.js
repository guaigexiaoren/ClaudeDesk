'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  normalizeMcpInput,
  addMcpServer,
  removeMcpServer,
  readMcpConfig,
} = require('../electron/mcp-config');

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudedesk-mcp-'));
}

test('校验 MCP 输入', () => {
  assert.throws(() => normalizeMcpInput({ name: '../x', command: 'npx' }), /名称/);
  assert.throws(() => normalizeMcpInput({ name: 'ok', type: 'stdio' }), /命令/);
  assert.throws(() => normalizeMcpInput({ name: 'ok', type: 'http', url: 'file:///x' }), /http/);
  assert.throws(
    () => normalizeMcpInput({ name: 'ok', type: 'http', url: 'https://user:pass@example.com/mcp' }),
    /用户名或密码/
  );
  const http = normalizeMcpInput({
    name: 'remote',
    type: 'http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer x', 'bad header': 'y' },
  });
  assert.deepEqual(http.server, {
    type: 'http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer x' },
  });
  const local = normalizeMcpInput({
    name: 'local',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'foo'],
    env: { TOKEN: 'x', 'bad-key': 'y' },
  });
  assert.deepEqual(local.server.args, ['-y', 'foo']);
  assert.deepEqual(local.server.env, { TOKEN: 'x' });
});

test('新增和删除 MCP 时保留其它配置并留备份', () => {
  const home = tempHome();
  try {
    fs.writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({ theme: 'dark', mcpServers: { old: { type: 'stdio', command: 'old' } } }),
      'utf8'
    );
    addMcpServer(home, { name: 'new', type: 'http', url: 'https://example.com/mcp' });
    const config = readMcpConfig(home);
    assert.equal(config.theme, 'dark');
    assert.ok(config.mcpServers.old);
    assert.ok(config.mcpServers.new);
    assert.ok(fs.existsSync(path.join(home, '.claude.json.bak')));
    assert.throws(
      () => addMcpServer(home, { name: 'new', type: 'http', url: 'https://example.com/mcp' }),
      /已存在/
    );

    removeMcpServer(home, 'new');
    assert.equal(readMcpConfig(home).mcpServers.new, undefined);
    assert.ok(readMcpConfig(home).mcpServers.old);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('配置文件损坏时拒绝写入', () => {
  const home = tempHome();
  try {
    fs.writeFileSync(path.join(home, '.claude.json'), '{broken', 'utf8');
    assert.throws(
      () => addMcpServer(home, { name: 'x', command: 'echo' }),
      /无法解析/
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
