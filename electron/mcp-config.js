'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const TYPES = new Set(['stdio', 'http', 'sse']);

function mcpConfigPath(home) {
  return path.join(home, '.claude.json');
}

function normalizeMcpInput(input = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!NAME_RE.test(name)) {
    throw new Error('名称只能包含字母、数字、点、下划线和短横线（1-64 位）');
  }
  const type = TYPES.has(input.type) ? input.type : 'stdio';
  const env = {};
  if (input.env && typeof input.env === 'object') {
    for (const [key, value] of Object.entries(input.env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      env[key] = String(value ?? '');
    }
  }

  if (type === 'stdio') {
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    if (!command) throw new Error('请填写启动命令');
    const args = Array.isArray(input.args)
      ? input.args.map((item) => String(item)).filter((item) => item !== '')
      : [];
    return { name, server: { type, command, args, ...(Object.keys(env).length ? { env } : {}) } };
  }

  const url = typeof input.url === 'string' ? input.url.trim() : '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL 不是有效地址');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('URL 只支持 http/https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL 不要包含用户名或密码，请用请求头传凭据');
  }
  const headers = {};
  if (input.headers && typeof input.headers === 'object') {
    for (const [key, value] of Object.entries(input.headers)) {
      if (!/^[A-Za-z0-9-]+$/.test(key)) continue;
      headers[key] = String(value ?? '');
    }
  }
  return {
    name,
    server: { type, url, ...(Object.keys(headers).length ? { headers } : {}) },
  };
}

function readMcpConfig(home) {
  const file = mcpConfigPath(home);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw new Error('无法解析 ~/.claude.json，请先检查文件格式');
  }
}

function writeMcpConfig(home, config) {
  const file = mcpConfigPath(home);
  try {
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, `${file}.bak`);
    }
  } catch {
    /* 备份失败不阻止保存 */
  }
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function addMcpServer(home, input) {
  const { name, server } = normalizeMcpInput(input);
  const config = readMcpConfig(home);
  config.mcpServers = config.mcpServers && typeof config.mcpServers === 'object'
    ? config.mcpServers
    : {};
  if (config.mcpServers[name]) throw new Error('同名 MCP 已存在');
  config.mcpServers[name] = server;
  writeMcpConfig(home, config);
  return { name, server };
}

function removeMcpServer(home, name) {
  if (!NAME_RE.test(String(name || ''))) throw new Error('MCP 名称不合法');
  const config = readMcpConfig(home);
  if (!config.mcpServers || !config.mcpServers[name]) {
    throw new Error('没有找到这个 MCP');
  }
  delete config.mcpServers[name];
  writeMcpConfig(home, config);
  return { name };
}

module.exports = {
  mcpConfigPath,
  normalizeMcpInput,
  readMcpConfig,
  writeMcpConfig,
  addMcpServer,
  removeMcpServer,
};
