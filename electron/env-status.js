'use strict';

/**
 * 运行环境自检：只做本地探测，不修改任何配置。
 * 不依赖 electron，路径和子进程执行函数由调用方注入，方便单元测试。
 */

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { execFile } = require('node:child_process');

const WINGET_PACKAGES = Object.freeze({
  git: 'Git.Git',
  node: 'OpenJS.NodeJS.LTS',
  python: 'Python.Python.3.13',
});

const FALLBACK_URLS = Object.freeze({
  git: 'https://git-scm.com/download/win',
  node: 'https://nodejs.org/',
  python: 'https://www.python.org/downloads/windows/',
  ccswitch: 'https://github.com/farion1231/cc-switch/releases/latest',
  claude: 'https://docs.anthropic.com/en/docs/claude-code/setup',
});

const ENV_ACTIONS = Object.freeze({
  'install:git': Object.freeze({ kind: 'install', tool: 'git' }),
  'install:node': Object.freeze({ kind: 'install', tool: 'node' }),
  'install:python': Object.freeze({ kind: 'install', tool: 'python' }),
  'download:git': Object.freeze({ kind: 'download', url: FALLBACK_URLS.git }),
  'download:node': Object.freeze({ kind: 'download', url: FALLBACK_URLS.node }),
  'download:python': Object.freeze({ kind: 'download', url: FALLBACK_URLS.python }),
  'download:ccswitch': Object.freeze({ kind: 'download', url: FALLBACK_URLS.ccswitch }),
  'docs:claude': Object.freeze({ kind: 'docs', url: FALLBACK_URLS.claude }),
  'launch:ccswitch': Object.freeze({ kind: 'launch-ccswitch' }),
});

function resolveEnvAction(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null;
  if (!/^[a-z0-9:-]+$/i.test(id)) return null;
  if (!Object.prototype.hasOwnProperty.call(ENV_ACTIONS, id)) return null;
  return ENV_ACTIONS[id];
}

function buildWingetScript(tool, wingetPath) {
  const packageId = WINGET_PACKAGES[tool];
  if (!packageId) return null;
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const exe = wingetPath || 'winget';
  return [
    "$ErrorActionPreference = 'Continue'",
    `& ${quote(exe)} install --id ${packageId} -e --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity`,
    "Write-Host ''",
    "Write-Host '安装结束：请回到 ClaudeDesk 点击“重新检查”；若仍未识别，请重启 ClaudeDesk。' -ForegroundColor Cyan",
  ].join('; ');
}

function isWindowsAppsPath(value) {
  return typeof value === 'string' && /[\\/]WindowsApps[\\/]/i.test(value);
}

/** 只保留 host[:port]，丢掉用户名、密码、路径和查询参数。 */
function sanitizeBaseUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const isLocal =
      hostname === 'localhost' || hostname === '::1' || /^127\./.test(hostname);
    return {
      host: url.host,
      hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      isLocal,
    };
  } catch {
    return null;
  }
}

function versionFrom(text) {
  const match = String(text || '').match(/\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)*/);
  return match ? match[0] : null;
}

function summarizeStatus(items) {
  const requiredMissing = items.filter(
    (item) => item.level === 'required' && (item.status === 'missing' || item.status === 'error')
  ).length;
  const warnings = items.filter(
    (item) =>
      item.level !== 'optional' &&
      (item.status === 'warning' || item.status === 'unknown')
  ).length;
  const level = requiredMissing ? 'error' : warnings ? 'warning' : 'ok';
  const text = requiredMissing
    ? `有 ${requiredMissing} 个必需组件需要处理`
    : warnings
      ? '有需要关注的项'
      : '必需组件齐全';
  return { level, text, requiredMissing, warnings };
}

function runCommand(command, args, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let child = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    try {
      child = execFile(
        command,
        args,
        { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          finish({
            ok: !error,
            code: error?.code ?? 0,
            stdout: String(stdout || ''),
            stderr: String(stderr || ''),
            error: error ? error.message : null,
          });
        }
      );
    } catch (error) {
      finish({ ok: false, code: -1, stdout: '', stderr: '', error: error.message });
      return;
    }
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* 忽略 */
      }
      finish({ ok: false, code: -1, stdout: '', stderr: '', error: 'timeout' });
    }, timeoutMs + 500);
    timer.unref?.();
  });
}

