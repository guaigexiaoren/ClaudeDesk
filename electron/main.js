'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');

const { Store } = require('./store');
const { SessionManager } = require('./session');

const IS_SMOKE =
  process.argv.includes('--smoke') ||
  process.argv.includes('--smoke-chat') ||
  process.argv.includes('--smoke-perm') ||
  process.argv.includes('--smoke-ui') ||
  process.argv.includes('--smoke-plan') ||
  process.argv.includes('--smoke-question') ||
  process.argv.includes('--smoke-bypass') ||
  process.argv.includes('--smoke-steer');
const IS_SMOKE_CHAT = process.argv.includes('--smoke-chat') || process.argv.includes('--smoke-perm');
const IS_SMOKE_PERM = process.argv.includes('--smoke-perm');
const IS_SMOKE_UI = process.argv.includes('--smoke-ui');
const IS_SMOKE_PLAN = process.argv.includes('--smoke-plan');
const IS_SMOKE_QUESTION = process.argv.includes('--smoke-question');
const IS_SMOKE_BYPASS = process.argv.includes('--smoke-bypass');
const IS_SMOKE_STEER = process.argv.includes('--smoke-steer');

let mainWindow = null;
let store = null;
let session = null;

function createWindow() {
  const settings = store.get();
  const bounds = settings.windowBounds || {};

  mainWindow = new BrowserWindow({
    width: bounds.width || 1320,
    height: bounds.height || 880,
    x: bounds.x,
    y: bounds.y,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#16181d',
    title: 'ClaudeDesk',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!IS_SMOKE) mainWindow.show();
  });

  if (IS_SMOKE) {
    mainWindow.webContents.on('console-message', (event) => {
      const text = event?.message ?? '';
      const level = event?.level ?? '';
      console.log(`[renderer:${level}] ${text}`);
    });
    mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
      console.error('SMOKE_FAIL_LOAD', code, description);
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('SMOKE_RENDERER_GONE', JSON.stringify(details));
    });
  }

  mainWindow.webContents.once('did-finish-load', () => {
    if (!IS_SMOKE) return;
    console.log('SMOKE_OK');
    if (IS_SMOKE_STEER) {
      runSteerSmoke();
      return;
    }
    if (IS_SMOKE_BYPASS) {
      runBypassSmoke();
      return;
    }
    if (IS_SMOKE_QUESTION) {
      runQuestionSmoke();
      return;
    }
    if (IS_SMOKE_PLAN) {
      runPlanSmoke();
      return;
    }
    if (IS_SMOKE_UI) {
      runUiSmoke();
      return;
    }
    if (IS_SMOKE_CHAT) {
      runChatSmoke();
      return;
    }
    setTimeout(async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(
          `JSON.stringify({
            hasBridge: typeof window.desk === 'object',
            title: (document.getElementById('session-title') || {}).textContent || null,
            sessionItems: document.querySelectorAll('.session-item').length,
            groups: document.querySelectorAll('.session-group').length,
            trashCount: (document.getElementById('trash-count') || {}).textContent || null,
            accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
            pageBg: getComputedStyle(document.body).backgroundColor,
            hasInput: !!document.getElementById('input'),
            composerButtons: document.querySelectorAll('.composer-row button').length,
            hasWelcome: !!document.querySelector('.welcome'),
            bodySize: [document.body.clientWidth, document.body.clientHeight]
          })`
        );
        console.log('SMOKE_STATE', result);
        const image = await mainWindow.webContents.capturePage();
        const shot = path.join(app.getPath('temp'), 'claudedesk-smoke.png');
        fs.writeFileSync(shot, image.toPNG());
        console.log('SMOKE_SHOT', shot);
      } catch (err) {
        console.error('SMOKE_STATE_ERROR', err.message);
      }
      app.quit();
    }, 2500);
  });

  mainWindow.on('close', () => {
    if (!mainWindow) return;
    const b = mainWindow.getBounds();
    store.merge({ windowBounds: { width: b.width, height: b.height, x: b.x, y: b.y } });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url);
      if (protocol === 'http:' || protocol === 'https:') shell.openExternal(url);
    } catch {
      // 非法 URL 直接忽略
    }
    return { action: 'deny' };
  });
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function runChatSmoke() {
  const wc = mainWindow.webContents;
  const prompt = IS_SMOKE_PERM
    ? '请在当前目录新建一个文件 smoke-perm.txt，内容写 ok。只做这一件事。'
    : '只回复两个字：收到。不要使用任何工具。';

  await new Promise((resolve) => setTimeout(resolve, 2500));

  await wc.executeJavaScript(`(() => {
    const input = document.getElementById('input');
    input.value = ${JSON.stringify(prompt)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('send').click();
    return true;
  })()`);

  const deadline = Date.now() + 90_000;
  let stats = '';
  const seenPermissions = [];
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const permission = await wc.executeJavaScript(`(() => {
      const modal = document.getElementById('permission-modal');
      if (!modal || modal.hidden) return null;
      const title = document.getElementById('perm-title').textContent;
      document.getElementById('perm-allow').click();
      return title;
    })()`);
    if (permission) {
      seenPermissions.push(permission);
      console.log('SMOKE_PERMISSION', permission);
      continue;
    }

    stats = await wc.executeJavaScript(
      `(() => { const nodes = document.querySelectorAll('.turn-stats'); const last = nodes[nodes.length - 1]; return last ? last.textContent : ''; })()`
    );
    if (stats) break;
  }

  const snapshot = await wc.executeJavaScript(
    `(() => {
      const blocks = document.querySelectorAll('.msg.assistant .markdown');
      const last = blocks[blocks.length - 1];
      const err = document.getElementById('error-bar');
      return JSON.stringify({
        reply: last ? last.textContent.trim().slice(0, 200) : '',
        stats: (document.querySelector('.turn-stats') || {}).textContent || '',
        error: err && !err.hidden ? err.textContent : '',
        userBubbles: document.querySelectorAll('.msg.user').length,
        toolCards: document.querySelectorAll('.tool-card').length
      });
    })()`
  );

  console.log('SMOKE_CHAT', snapshot);
  console.log('SMOKE_PERMISSIONS', JSON.stringify(seenPermissions));
  app.quit();
}

