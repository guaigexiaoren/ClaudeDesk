'use strict';

const path = require('node:path');
const fs = require('node:fs');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
} = require('electron');

const { Store } = require('./store');
const { SessionManager } = require('./session');
const { TerminalSession } = require('./terminal');

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
let quickWindow = null;
let tray = null;
let store = null;
// 多个对话可以同时运行：key 由渲染进程生成，每个 key 对应一个独立的会话进程
const sessions = new Map();
let focusedKey = null;
let terminal = null;
let isQuitting = false;
let idleTimer = null;
const QUICK_SHORTCUT = 'CommandOrControl+Alt+Space';
const IDLE_CLOSE_MS = Number(process.env.CLAUDE_DESK_IDLE_MS) || 30 * 60 * 1000;
const IDLE_CHECK_MS = Math.min(60_000, IDLE_CLOSE_MS);

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
    show: !IS_SMOKE,
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

  let rendererLoaded = false;
  mainWindow.webContents.on('did-finish-load', () => {
    rendererLoaded = true;
  });
  // 页面刷新/渲染进程崩溃后，旧会话进程会变成无法关闭的孤儿，这里统一回收
  mainWindow.webContents.on('did-start-loading', () => {
    if (!rendererLoaded) return;
    rendererLoaded = false;
    closeAllSessions();
  });
  mainWindow.webContents.on('render-process-gone', () => {
    rendererLoaded = false;
    closeAllSessions();
  });

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

  mainWindow.on('close', (event) => {
    if (!mainWindow) return;
    const b = mainWindow.getBounds();
    store.merge({ windowBounds: { width: b.width, height: b.height, x: b.x, y: b.y } });
    if (!isQuitting && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
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

  // 对话里的链接用系统浏览器打开，避免整个应用被导航走
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    try {
      const { protocol } = new URL(url);
      if (protocol === 'http:' || protocol === 'https:') shell.openExternal(url);
    } catch {
      // 非法 URL 直接忽略
    }
  });
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createQuickWindow() {
  quickWindow = new BrowserWindow({
    width: 680,
    height: 154,
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#101216',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  quickWindow.loadFile(path.join(__dirname, '..', 'renderer', 'quick.html'));
  quickWindow.on('blur', () => {
    if (quickWindow && !quickWindow.isDestroyed()) quickWindow.hide();
  });
  quickWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    quickWindow.hide();
  });
  quickWindow.webContents.on('will-navigate', (event) => event.preventDefault());
}

function showQuickWindow() {
  if (!quickWindow || quickWindow.isDestroyed()) {
    createQuickWindow();
    quickWindow.once('ready-to-show', () => showQuickWindow());
    return;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const [width] = quickWindow.getSize();
  quickWindow.setPosition(
    Math.round(workArea.x + (workArea.width - width) / 2),
    Math.round(workArea.y + 140)
  );
  quickWindow.show();
  quickWindow.focus();
  quickWindow.webContents.send('quick:focus');
}

function toggleQuickWindow() {
  if (quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible()) {
    quickWindow.hide();
    return;
  }
  showQuickWindow();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
  tray = new Tray(process.platform === 'win32' ? icon.resize({ width: 16, height: 16 }) : icon);
  tray.setToolTip('ClaudeDesk');
  const shortcutLabel = process.platform === 'darwin' ? 'Cmd+Alt+Space' : 'Ctrl+Alt+Space';
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: showMainWindow },
      {
        label: `快速提问（${shortcutLabel}）`,
        click: showQuickWindow,
      },
      {
        label: '新建会话',
        click: () => {
          showMainWindow();
          send('menu:new-session');
        },
      },
      { type: 'separator' },
      {
        label: '退出 ClaudeDesk',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
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

  // 通过渲染层发消息，确保计划卡内联在当前会话，而不是后台会话
  await wc.executeJavaScript(`(() => {
    document.getElementById('permission-button').click();
    const plan = document.querySelector('.permission-option[data-mode="plan"]');
    if (plan) plan.click();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const notePath = path.join(dir, 'note.txt');
  const prompt = `请先列出一个计划：把 ${notePath} 的内容改成 hello claude。只做计划，不要修改文件，完成后调用 ExitPlanMode 把计划提交给我确认。`;
  await wc.executeJavaScript(`(() => {
    const input = document.getElementById('input');
    input.value = ${JSON.stringify(prompt)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('send').click();
  })()`);
  console.log('SMOKE_PLAN_SENT');

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
        const card = document.querySelector('.plan-inline');
        const approve = card && card.querySelector('[data-plan-action="approve"]');
        if (!approve) return null;
        const actions = approve.closest('.plan-inline-actions');
        if (actions && actions.hidden) return null;
        const text = card.querySelector('.plan-inline-body')?.textContent || '';
        approve.click();
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
    `window.desk.startSession({ key: 'smoke', cwd: ${JSON.stringify(process.cwd())}, model: 'default', permissionMode: 'default' })`
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
    key: 'smoke',
    request: {
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
    },
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

  // 后台会话的计划请求：不弹窗、不建卡、不打断当前输入
  await wc.executeJavaScript(`document.getElementById('input').value = '正在输入的内容'`);
  wc.send('session:plan', {
    key: 'smoke',
    request: {
      id: 'smoke-plan',
      toolUseId: 'smoke-plan-tool',
      toolName: 'ExitPlanMode',
      plan: '# 测试计划\n\n1. 第一步\n2. 第二步',
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 500));

  const plan = await wc.executeJavaScript(`(() => JSON.stringify({
    modalGone: !document.getElementById('plan-modal'),
    cards: document.querySelectorAll('.plan-inline').length,
    inputKept: document.getElementById('input').value === '正在输入的内容',
  }))()`);
  await wc.executeJavaScript(`document.getElementById('input').value = ''`);

  // 内联计划卡本身由 --smoke-plan（真实会话）验证
  const planFeedback = JSON.stringify({ skipped: true, reason: 'background plan does not render' });

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
    `window.desk.startSession({ key: 'smoke', cwd: ${JSON.stringify(dir)}, model: 'default', permissionMode: 'default' })`
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
    `window.desk.startSession({ key: 'smoke', cwd: ${JSON.stringify(dir)}, model: 'default', permissionMode: 'default' })`
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
    `window.desk.startSession({ key: 'smoke', cwd: ${JSON.stringify(dir)}, model: 'default', permissionMode: 'default' })`
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

function createSessionManager(key) {
  const manager = new SessionManager({ claudeExecutable: resolveClaudeExecutable() });
  manager.lastActiveAt = Date.now();
  const touch = () => {
    manager.lastActiveAt = Date.now();
  };

  manager.on('state', (state) => {
    touch();
    send('session:state', { key, ...state });
  });
  manager.on('message', (message) => {
    touch();
    send('session:event', { key, message });
  });
  manager.on('permission', (request) => {
    touch();
    send('session:permission', { key, request });
  });
  manager.on('question', (request) => {
    touch();
    send('session:question', { key, request });
  });
  manager.on('plan', (request) => {
    touch();
    send('session:plan', { key, request });
  });
  manager.on('commands', (commands) => send('session:commands', { key, commands }));
  manager.on('error', (err) => send('session:error', { key, message: err?.message || String(err) }));
  manager.on('stderr', (data) => {
    if (process.env.CLAUDE_DESK_DEBUG) console.error(`[claude:${key}]`, data);
    send('session:stderr', { key, text: String(data || '') });
  });

  sessions.set(key, manager);
  return manager;
}

function getSessionManager(key) {
  return key ? sessions.get(key) || null : null;
}

function closeAllSessions() {
  for (const manager of sessions.values()) {
    manager.close().catch(() => {});
  }
  sessions.clear();
  focusedKey = null;
}

/** 后台空闲会话定时回收，避免每个对话一直占着一个 CLI 进程。 */
function startIdleReaper() {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, manager] of [...sessions]) {
      if (key === focusedKey) continue;
      if (manager.starting || manager.status === 'running') continue;
      if (manager.pendingPermissions.size > 0) continue;
      if (now - (manager.lastActiveAt || 0) < IDLE_CLOSE_MS) continue;
      sessions.delete(key);
      manager.close().catch(() => {});
      send('session:released', { key });
    }
  }, IDLE_CHECK_MS);
  idleTimer.unref?.();
}

async function closeSessionManager(key) {
  const manager = sessions.get(key);
  sessions.delete(key);
  if (!manager) return { ok: true };
  await manager.close();
  if (focusedKey === key) focusedKey = null;
  return { ok: true };
}

const MAX_HISTORY_TEXT = 8000;

/** 工具输出在界面上本来就只显示 8000 字，历史回传前先截断，减少传输和内存。 */
function trimHistoryText(text) {
  return typeof text === 'string' && text.length > MAX_HISTORY_TEXT
    ? `${text.slice(0, MAX_HISTORY_TEXT)}\n…（已截断）`
    : text;
}

function trimHistoryMessage(item) {
  const content = item?.message?.content;
  if (!Array.isArray(content)) return item;
  let changed = false;
  const blocks = content.map((block) => {
    if (!block || block.type !== 'tool_result') return block;
    if (typeof block.content === 'string') {
      const trimmed = trimHistoryText(block.content);
      if (trimmed === block.content) return block;
      changed = true;
      return { ...block, content: trimmed };
    }
    if (Array.isArray(block.content)) {
      let innerChanged = false;
      const inner = block.content.map((part) => {
        if (part?.type !== 'text') return part;
        const trimmed = trimHistoryText(part.text);
        if (trimmed === part.text) return part;
        innerChanged = true;
        return { ...part, text: trimmed };
      });
      if (!innerChanged) return block;
      changed = true;
      return { ...block, content: inner };
    }
    return block;
  });
  if (!changed) return item;
  return { ...item, message: { ...item.message, content: blocks } };
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
    'dialog:pick-attachments',
    safe(async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择图片或文件',
        properties: ['openFile', 'multiSelections'],
      });
      return { ok: true, paths: result.canceled ? [] : result.filePaths };
    })
  );

  ipcMain.handle(
    'file:describe',
    safe(async ({ path: target } = {}) => {
      if (!target) return { ok: false, error: '缺少文件路径' };
      const stat = await fs.promises.stat(target);
      if (!stat.isFile()) return { ok: false, error: '只能添加文件' };
      const name = path.basename(target);
      const ext = path.extname(target).toLowerCase();
      const imageTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      };
      const mediaType = imageTypes[ext];
      if (mediaType) {
        if (stat.size > 5 * 1024 * 1024) return { ok: false, error: '图片不能超过 5MB' };
        const data = (await fs.promises.readFile(target)).toString('base64');
        return { ok: true, kind: 'image', path: target, name, size: stat.size, mediaType, data };
      }
      return { ok: true, kind: 'file', path: target, name, size: stat.size };
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
    'dialog:save-text',
    safe(async ({ defaultPath, content } = {}) => {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出会话',
        defaultPath: defaultPath || 'claude-session.md',
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePath) return { ok: true, path: null };
      fs.writeFileSync(result.filePath, String(content ?? ''), 'utf8');
      return { ok: true, path: result.filePath };
    })
  );

  ipcMain.handle(
    'pty:start',
    safe(async ({ cwd, cols, rows } = {}) =>
      terminal.start({
        cwd,
        cols,
        rows,
        onData: (data) => send('pty:data', { data }),
        onExit: (info) => send('pty:exit', info),
      })
    )
  );

  ipcMain.handle('pty:write', safe(async ({ data } = {}) => terminal.write(data)));
  ipcMain.handle(
    'pty:resize',
    safe(async ({ cols, rows } = {}) => terminal.resize(cols, rows))
  );
  ipcMain.handle('pty:stop', safe(async () => terminal.stop()));

  ipcMain.handle(
    'clipboard:read',
    safe(async () => ({ ok: true, text: clipboard.readText() }))
  );
  ipcMain.handle(
    'clipboard:write',
    safe(async ({ text } = {}) => {
      clipboard.writeText(String(text ?? ''));
      return { ok: true };
    })
  );

  ipcMain.handle(
    'quick:submit',
    safe(async ({ text } = {}) => {
      const value = String(text || '').trim();
      if (!value) return { ok: false, error: '内容为空' };
      quickWindow?.hide();
      showMainWindow();
      send('quick:send', { text: value });
      return { ok: true };
    })
  );

  ipcMain.handle(
    'quick:hide',
    safe(async () => {
      quickWindow?.hide();
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
      const messages = await getSessionMessages(sessionId, {
        dir: dir || undefined,
        includeSystemMessages: true,
      });
      // 只传完整对话和压缩标记，并截断过长的工具输出
      const kept = messages
        .filter((item) => item.type === 'system' || !item.parent_tool_use_id)
        .map(trimHistoryMessage);
      return { ok: true, messages: kept };
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
    'session:fork',
    safe(async ({ sessionId, dir, upToMessageId, title } = {}) => {
      if (!sessionId) return { ok: false, error: '缺少会话 ID' };
      const { forkSession } = await import('@anthropic-ai/claude-agent-sdk');
      const forked = await forkSession(sessionId, {
        dir: dir || undefined,
        upToMessageId: upToMessageId || undefined,
        title: title || undefined,
      });
      return { ok: true, sessionId: forked.sessionId };
    })
  );

  ipcMain.handle(
    'session:rewind',
    safe(async ({ key, userMessageId, dryRun } = {}) => {
      if (!userMessageId) return { ok: false, error: '缺少消息 ID' };
      const manager = getSessionManager(key);
      if (!manager) return { ok: false, error: '会话尚未启动' };
      const result = await manager.rewindFiles(userMessageId, { dryRun: Boolean(dryRun) });
      return { ok: true, result };
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
    safe(async ({ key, ...payload } = {}) => {
      if (!key) return { ok: false, error: '缺少会话标识' };
      let manager = sessions.get(key);
      if (!manager) manager = createSessionManager(key);
      else await manager.close();
      focusedKey = key;
      const result = await manager.start({ ...payload });
      const patch = { cwd: payload?.cwd || store.get().cwd };
      if (payload?.model) patch.model = payload.model;
      if (payload?.permissionMode) patch.permissionMode = payload.permissionMode;
      store.merge(patch);
      return result;
    })
  );

  ipcMain.handle(
    'session:resume',
    safe(async ({ key, sessionId, cwd, model, permissionMode } = {}) => {
      if (!key) return { ok: false, error: '缺少会话标识' };
      let manager = sessions.get(key);
      if (!manager) manager = createSessionManager(key);
      else await manager.close();
      focusedKey = key;
      const result = await manager.start({ cwd, model, permissionMode, resume: sessionId });
      store.merge({ cwd: cwd || store.get().cwd, lastSessionId: sessionId });
      return result;
    })
  );

  ipcMain.handle(
    'session:send',
    safe(async ({ key, text, content, steer } = {}) => {
      const manager = getSessionManager(key);
      if (!manager) return { ok: false, error: '会话尚未启动' };
      focusedKey = key;
      return manager.send(content ?? text, { priority: steer ? 'next' : undefined });
    })
  );

  ipcMain.handle(
    'session:interrupt',
    safe(async ({ key } = {}) => {
      const manager = getSessionManager(key);
      return manager ? manager.interrupt() : { ok: true };
    })
  );

  ipcMain.handle(
    'session:set-model',
    safe(async ({ key, model } = {}) => {
      store.merge({ model });
      const manager = getSessionManager(key);
      return manager ? manager.setModel(model) : { ok: true };
    })
  );

  ipcMain.handle(
    'session:set-permission-mode',
    safe(async ({ key, mode } = {}) => {
      store.merge({ permissionMode: mode });
      const manager = getSessionManager(key);
      return manager ? manager.setPermissionMode(mode) : { ok: true };
    })
  );

  ipcMain.handle('session:close', safe(async ({ key } = {}) => closeSessionManager(key)));

  ipcMain.handle(
    'session:focus',
    safe(async ({ key } = {}) => {
      const manager = getSessionManager(key);
      if (!manager) return { ok: true, attached: false };
      focusedKey = key;
      manager.lastActiveAt = Date.now();
      return { ok: true, attached: true };
    })
  );

  ipcMain.handle(
    'permission:respond',
    safe(async ({ key, id, decision } = {}) => {
      const manager = getSessionManager(key);
      if (!manager) return { ok: false, error: '会话已关闭' };
      return manager.respondPermission(id, decision);
    })
  );

  ipcMain.handle(
    'question:respond',
    safe(async ({ key, id, answers, response } = {}) => {
      const manager = getSessionManager(key);
      if (!manager) return { ok: false, error: '会话已关闭' };
      return manager.respondQuestion(id, { answers, response });
    })
  );

  ipcMain.handle(
    'plan:respond',
    safe(async ({ key, id, decision, editedPlan, feedback } = {}) => {
      const manager = getSessionManager(key);
      if (!manager) return { ok: false, error: '会话已关闭' };
      return manager.respondPlan(id, decision, editedPlan, feedback);
    })
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
        {
          label: '导出当前对话…',
          accelerator: 'CmdOrCtrl+E',
          click: () => send('menu:export'),
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
        {
          label: '页内查找',
          accelerator: 'CmdOrCtrl+F',
          click: () => send('menu:find'),
        },
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
    showMainWindow();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.yymy.claudedesk');
    store = new Store(app.getPath('userData'));
    terminal = new TerminalSession();
    registerIpc();
    buildMenu();
    createWindow();
    startIdleReaper();

    if (!IS_SMOKE) {
      try {
        createTray();
      } catch (err) {
        console.error('[tray] 创建托盘失败:', err);
      }
      globalShortcut.register(QUICK_SHORTCUT, toggleQuickWindow);
      if (!globalShortcut.isRegistered(QUICK_SHORTCUT)) {
        console.error('[shortcut] 快速提问快捷键注册失败，可能被其他程序占用');
      }
    }
  });

  app.on('activate', () => {
    if (mainWindow) showMainWindow();
  });

  app.on('window-all-closed', () => {
    // 有托盘时常驻后台；没有托盘（冒烟测试或托盘创建失败）就正常退出
    if (!tray) app.quit();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    globalShortcut.unregisterAll();
    if (idleTimer) {
      clearInterval(idleTimer);
      idleTimer = null;
    }
    if (terminal) terminal.stop();
    closeAllSessions();
  });
}