function probeTcp(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* 忽略 */
      }
      resolve(ok);
    };
    try {
      socket = net.connect({ host, port });
    } catch {
      resolve(false);
      return;
    }
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function splitPath(env) {
  return String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
}

function findExecutable(name, { env, extraDirs = [], excludeWindowsApps = false } = {}) {
  const extensions = process.platform === 'win32' ? ['.exe', '.com', '.cmd', '.bat'] : [''];
  const seen = new Set();
  for (const dir of [...splitPath(env), ...extraDirs]) {
    if (!dir) continue;
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (excludeWindowsApps && isWindowsAppsPath(dir)) continue;
    for (const extension of extensions) {
      const candidate = path.join(dir, `${name}${extension}`);
      if (fileExists(candidate)) return candidate;
    }
  }
  return null;
}

function findPython(env, localAppData, programFiles, programFilesX86) {
  const launcher = findExecutable('py', {
    env,
    extraDirs: [path.join(localAppData, 'Programs', 'Python', 'Launcher')],
  });
  if (launcher) return { exe: launcher, args: ['-3', '--version'] };

  const dirs = [
    ...splitPath(env).filter((dir) => !isWindowsAppsPath(dir)),
    path.join(localAppData, 'Programs', 'Python'),
    path.join(programFiles, 'Python'),
    path.join(programFilesX86, 'Python'),
  ];
  for (const dir of dirs) {
    const direct = path.join(dir, 'python.exe');
    if (fileExists(direct)) return { exe: direct, args: ['--version'] };
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (!/^Python3/i.test(entry)) continue;
        const candidate = path.join(dir, entry, 'python.exe');
        if (fileExists(candidate)) return { exe: candidate, args: ['--version'] };
      }
    } catch {
      /* 目录不存在 */
    }
  }
  return null;
}

function findCcSwitchPath({ env, localAppData, programFiles }) {
  const candidates = [
    path.join(localAppData, 'Programs', 'CC Switch', 'cc-switch.exe'),
    path.join(programFiles, 'CC Switch', 'cc-switch.exe'),
  ];
  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return findExecutable('cc-switch', { env });
}

function findStandaloneClaude(env) {
  const appData = env.APPDATA || '';
  const packageFiles = [
    appData ? path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'package.json') : null,
    env.USERPROFILE
      ? path.join(env.USERPROFILE, 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'package.json')
      : null,
  ].filter(Boolean);
  for (const file of packageFiles) {
    const pkg = readJson(file);
    if (pkg.version) {
      return { installed: true, version: String(pkg.version), path: path.dirname(file) };
    }
  }
  const executable = findExecutable('claude', { env });
  return executable
    ? { installed: true, version: null, path: executable }
    : { installed: false, version: null, path: null };
}

function pickAuthSource(env, settingsList) {
  const sources = [
    { scope: 'environment', values: env },
    { scope: 'project-local', values: settingsList[0]?.env || {} },
    { scope: 'project', values: settingsList[1]?.env || {} },
    { scope: 'user', values: settingsList[2]?.env || {} },
  ];
  let baseUrl = null;
  let tokenPresent = false;
  let apiKeyPresent = false;
  let source = 'none';
  for (const item of sources) {
    const values = item.values || {};
    if (!baseUrl && values.ANTHROPIC_BASE_URL) {
      baseUrl = values.ANTHROPIC_BASE_URL;
      source = item.scope;
    }
    if (values.ANTHROPIC_AUTH_TOKEN) tokenPresent = true;
    if (values.ANTHROPIC_API_KEY) apiKeyPresent = true;
    if (source === 'none' && (tokenPresent || apiKeyPresent)) source = item.scope;
  }
  return { source, baseUrl, tokenPresent, apiKeyPresent };
}