async function runPlanSmoke() {
  const wc = mainWindow.webContents;
  const dir = path.join(app.getPath('temp'), 'claudedesk-plan-smoke');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'note.txt'), 'hello\n', 'utf8');

  await new Promise((resolve) => setTimeout(resolve, 2500));

  const started = await wc.executeJavaScript(
    `window.desk.startSession({ cwd: ${JSON.stringify(dir)}, model: 'default', permissionMode: 'plan' })`
  );
  console.log('SMOKE_PLAN_START', JSON.stringify(started));
  await new Promise((resolve) => setTimeout(resolve, 3000));

  await wc.executeJavaScript(
    `window.desk.send('请先列出一个计划：把 note.txt 的内容改成 hello claude。只做计划，不要修改文件，完成后调用 ExitPlanMode 把计划提交给我确认。')`
  );

  const deadline = Date.now() + 120_000;
  let planText = '';
  let approved = false;
  let stats = '';

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const permission = await wc.executeJavaScript(`(() => {
      const modal = document.getElementById('permission-modal');
      if (!modal || modal.hidden) return null;
      const title = document.getElementById('perm-title').textContent;
      document.getElementById('perm-allow').click();
      return title;
    })()`);
    if (permission) {
      console.log('SMOKE_PLAN_PERMISSION', permission);
      continue;
    }

    if (!approved) {
      const plan = await wc.executeJavaScript(`(() => {
        const modal = document.getElementById('plan-modal');
        if (!modal || modal.hidden) return null;
        const text = document.getElementById('plan-body').textContent;
        document.getElementById('plan-approve').click();
        return text;
      })()`);
      if (plan) {
        planText = plan;
        approved = true;
        console.log('SMOKE_PLAN_APPROVED', JSON.stringify(plan.slice(0, 200)));
        continue;
      }
    }

    stats = await wc.executeJavaScript(
      `(() => { const nodes = document.querySelectorAll('.turn-stats'); const last = nodes[nodes.length - 1]; return last ? last.textContent : ''; })()`
    );
    if (stats && approved) break;
  }

  let content = '';
  try {
    content = fs.readFileSync(path.join(dir, 'note.txt'), 'utf8').trim();
  } catch {
    content = '(读取失败)';
  }

  console.log(
    'SMOKE_PLAN_RESULT',
    JSON.stringify({ approved, planText: planText.slice(0, 120), stats, content })
  );
  app.quit();
}

