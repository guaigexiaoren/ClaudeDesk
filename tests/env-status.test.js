'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  sanitizeBaseUrl,
  providerEnvItem,
  isWindowsAppsPath,
  versionFrom,
  resolveEnvAction,
  buildWingetScript,
  summarizeStatus,
  pickAuthSource,
  mcpNeedsNode,
  downloadUrl,
  findPython,
} = require('../electron/env-status');

test('自定义供应商的环境检测行只暴露名称、host 和是否有 Key', () => {
  const system = providerEnvItem(null);
  assert.equal(system.status, 'ok');
  assert.ok(system.detail.includes('系统 / CC Switch'));

  const item = providerEnvItem({
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic?token=SECRET',
    hasKey: true,
  });
  assert.equal(item.status, 'ok');
  assert.equal(item.version, 'DeepSeek');
  assert.ok(item.detail.includes('api.deepseek.com'));
  assert.ok(!JSON.stringify(item).includes('SECRET'));

  const noKey = providerEnvItem({
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    hasKey: false,
  });
  assert.equal(noKey.status, 'warning');
  assert.ok(noKey.detail.includes('未保存 Key'));
});

test('代理地址只保留 host 和端口，不泄露用户信息与查询参数', () => {
  const parsed = sanitizeBaseUrl('http://user:pass@127.0.0.1:15721/v1?x=SECRET');
  assert.equal(parsed.host, '127.0.0.1:15721');
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(parsed.port, 15721);
  assert.equal(parsed.isLocal, true);
  assert.ok(!JSON.stringify(parsed).includes('SECRET'));
  assert.ok(!JSON.stringify(parsed).includes('user'));
});

test('远程代理地址与非法协议', () => {
  const parsed = sanitizeBaseUrl('https://api.example.com/v1');
  assert.equal(parsed.host, 'api.example.com');
  assert.equal(parsed.port, 443);
  assert.equal(parsed.isLocal, false);
  assert.equal(sanitizeBaseUrl('ftp://example.com'), null);
  assert.equal(sanitizeBaseUrl(''), null);
});

test('WindowsApps 假别名识别', () => {
  assert.equal(
    isWindowsAppsPath('C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe'),
    true
  );
  assert.equal(isWindowsAppsPath('C:\\Python313\\python.exe'), false);
});

test('版本号提取', () => {
  assert.equal(versionFrom('git version 2.56.0.windows.3'), '2.56.0');
  assert.equal(versionFrom('v24.14.0'), '24.14.0');
  assert.equal(versionFrom('Python 3.13.12'), '3.13.12');
  assert.equal(versionFrom('no version'), null);
});

test('动作白名单拒绝原型链和任意命令/URL', () => {
  assert.equal(resolveEnvAction('constructor'), null);
  assert.equal(resolveEnvAction('__proto__'), null);
  assert.equal(resolveEnvAction('https://evil.example'), null);
  assert.equal(resolveEnvAction('cmd.exe /c calc'), null);
  assert.equal(resolveEnvAction(''), null);
  assert.equal(resolveEnvAction(123), null);
  assert.equal(resolveEnvAction('install:git').kind, 'install');
  assert.equal(resolveEnvAction('download:ccswitch').kind, 'download');
});

test('winget 安装脚本使用固定包 ID', () => {
  const script = buildWingetScript('git', 'C:\\winget.exe');
  assert.ok(script.includes('Git.Git'));
  assert.ok(script.includes('C:\\winget.exe'));
  assert.equal(buildWingetScript('unknown', 'winget'), null);
});

test('汇总：必需组件缺失才算错误，可选组件不影响', () => {
  const ok = summarizeStatus([
    { level: 'required', status: 'ok' },
    { level: 'optional', status: 'warning' },
  ]);
  assert.equal(ok.level, 'ok');

  const warning = summarizeStatus([
    { level: 'required', status: 'ok' },
    { level: 'recommended', status: 'warning' },
  ]);
  assert.equal(warning.level, 'warning');

  const error = summarizeStatus([
    { level: 'required', status: 'missing' },
    { level: 'optional', status: 'ok' },
  ]);
  assert.equal(error.level, 'error');
  assert.equal(error.requiredMissing, 1);
});

test('鉴权来源可以跨环境变量和 settings 合并，且只记录是否存在', () => {
  const env = {
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:15721',
    ANTHROPIC_AUTH_TOKEN: 'SENTINEL-TOKEN',
  };
  const result = pickAuthSource(env, [{}, {}, {}]);
  assert.equal(result.baseUrl, 'http://127.0.0.1:15721');
  assert.equal(result.tokenPresent, true);
  assert.equal(result.apiKeyPresent, false);
  assert.equal(result.source, 'environment');

  const merged = pickAuthSource({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:15721' }, [
    {},
    {},
    { env: { ANTHROPIC_API_KEY: 'SENTINEL-KEY' } },
  ]);
  assert.equal(merged.apiKeyPresent, true);
  assert.ok(!JSON.stringify({ ...merged, baseUrl: null }).includes('SENTINEL'));
});

test('MCP 配置使用 npx 时标记需要 Node', () => {
  const needs = mcpNeedsNode(
    {
      mcpServers: {
        a: { command: 'npx', args: ['-y', 'some-mcp'] },
        b: { command: 'node', args: ['server.js'] },
        c: { command: 'python', args: ['server.py'] },
      },
    },
    'C:\\work'
  );
  assert.equal(needs.uses, 2);
  assert.equal(mcpNeedsNode({ mcpServers: { c: { command: 'python' } } }, 'C:\\work').uses, 0);
});

test('安装下载页按平台区分 Windows 与 macOS', () => {
  assert.equal(downloadUrl('git', 'win32'), 'https://git-scm.com/download/win');
  assert.equal(downloadUrl('git', 'darwin'), 'https://git-scm.com/download/mac');
  assert.equal(
    downloadUrl('python', 'darwin'),
    'https://www.python.org/downloads/macos/'
  );
  assert.equal(downloadUrl('node', 'darwin'), 'https://nodejs.org/');
  assert.equal(downloadUrl('unknown', 'darwin'), null);
});

test('macOS 上优先识别 python3，而不是 Windows 的 py.exe', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudedesk-python-'));
  try {
    const executable = path.join(dir, 'python3');
    fs.writeFileSync(executable, '');
    const found = findPython(
      { PATH: dir, Path: dir },
      '',
      '',
      '',
      'darwin'
    );
    assert.equal(found.exe, executable);
    assert.deepEqual(found.args, ['--version']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