function collectMcpServers(config, cwd) {
  const servers = { ...(config.mcpServers || {}) };
  for (const [dir, project] of Object.entries(config.projects || {})) {
    if (path.resolve(dir).toLowerCase() !== path.resolve(cwd).toLowerCase()) continue;
    Object.assign(servers, project?.mcpServers || {});
  }
  return servers;
}

function mcpNeedsNode(config, cwd) {
  const servers = Object.values(collectMcpServers(config, cwd));
  const uses = servers.filter((server) => {
    const command = String(server?.command || '');
    const args = Array.isArray(server?.args) ? server.args.map(String).join(' ') : '';
    return /(^|[\\/\s])(npx|npm|node)(\.cmd|\.exe)?(\s|$)/i.test(command)
      || /(^|[\\/\s])(npx|npm|node)(\.cmd|\.exe)?(\s|$)/i.test(args);
  }).length;
  return { uses, total: servers.length };
}

async function versionOf(run, executable, args, timeoutMs) {
  if (!executable) return { ok: false, version: null, path: null, error: 'not found' };
  const result = await run(executable, args, timeoutMs);
  return {
    ok: result.ok,
    version: result.ok ? versionFrom(result.stdout || result.stderr) : null,
    path: executable,
    error: result.ok ? null : result.error,
  };
}

async function probeCcSwitchRunning(run, platform) {
  if (platform !== 'win32') return false;
  const result = await run(
    'tasklist',
    ['/FI', 'IMAGENAME eq cc-switch.exe', '/NH', '/FO', 'CSV'],
    1500
  );
  return result.ok && /cc-switch\.exe/i.test(result.stdout);
}

async function probeWinget(run) {
  const result = await run('winget', ['--version'], 3000);
  const version = versionFrom(result.stdout || result.stderr);
  return { available: result.ok && Boolean(version), version, error: result.ok ? null : result.error };
}