async function runUiSmoke() {
  const wc = mainWindow.webContents;
  await new Promise((resolve) => setTimeout(resolve, 2500));

  // 启动一个空会话，拿到 init 消息里的斜杠命令列表
  const started = await wc.executeJavaScript(
    `window.desk.startSession({ cwd: ${JSON.stringify(process.cwd())}, model: 'default', permissionMode: 'default' })`
  );
  console.log('SMOKE_UI_START', JSON.stringify(started));
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const slash = await wc.executeJavaScript(`(() => {
    const input = document.getElementById('input');
    input.value = '/';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const palette = document.getElementById('slash-palette');
    return JSON.stringify({ visible: !palette.hidden, items: palette.children.length });
  })()`);

  wc.send('session:question', {
    id: 'smoke-question',
    toolName: 'AskUserQuestion',
    questions: [
      {
        question: '用哪个 Markdown 库？',
        header: '库',
        options: [
          { label: 'marked', description: '轻量、快' },
          { label: 'remark', description: '插件生态大' },
        ],
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 600));

  const question = await wc.executeJavaScript(`(() => {
    const modal = document.getElementById('question-modal');
    const options = document.querySelectorAll('#question-list .option').length;
    const first = document.querySelector('#question-list input[type=radio]');
    if (first) first.checked = true;
    return JSON.stringify({ visible: !modal.hidden, options });
  })()`);
  await wc.executeJavaScript(`document.getElementById('question-submit').click()`);
  await new Promise((resolve) => setTimeout(resolve, 300));

  wc.send('session:plan', {
    id: 'smoke-plan',
    toolName: 'ExitPlanMode',
    plan: '# 测试计划\n\n1. 第一步\n2. 第二步',
  });
  await new Promise((resolve) => setTimeout(resolve, 600));

  const plan = await wc.executeJavaScript(`(() => {
    const modal = document.getElementById('plan-modal');
    const body = document.getElementById('plan-body');
    return JSON.stringify({ visible: !modal.hidden, rendered: body.querySelector('h1') !== null });
  })()`);

  const planFeedback = await wc.executeJavaScript(`(() => {
    document.getElementById('plan-reject').click();
    return JSON.stringify({
      visible: !document.getElementById('plan-feedback-wrap').hidden,
      label: document.getElementById('plan-reject').textContent,
    });
  })()`);
  await wc.executeJavaScript(`document.getElementById('plan-approve').click()`);

  const accent = await wc.executeJavaScript(`(async () => {
    const read = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const before = read();
    const swatches = document.querySelectorAll('.swatch');
    if (swatches.length < 2) return JSON.stringify({ skipped: true });
    swatches[1].click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const after = read();
    swatches[0].click();
    return JSON.stringify({ before, after, restored: read() });
  })()`);

  const trash = await wc.executeJavaScript(`(async () => {
    const count = () => document.getElementById('trash-count').textContent;
    const button = document.querySelector('.session-item .session-trash');
    if (!button) return JSON.stringify({ skipped: true });
    const list = document.getElementById('trash-list');
    const before = count();
    button.click();
    const after = count();
    const closedDisplay = getComputedStyle(list).display;
    document.getElementById('trash-toggle').click();
    const openDisplay = getComputedStyle(list).display;
    const arrow = document.getElementById('trash-arrow').textContent;
    const restore = document.querySelector('#trash-list .trash-row:last-child button');
    if (restore) restore.click();
    await new Promise((resolve) => setTimeout(resolve, 600));
    return JSON.stringify({ before, after, closedDisplay, openDisplay, arrow, restored: count() });
  })()`);

  const mcp = await wc.executeJavaScript(`(async () => {
    document.getElementById('open-settings').click();
    await new Promise((resolve) => setTimeout(resolve, 900));
    const items = document.querySelectorAll('#mcp-list .mcp-item').length;
    const first = (document.querySelector('#mcp-list .mcp-item') || {}).textContent || '';
    document.getElementById('settings-close').click();
    return JSON.stringify({ items, first: first.trim() });
  })()`);

  console.log('SMOKE_UI_SLASH', slash);
  console.log('SMOKE_UI_QUESTION', question);
  console.log('SMOKE_UI_PLAN', plan);
  console.log('SMOKE_UI_PLAN_FEEDBACK', planFeedback);
  console.log('SMOKE_UI_ACCENT', accent);
  console.log('SMOKE_UI_TRASH', trash);
  console.log('SMOKE_UI_MCP', mcp);
  app.quit();
}

async function runQuestionSmoke() {
  const wc = mainWindow.webContents;
  const dir = path.join(app.getPath('temp'), 'claudedesk-plan-smoke');

  await new Promise((resolve) => setTimeout(resolve, 2500));

  const started = await wc.executeJavaScript(
    `window.desk.startSession({ cwd: ${JSON.stringify(dir)}, model: 'default', permissionMode: 'default' })`
  );
  console.log('SMOKE_Q_START', JSON.stringify(started));
  await new Promise((resolve) => setTimeout(resolve, 3000));

  await wc.executeJavaScript(
    `window.desk.send('请用 AskUserQuestion 工具问我一个问题：Markdown 库选 marked 还是 remark？给出这两个选项。等我回答后，用一句话复述我选的库。')`
  );

  const deadline = Date.now() + 120_000;
  let asked = false;
  let chosen = '';
  let stats = '';

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));

    if (!asked) {
      const info = await wc.executeJavaScript(`(() => {
        const modal = document.getElementById('question-modal');
        if (!modal || modal.hidden) return null;
        const options = document.querySelectorAll('#question-list input[type=radio]');
        const labels = [...options].map((option) => option.value);
        if (options[0]) options[0].checked = true;
        document.getElementById('question-submit').click();
        return JSON.stringify({ labels });
      })()`);
      if (info) {
        asked = true;
        chosen = JSON.parse(info).labels[0] || '';
        console.log('SMOKE_Q_ASKED', info);
        continue;
      }
    }

    stats = await wc.executeJavaScript(
      `(() => { const nodes = document.querySelectorAll('.turn-stats'); const last = nodes[nodes.length - 1]; return last ? last.textContent : ''; })()`
    );
    if (stats && asked) break;
  }

  const reply = await wc.executeJavaScript(`(() => {
    const blocks = document.querySelectorAll('.msg.assistant .markdown');
    const last = blocks[blocks.length - 1];
    return last ? last.textContent.trim().slice(0, 200) : '';
  })()`);

  console.log('SMOKE_Q_RESULT', JSON.stringify({ asked, chosen, stats, reply }));
  app.quit();
}

async function runSteerSmoke() {
  const wc = mainWindow.webContents;
  const dir = path.join(app.getPath('temp'), 'claudedesk-steer-smoke');
  fs.mkdirSync(dir, { recursive: true });

  await new Promise((resolve) => setTimeout(resolve, 2500));

  const started = await wc.executeJavaScript(
    `window.desk.startSession({ cwd: ${JSON.stringify(dir)}, model: 'default', permissionMode: 'default' })`
  );
  console.log('SMOKE_STEER_START', JSON.stringify(started));
  await new Promise((resolve) => setTimeout(resolve, 3000));

  await wc.executeJavaScript(
    `window.desk.send('请运行命令：ping -n 10 127.0.0.1。等命令执行完，告诉我是否成功。')`
  );

  const startedAt = Date.now();
  let steered = false;
  let steerAt = 0;
  let badges = 0;
  let stats = '';

  while (Date.now() - startedAt < 120_000) {
    await new Promise((resolve) => setTimeout(resolve, 700));

    const permission = await wc.executeJavaScript(`(() => {
      const modal = document.getElementById('permission-modal');
      if (!modal || modal.hidden) return null;
      const title = document.getElementById('perm-title').textContent;
      document.getElementById('perm-allow').click();
      return title;
    })()`);
    if (permission) {
      console.log('SMOKE_STEER_PERMISSION', permission);
      continue;
    }

    if (!steered && Date.now() - startedAt > 4000) {
      badges = await wc.executeJavaScript(`(async () => {
        const input = document.getElementById('input');
        input.value = '另外，请在最终回复的最后一行写出当前工作目录的完整路径。';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('send').click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        return document.querySelectorAll('.bubble-badge').length;
      })()`);
      steered = true;
      steerAt = Date.now() - startedAt;
      continue;
    }

    stats = await wc.executeJavaScript(
      `(() => { const nodes = document.querySelectorAll('.turn-stats'); const last = nodes[nodes.length - 1]; return last ? last.textContent : ''; })()`
    );
    if (stats) break;
  }

  const snapshot = await wc.executeJavaScript(`(() => {
    const blocks = document.querySelectorAll('.msg.assistant .markdown');
    const last = blocks[blocks.length - 1];
    return JSON.stringify({
      reply: last ? last.textContent.trim().slice(-400) : '',
      userBubbles: document.querySelectorAll('.msg.user').length,
      badgesLeft: document.querySelectorAll('.bubble-badge').length,
      turnCount: document.querySelectorAll('.turn-stats').length
    });
  })()`);

  console.log('SMOKE_STEER', JSON.stringify({ steered, steerAt, badges, stats }));
  console.log('SMOKE_STEER_SNAPSHOT', snapshot);
  app.quit();
}