async function collectEnvStatus(options = {}) {
  const startedAt = Date.now();
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const home = options.home || env.USERPROFILE || env.HOME || '';
  const cwd = options.cwd || home;
  const localAppData = options.localAppData || env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const programFiles = options.programFiles || env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = options.programFilesX86 || env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const run = options.runCommand || runCommand;
  const tcp = options.probeTcp || probeTcp;

  const userSettings = readJson(path.join(home, '.claude', 'settings.json'));
  const projectSettings = readJson(path.join(cwd, '.claude', 'settings.json'));
  const projectLocal = readJson(path.join(cwd, '.claude', 'settings.local.json'));
  const claudeConfig = readJson(path.join(home, '.claude.json'));
  const oauthFile = fileExists(path.join(home, '.claude', '.credentials.json'));

  const authSource = pickAuthSource(env, [projectLocal, projectSettings, userSettings]);
  const baseUrl = sanitizeBaseUrl(authSource.baseUrl);
  const ccswitchPath = findCcSwitchPath({ env, localAppData, programFiles });
  const bundledPath = options.resolveBundledClaude ? options.resolveBundledClaude() : null;
  const standalone = findStandaloneClaude(env);
  const nodeDirs = [path.join(programFiles, 'nodejs')];
  const gitExe = findExecutable('git', {
    env,
    extraDirs: [path.join(programFiles, 'Git', 'cmd')],
  });
  const bashCandidates = [
    env.CLAUDE_CODE_GIT_BASH_PATH,
    gitExe ? path.resolve(path.dirname(gitExe), '..', 'bin', 'bash.exe') : null,
    path.join(programFiles, 'Git', 'bin', 'bash.exe'),
    path.join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
  ].filter(Boolean);
  const bashExe = bashCandidates.find(fileExists) || findExecutable('bash', { env });
  const nodeExe = findExecutable('node', { env, extraDirs: nodeDirs });
  const npxPath = findExecutable('npx', { env, extraDirs: nodeDirs });
  const python = findPython(env, localAppData, programFiles, programFilesX86);
  const mcp = mcpNeedsNode(claudeConfig, cwd);
  const helperPresent = Boolean(
    userSettings.apiKeyHelper ||
      projectSettings.apiKeyHelper ||
      projectLocal.apiKeyHelper
  );

  const [proxyReachable, git, bash, node, py, claudeCli, ccswitchRunning, winget] =
    await Promise.all([
      baseUrl?.isLocal ? tcp(baseUrl.hostname, baseUrl.port, 1200) : Promise.resolve(null),
      versionOf(run, gitExe, ['--version'], 1500),
      versionOf(run, bashExe, ['--version'], 1500),
      versionOf(run, nodeExe, ['--version'], 1500),
      versionOf(run, python?.exe, python?.args || ['--version'], 2000),
      versionOf(run, bundledPath, ['--version'], 2500),
      probeCcSwitchRunning(run, platform),
      probeWinget(run),
    ]);

  const proxy = {
    local: Boolean(baseUrl?.isLocal),
    reachable: baseUrl?.isLocal ? proxyReachable : null,
    host: baseUrl?.host || null,
  };
  const ccswitchRunningFinal = ccswitchRunning || proxy.reachable === true;
  const hasAuth =
    authSource.tokenPresent || authSource.apiKeyPresent || oauthFile || helperPresent;

  const actionFor = (tool) =>
    winget.available
      ? { id: `install:${tool}`, label: '一键安装', kind: 'install' }
      : { id: `download:${tool}`, label: '打开下载页', kind: 'download' };

  const components = [
    {
      id: 'claude',
      label: '内置 Claude Code',
      level: 'required',
      status: claudeCli.ok ? 'ok' : 'missing',
      version: claudeCli.version,
      detail: claudeCli.ok
        ? '已随 ClaudeDesk 内置，无需另外安装'
        : '未找到内置 CLI，请重新安装 ClaudeDesk',
      actions: claudeCli.ok
        ? []
        : [{ id: 'docs:claude', label: '查看安装说明', kind: 'docs' }],
    },
    {
      id: 'git-bash',
      label: 'Git / Git Bash',
      level: 'required',
      status: git.ok && bash.ok ? 'ok' : 'missing',
      version: git.version,
      detail:
        git.ok && bash.ok
          ? `Git ${git.version || ''}${bash.version ? ` · Bash ${bash.version}` : ''}，可用于执行命令`
          : `缺少 ${git.ok ? 'Git Bash' : 'Git'}；Claude 无法执行 shell 命令`,
      actions: git.ok && bash.ok ? [] : [actionFor('git')],
    },
    {
      id: 'node',
      label: 'Node / npx',
      level: mcp.uses > 0 ? 'required' : 'recommended',
      status: node.ok && npxPath ? 'ok' : 'missing',
      version: node.version,
      detail:
        node.ok && npxPath
          ? `Node ${node.version || ''}${mcp.uses > 0 ? `；${mcp.uses} 个 MCP 使用 npx` : ''}`
          : `未检测到 Node/npx${mcp.uses > 0 ? `；${mcp.uses} 个 MCP 需要它` : ''}`,
      actions: node.ok && npxPath ? [] : [actionFor('node')],
    },
    {
      id: 'python',
      label: 'Python',
      level: 'optional',
      status: py.ok ? 'ok' : 'warning',
      version: py.version,
      detail: py.ok
        ? `Python ${py.version || ''}（可选）`
        : '未安装（可选；只有部分 MCP/脚本需要）',
      actions: py.ok ? [] : [actionFor('python')],
    },
    {
      id: 'claude-cli',
      label: '独立 Claude 终端版',
      level: 'optional',
      status: standalone.installed ? 'ok' : 'warning',
      version: standalone.version,
      detail: standalone.installed
        ? '已安装（可选；ClaudeDesk 已内置，不依赖它）'
        : '未安装（可选；ClaudeDesk 已内置）',
      actions: [],
    },
    {
      id: 'ccswitch',
      label: 'CC Switch',
      level: baseUrl?.isLocal ? 'required' : 'recommended',
      status: !ccswitchPath
        ? baseUrl?.isLocal
          ? 'missing'
          : 'warning'
        : ccswitchRunningFinal
          ? 'ok'
          : 'warning',
      version: null,
      detail: ccswitchPath
        ? ccswitchRunningFinal
          ? '已安装并运行'
          : '已安装，但代理未连接'
        : '未安装；当前鉴权使用本机代理时会无法连接',
      actions: !ccswitchPath
        ? [{ id: 'download:ccswitch', label: '打开下载页', kind: 'download' }]
        : ccswitchRunningFinal
          ? []
          : [{ id: 'launch:ccswitch', label: '启动 CC Switch', kind: 'launch' }],
    },
  ];

  let authStatus = 'missing';
  let authDetail = '未检测到登录、API Key 或本机代理';
  if (baseUrl?.isLocal) {
    if (!proxy.reachable) {
      authStatus = 'error';
      authDetail = `本机代理 ${baseUrl.host} 连不上（可能未启动或被拦截）`;
    } else if (!hasAuth) {
      authStatus = 'warning';
      authDetail = `代理 ${baseUrl.host} 可连接，但未检测到令牌/登录`;
    } else {
      authStatus = 'ok';
      authDetail = `本机代理 ${baseUrl.host} 可连接；${
        authSource.tokenPresent
          ? '令牌已配置（值已隐藏）'
          : authSource.apiKeyPresent
            ? 'API Key 已配置（值已隐藏）'
            : oauthFile
              ? '检测到官方登录凭据'
              : '鉴权已配置'
      }`;
    }
  } else if (baseUrl) {
    authStatus = hasAuth ? 'ok' : 'warning';
    authDetail = `自定义通道 ${baseUrl.host}${
      hasAuth ? '；鉴权已配置（未做网络验证）' : '；未检测到鉴权'
    }`;
  } else if (hasAuth) {
    authStatus = 'ok';
    authDetail = authSource.apiKeyPresent
      ? 'API Key 已配置（值已隐藏）'
      : authSource.tokenPresent
        ? '令牌已配置（值已隐藏）'
        : '检测到官方登录凭据';
  }

  const authActions = [];
  if (baseUrl?.isLocal && !proxy.reachable) {
    authActions.push(
      ccswitchPath
        ? { id: 'launch:ccswitch', label: '启动 CC Switch', kind: 'launch' }
        : { id: 'download:ccswitch', label: '下载 CC Switch', kind: 'download' }
    );
  } else if (!hasAuth && !baseUrl) {
    authActions.push({ id: 'download:ccswitch', label: '下载 CC Switch', kind: 'download' });
  }

  const auth = {
    id: 'auth',
    label: '鉴权 / 登录',
    level: 'required',
    status: authStatus,
    version: null,
    detail: authDetail,
    baseUrlHost: baseUrl?.host || null,
    proxy,
    credentials: {
      tokenPresent: authSource.tokenPresent,
      apiKeyPresent: authSource.apiKeyPresent,
      oauthFile,
      helperPresent,
    },
    source: authSource.source,
    actions: authActions,
  };

  const all = [auth, ...components];
  const summary = summarizeStatus(all);
  const notes = [];
  if (!winget.available) {
    notes.push('本机 winget 不可用，安装操作会自动打开官方下载页');
  }
  if (summary.requiredMissing > 0) {
    notes.push('安装完成后请点「重新检查」；若仍不识别，请重启 ClaudeDesk');
  }

  return {
    ok: true,
    checkedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    platform,
    isPackaged: Boolean(options.isPackaged),
    summary: { ...summary, notes },
    auth,
    components,
  };
}

module.exports = {
  ENV_ACTIONS,
  FALLBACK_URLS,
  WINGET_PACKAGES,
  resolveEnvAction,
  buildWingetScript,
  sanitizeBaseUrl,
  isWindowsAppsPath,
  versionFrom,
  summarizeStatus,
  runCommand,
  probeTcp,
  collectEnvStatus,
  findCcSwitchPath,
  findStandaloneClaude,
  mcpNeedsNode,
  pickAuthSource,
};