async function runBypassSmoke() {
  const wc = mainWindow.webContents;
  const dir = path.join(app.getPath('temp'), 'claudedesk-bypass-smoke');
  fs.mkdirSync(dir, { recursive: true });

  await new Promise((resolve) => setTimeout(resolve, 2500));
  await wc.executeJavaScript(
    `window.desk.startSession({ cwd: ${JSON.stringify(dir)}, model: 'default', permissionMode: 'default' })`
  );
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const applied = await wc.executeJavaScript(`window.desk.setPermissionMode('bypassPermissions')`);
  console.log('SMOKE_BYPASS_SET', JSON.stringify(applied));

  await wc.executeJavaScript(
    `window.desk.send('在当前目录创建 bypass-smoke.txt，内容写 ok。不要做别的事。')`
  );

  const deadline = Date.now() + 90_000;
  let permissionShown = '';
  let stats = '';

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));

    permissionShown = await wc.executeJavaScript(`(() => {
      const modal = document.getElementById('permission-modal');
      if (!modal || modal.hidden) return '';
      return document.getElementById('perm-title').textContent;
    })()`);
    if (permissionShown) break;

    stats = await wc.executeJavaScript(
      `(() => { const nodes = document.querySelectorAll('.turn-stats'); const last = nodes[nodes.length - 1]; return last ? last.textContent : ''; })()`
    );
    if (stats) break;
  }

  const fileCreated = fs.existsSync(path.join(dir, 'bypass-smoke.txt'));
  console.log('SMOKE_BYPASS', JSON.stringify({ permissionShown, stats, fileCreated }));

  try {
    fs.unlinkSync(path.join(dir, 'bypass-smoke.txt'));
  } catch {
    /* 忽略 */
  }
  app.quit();
}

function resolveClaudeExecutable() {
  if (!app.isPackaged) return null;
  const binary = process.platform === 'win32' ? 'claude.exe' : 'claude';
  return path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    `claude-agent-sdk-${process.platform}-${process.arch}`,
    binary
  );
}

function attachSession() {
  session = new SessionManager({ claudeExecutable: resolveClaudeExecutable() });

  session.on('state', (state) => send('session:state', state));
  session.on('message', (message) => send('session:event', message));
  session.on('permission', (request) => send('session:permission', request));
  session.on('question', (request) => send('session:question', request));
  session.on('plan', (request) => send('session:plan', request));
  session.on('commands', (commands) => send('session:commands', commands));
  session.on('error', (err) => send('session:error', { message: err?.message || String(err) }));
  session.on('stderr', (data) => {
    if (process.env.CLAUDE_DESK_DEBUG) console.error('[claude]', data);
  });

  session.on('state', (state) => {
    if (state.sessionId) {
      store.merge({ lastSessionId: state.sessionId, cwd: state.cwd || store.get().cwd });
    }
  });
}

function registerIpc() {
  const safe = (handler) => async (event, ...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      console.error('[ipc]', err);
      return { ok: false, error: err?.message || String(err) };
    }
  };

  ipcMain.handle(
    'app:get-state',
    safe(async () => {
      const settings = store.get();
      return {
        ok: true,
        settings,
        version: app.getVersion(),
        electron: process.versions.electron,
        homeDir: app.getPath('home'),
        defaultCwd: settings.cwd || app.getPath('home'),
      };
    })
  );

  ipcMain.handle(
    'app:save-settings',
    safe(async (patch) => ({ ok: true, settings: store.merge(patch) }))
  );

  ipcMain.handle(
    'dialog:pick-directory',
    safe(async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择工作目录',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: store.get().cwd || app.getPath('home'),
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: true, path: null };
      return { ok: true, path: result.filePaths[0] };
    })
  );

  ipcMain.handle(
    'shell:show-in-folder',
    safe(async (target) => {
      if (target) shell.showItemInFolder(target);
      return { ok: true };
    })
  );

  ipcMain.handle(
    'session:list',
    safe(async ({ dir } = {}) => {
      const { listSessions } = await import('@anthropic-ai/claude-agent-sdk');
      const list = await listSessions({ dir: dir || undefined, limit: 300 });
      const mapped = list.map((s) => ({
        sessionId: s.sessionId,
        title: s.customTitle || s.summary || s.firstPrompt || '未命名会话',
        lastModified: s.lastModified,
        createdAt: s.createdAt,
        cwd: s.cwd,
        gitBranch: s.gitBranch,
      }));
      return { ok: true, sessions: mapped };
    })
  );

  ipcMain.handle(
    'session:history',
    safe(async ({ sessionId, dir }) => {
      const { getSessionMessages } = await import('@anthropic-ai/claude-agent-sdk');
      const messages = await getSessionMessages(sessionId, { dir: dir || undefined });
      return { ok: true, messages };
    })
  );

  ipcMain.handle(
    'session:delete',
    safe(async ({ sessionId, dir }) => {
      const { deleteSession } = await import('@anthropic-ai/claude-agent-sdk');
      await deleteSession(sessionId, { dir: dir || undefined });
      return { ok: true };
    })
  );

  ipcMain.handle(
    'mcp:list',
    safe(async () => {
      const configPath = path.join(app.getPath('home'), '.claude.json');
      let config = {};
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch {
        config = {};
      }

      const toEntry = (name, server, scope) => ({
        name,
        scope,
        type: server.type || 'stdio',
        command: server.command || server.url || '',
        args: Array.isArray(server.args) ? server.args : [],
      });

      const servers = Object.entries(config.mcpServers || {}).map(([name, server]) =>
        toEntry(name, server, 'user')
      );

      const normalize = (target) => {
        const resolved = path.resolve(target || '');
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      };
      const cwdKey = normalize(store.get().cwd || '');
      let project = null;
      for (const [key, value] of Object.entries(config.projects || {})) {
        if (normalize(key) === cwdKey) {
          project = value;
          break;
        }
      }
      for (const [name, server] of Object.entries(project?.mcpServers || {})) {
        servers.push(toEntry(name, server, 'project'));
      }

      return { ok: true, servers, configPath };
    })
  );

  ipcMain.handle(
    'session:start',
    safe(async (payload) => {
      await session.close();
      const result = await session.start({ ...payload });
      const patch = { cwd: payload?.cwd || store.get().cwd };
      if (payload?.model) patch.model = payload.model;
      if (payload?.permissionMode) patch.permissionMode = payload.permissionMode;
      store.merge(patch);
      return result;
    })
  );

  ipcMain.handle(
    'session:resume',
    safe(async ({ sessionId, cwd, model, permissionMode }) => {
      await session.close();
      const result = await session.start({ cwd, model, permissionMode, resume: sessionId });
      store.merge({ cwd: cwd || store.get().cwd, lastSessionId: sessionId });
      return result;
    })
  );

  ipcMain.handle(
    'session:send',
    safe(async ({ text, steer }) => session.send(text, { priority: steer ? 'next' : undefined }))
  );

  ipcMain.handle('session:interrupt', safe(async () => session.interrupt()));

  ipcMain.handle(
    'session:set-model',
    safe(async ({ model }) => {
      store.merge({ model });
      return session.setModel(model);
    })
  );

  ipcMain.handle(
    'session:set-permission-mode',
    safe(async ({ mode }) => {
      store.merge({ permissionMode: mode });
      return session.setPermissionMode(mode);
    })
  );

  ipcMain.handle('session:close', safe(async () => session.close()));

  ipcMain.handle(
    'permission:respond',
    safe(async ({ id, decision }) => session.respondPermission(id, decision))
  );

  ipcMain.handle(
    'question:respond',
    safe(async ({ id, answers, response }) => session.respondQuestion(id, { answers, response }))
  );

  ipcMain.handle(
    'plan:respond',
    safe(async ({ id, decision, editedPlan, feedback }) =>
      session.respondPlan(id, decision, editedPlan, feedback)
    )
  );
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建会话',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('menu:new-session'),
        },
        {
          label: '打开工作目录…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('menu:pick-directory'),
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 ClaudeDesk',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 ClaudeDesk',
              message: 'ClaudeDesk',
              detail: `版本 ${app.getVersion()}\n基于 Claude Agent SDK 的桌面工作台。`,
              buttons: ['好的'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = IS_SMOKE ? true : app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.yymy.claudedesk');
    store = new Store(app.getPath('userData'));
    attachSession();
    registerIpc();
    buildMenu();
    createWindow();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    if (session) session.close();
  });
}
