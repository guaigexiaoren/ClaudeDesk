import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github-dark.css';
import { buildSessionGroups } from './session-groups.js';
import { formatDuration } from './format.js';

marked.setOptions({ gfm: true, breaks: true });

window.addEventListener('error', (event) => {
  console.error('界面错误:', event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('未处理的 Promise 错误:', event.reason);
});

const TOOL_SUMMARY = {
  Read: (input) => input.file_path,
  Write: (input) => input.file_path,
  Edit: (input) => input.file_path,
  MultiEdit: (input) => input.file_path,
  NotebookEdit: (input) => input.notebook_path,
  Bash: (input) => input.command,
  Glob: (input) => input.pattern,
  Grep: (input) => input.pattern,
  WebFetch: (input) => input.url,
  WebSearch: (input) => input.query,
  Task: (input) => input.description || input.subagent_type,
  TodoWrite: () => '更新任务列表',
};

const ACCENTS = {
  claude: { color: '#d97757', soft: 'rgba(217, 119, 87, 0.14)', border: 'rgba(217, 119, 87, 0.35)' },
  blue: { color: '#4f8cff', soft: 'rgba(79, 140, 255, 0.14)', border: 'rgba(79, 140, 255, 0.35)' },
  green: { color: '#3fb950', soft: 'rgba(63, 185, 80, 0.14)', border: 'rgba(63, 185, 80, 0.35)' },
  purple: { color: '#a371f7', soft: 'rgba(163, 113, 247, 0.14)', border: 'rgba(163, 113, 247, 0.35)' },
  pink: { color: '#ec6cb9', soft: 'rgba(236, 108, 185, 0.14)', border: 'rgba(236, 108, 185, 0.35)' },
  amber: { color: '#d29922', soft: 'rgba(210, 153, 34, 0.14)', border: 'rgba(210, 153, 34, 0.35)' },
};

const COMMAND_ZH = {
  help: '查看帮助',
  clear: '清空对话上下文',
  compact: '压缩上下文，腾出空间',
  autocompact: '自动压缩上下文',
  config: '查看或修改配置',
  color: '切换界面配色',
  context: '查看上下文占用',
  cost: '查看本次会话花费',
  usage: '查看用量统计',
  doctor: '检查运行环境',
  init: '生成项目的 CLAUDE.md',
  login: '登录账号',
  logout: '退出登录',
  mcp: '管理 MCP 服务器',
  memory: '编辑记忆文件',
  model: '切换模型',
  effort: '调整推理强度',
  fast: '切换快速模式',
  focus: '设置关注目标',
  goal: '设置当前目标',
  loop: '循环执行任务',
  rename: '重命名会话',
  recap: '回顾最近进度',
  insights: '查看使用分析',
  export: '导出对话',
  resume: '恢复历史会话',
  rewind: '回滚文件改动',
  permissions: '查看或修改权限规则',
  review: '代码审查',
  'code-review': '代码审查',
  'security-review': '安全审查',
  simplify: '简化代码建议',
  verify: '验证改动',
  debug: '调试当前会话',
  status: '查看当前状态',
  agents: '管理子代理',
  'list-agents': '列出子代理',
  hooks: '管理钩子',
  'output-style': '切换输出风格',
  'reload-plugins': '重新加载插件',
  'reload-skills': '重新加载技能',
  'plugin-authoring': '插件开发',
  'workflow-authoring': '工作流编写',
  'fewer-permission-prompts': '减少权限弹窗',
  'developing-with-streamlit': 'Streamlit 开发',
  dataviz: '数据可视化',
  'deep-research': '深度研究',
  'design-sync': '设计同步',
  'update-config': '更新配置',
  'claude-api': 'Claude API 参考',
  run: '运行项目',
  heapdump: '导出内存快照',
  batch: '批量任务',
  'auto-mode-setup': '自动模式设置',
  'team-onboarding': '团队上手引导',
};

const APP_MENU = [
  {
    label: '文件',
    items: [
      { label: '新建会话', accel: 'Ctrl+N', action: 'new-session' },
      { label: '打开工作目录…', accel: 'Ctrl+O', action: 'pick-directory' },
      { sep: true },
      { label: '退出', accel: 'Alt+F4', action: 'quit' },
    ],
  },
  {
    label: '编辑',
    items: [
      { label: '撤销', accel: 'Ctrl+Z', action: 'undo' },
      { label: '重做', accel: 'Ctrl+Y', action: 'redo' },
      { sep: true },
      { label: '剪切', accel: 'Ctrl+X', action: 'cut' },
      { label: '复制', accel: 'Ctrl+C', action: 'copy' },
      { label: '粘贴', accel: 'Ctrl+V', action: 'paste' },
      { sep: true },
      { label: '全选', accel: 'Ctrl+A', action: 'select-all' },
    ],
  },
  {
    label: '视图',
    items: [
      { label: '重新加载', accel: 'Ctrl+R', action: 'reload' },
      { label: '开发者工具', accel: 'Ctrl+Shift+I', action: 'devtools' },
      { sep: true },
      { label: '实际大小', accel: 'Ctrl+0', action: 'zoom-reset' },
      { label: '放大', accel: 'Ctrl+=', action: 'zoom-in' },
      { label: '缩小', accel: 'Ctrl+-', action: 'zoom-out' },
      { sep: true },
      { label: '全屏', accel: 'F11', action: 'fullscreen' },
    ],
  },
  {
    label: '帮助',
    items: [{ label: '关于 ClaudeDesk', action: 'about' }],
  },
];

const state = {
  settings: {},
  sessions: [],
  cwd: '',
  accent: 'claude',
  model: 'default',
  permissionMode: 'default',
  sessionId: null,
  sessionActive: false,
  running: false,
  sending: false,
  streamEl: null,
  toolCards: new Map(),
  permissionQueue: [],
  currentPermission: null,
  currentQuestion: null,
  currentPlan: null,
  commands: [],
  terminalCommands: new Set(),
  slashItems: [],
  slashIndex: 0,
  mcpStatus: {},
  lastUserText: '',
};

const $ = (id) => document.getElementById(id);

const els = {
  messages: $('messages'),
  input: $('input'),
  send: $('send'),
  stop: $('stop'),
  errorBar: $('error-bar'),
  statusDot: $('status-dot'),
  sessionTitle: $('session-title'),
  sessionMeta: $('session-meta'),
  sessionList: $('session-list'),
  addDirectory: $('add-directory'),
  appMenu: $('app-menu'),
  trashToggle: $('trash-toggle'),
  trashArrow: $('trash-arrow'),
  trashList: $('trash-list'),
  trashCount: $('trash-count'),
  modeSelect: $('mode-select'),
  permModal: $('permission-modal'),
  permTitle: $('perm-title'),
  permDetail: $('perm-detail'),
  permInput: $('perm-input'),
  permAllow: $('perm-allow'),
  permAllowSession: $('perm-allow-session'),
  permDeny: $('perm-deny'),
  questionModal: $('question-modal'),
  questionList: $('question-list'),
  questionSubmit: $('question-submit'),
  questionSkip: $('question-skip'),
  planModal: $('plan-modal'),
  planBody: $('plan-body'),
  planApprove: $('plan-approve'),
  planReject: $('plan-reject'),
  planFeedbackWrap: $('plan-feedback-wrap'),
  planFeedback: $('plan-feedback'),
  slashPalette: $('slash-palette'),
  settingsModal: $('settings-modal'),
  accentSwatches: $('accent-swatches'),
  fontSize: $('font-size'),
  fontSizeValue: $('font-size-value'),
  settingsCwd: $('settings-cwd'),
  settingsVersion: $('settings-version'),
  mcpList: $('mcp-list'),
  mcpRefresh: $('mcp-refresh'),
};

/* ---------------- 工具函数 ---------------- */

function renderMarkdown(text) {
  const html = marked.parse(text ?? '');
  return DOMPurify.sanitize(html);
}

function highlightCode(root) {
  root.querySelectorAll('pre code').forEach((block) => {
    try {
      hljs.highlightElement(block);
    } catch {
      /* 忽略未知语言 */
    }
  });
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

function toolSummary(name, input) {
  const fn = TOOL_SUMMARY[name];
  if (fn) {
    try {
      const value = fn(input || {});
      if (value) return String(value);
    } catch {
      /* 忽略 */
    }
  }
  if (input && typeof input === 'object') {
    for (const value of Object.values(input)) {
      if (typeof value === 'string' && value.length > 0) return value;
    }
  }
  return '';
}

function scrollToBottom(force = false) {
  const el = els.messages;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  if (force || nearBottom) el.scrollTop = el.scrollHeight;
}

function removeWelcome() {
  const welcome = els.messages.querySelector('.welcome');
  if (welcome) welcome.remove();
}

function appendEl(el) {
  removeWelcome();
  els.messages.appendChild(el);
  scrollToBottom();
  return el;
}

/* ---------------- 消息渲染 ---------------- */

function appendUserMessage(text, steer = false) {
  const wrap = document.createElement('div');
  wrap.className = 'msg user';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  if (steer) {
    const badge = document.createElement('span');
    badge.className = 'bubble-badge';
    badge.textContent = '插入';
    bubble.appendChild(badge);
  }
  wrap.appendChild(bubble);
  appendEl(wrap);
}

function clearInsertBadges() {
  document.querySelectorAll('.bubble-badge').forEach((badge) => badge.remove());
}

function appendMarkdown(text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  const md = document.createElement('div');
  md.className = 'markdown';
  md.innerHTML = renderMarkdown(text);
  highlightCode(md);
  wrap.appendChild(md);
  appendEl(wrap);
  return md;
}

function appendThinking(text) {
  const details = document.createElement('details');
  details.className = 'thinking';
  const summary = document.createElement('summary');
  summary.textContent = '思考过程';
  const body = document.createElement('div');
  body.className = 'thinking-body';
  body.textContent = text;
  details.append(summary, body);
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.appendChild(details);
  appendEl(wrap);
  return details;
}

function appendToolUse(block) {
  const card = document.createElement('div');
  card.className = 'tool-card';
  card.dataset.toolId = block.id;

  const head = document.createElement('div');
  head.className = 'tool-head';

  const icon = document.createElement('span');
  icon.className = 'tool-icon';
  icon.textContent = '⚙';

  const name = document.createElement('span');
  name.className = 'tool-name';
  name.textContent = block.name;

  const summary = document.createElement('span');
  summary.className = 'tool-summary';
  summary.textContent = toolSummary(block.name, block.input);

  const status = document.createElement('span');
  status.className = 'tool-status running';
  status.textContent = '运行中';

  head.append(icon, name, summary, status);

  const body = document.createElement('div');
  body.className = 'tool-body';

  const inputLabel = document.createElement('div');
  inputLabel.className = 'tool-section-label';
  inputLabel.textContent = '输入';
  const inputPre = document.createElement('pre');
  inputPre.className = 'tool-pre';
  inputPre.textContent = JSON.stringify(block.input ?? {}, null, 2);

  body.append(inputLabel, inputPre);
  card.append(head, body);

  head.addEventListener('click', () => card.classList.toggle('open'));

  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.appendChild(card);
  appendEl(wrap);

  state.toolCards.set(block.id, { card, status, body, hasResult: false });
  return card;
}

function attachToolResult(toolUseId, text, isError) {
  const entry = state.toolCards.get(toolUseId);
  if (!entry) return;

  if (!entry.hasResult) {
    const label = document.createElement('div');
    label.className = 'tool-section-label';
    label.textContent = isError ? '错误' : '输出';
    const pre = document.createElement('pre');
    pre.className = 'tool-pre';
    entry.body.append(label, pre);
    entry.resultPre = pre;
    entry.hasResult = true;
  }

  const clipped = text.length > 8000 ? `${text.slice(0, 8000)}\n…（已截断）` : text;
  entry.resultPre.textContent = clipped;
  entry.status.className = `tool-status ${isError ? 'error' : 'done'}`;
  entry.status.textContent = isError ? '失败' : '完成';
  scrollToBottom();
}

function appendStats(message) {
  const parts = [];
  if (message.duration_ms) parts.push(`耗时 ${formatDuration(message.duration_ms)}`);
  if (typeof message.total_cost_usd === 'number') parts.push(`$${message.total_cost_usd.toFixed(4)}`);
  const usage = message.usage;
  if (usage && (usage.input_tokens || usage.output_tokens)) {
    const total = (usage.input_tokens || 0) + (usage.output_tokens || 0);
    if (total) parts.push(`${total.toLocaleString()} tokens`);
  }
  if (parts.length === 0) return;
  const el = document.createElement('div');
  el.className = 'msg assistant turn-stats';
  el.textContent = parts.join(' · ');
  appendEl(el);
}

function appendNotice(text) {
  const el = document.createElement('div');
  el.className = 'msg assistant turn-stats';
  el.textContent = text;
  appendEl(el);
}

/* ---------------- 流式输出 ---------------- */

function startStreaming() {
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  const md = document.createElement('div');
  md.className = 'markdown preview';
  wrap.appendChild(md);
  appendEl(wrap);
  state.streamEl = md;
}

function handleStreamEvent(message) {
  const event = message.event;
  if (!event) return;
  if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
    if (message.parent_tool_use_id) return;
    startStreaming();
    return;
  }
  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
    if (!state.streamEl) return;
    state.streamEl.textContent += event.delta.text;
    scrollToBottom();
  }
}

function finishStreaming(text) {
  const el = state.streamEl;
  state.streamEl = null;
  if (!el) return false;
  el.classList.remove('preview');
  el.innerHTML = renderMarkdown(text);
  highlightCode(el);
  scrollToBottom();
  return true;
}

/* ---------------- SDK 消息 ---------------- */

function handleAssistant(message) {
  const blocks = message.message?.content ?? [];
  let usedStream = false;

  for (const block of blocks) {
    if (block.type === 'text') {
      if (!block.text) continue;
      if (!usedStream && state.streamEl) {
        finishStreaming(block.text);
        usedStream = true;
      } else {
        appendMarkdown(block.text);
      }
    } else if (block.type === 'thinking' && block.thinking) {
      appendThinking(block.thinking);
    } else if (block.type === 'tool_use') {
      appendToolUse(block);
    }
  }

  if (!usedStream && state.streamEl && !blocks.some((b) => b.type === 'text')) {
    state.streamEl.parentElement?.remove();
    state.streamEl = null;
  }
}

function handleUser(message) {
  const content = message.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      let text = '';
      if (typeof block.content === 'string') text = block.content;
      else if (Array.isArray(block.content)) {
        text = block.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
      }
      attachToolResult(block.tool_use_id, text, Boolean(block.is_error));
    }
  }
}

function handleResult(message) {
  clearInsertBadges();
  const interrupted = /interrupt|aborted/i.test(
    [message.result, ...(Array.isArray(message.errors) ? message.errors : [])].filter(Boolean).join(' ')
  );
  if (interrupted) {
    appendNotice('已停止生成');
  } else if (message.is_error && message.result) {
    showError(message.result);
  } else if (message.subtype !== 'success' && Array.isArray(message.errors) && message.errors.length) {
    showError(message.errors.join('\n'));
  }
  appendStats(message);
  setRunning(false);
}

function handleSystem(message) {
  if (message.subtype === 'init') {
    state.sessionId = message.session_id;
    state.sessionActive = true;
    els.sessionMeta.textContent = [message.model, message.claude_code_version].filter(Boolean).join(' · ');
    if (!els.sessionTitle.dataset.custom) {
      els.sessionTitle.textContent = '当前会话';
    }
    if (message.cwd) setCwd(message.cwd, false);
    if (Array.isArray(message.mcp_servers)) {
      state.mcpStatus = Object.fromEntries(message.mcp_servers.map((server) => [server.name, server.status]));
    }
    state.terminalCommands = new Set(message.terminal_slash_commands || []);
    if (state.commands.length === 0) {
      state.commands = (message.slash_commands || []).map((name) => ({ name, description: '' }));
    }
  } else if (message.subtype === 'permission_denied') {
    appendNotice(`已自动拒绝工具调用：${message.tool_name}`);
  } else if (message.subtype === 'local_command_output') {
    appendMarkdown(message.content || '');
  }
}

function handleEvent(message) {
  try {
    switch (message.type) {
      case 'system':
        handleSystem(message);
        break;
      case 'stream_event':
        handleStreamEvent(message);
        break;
      case 'assistant':
        handleAssistant(message);
        break;
      case 'user':
        handleUser(message);
        break;
      case 'result':
        handleResult(message);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('处理消息出错:', err, message);
  }
}

/* ---------------- 状态与界面 ---------------- */

function setRunning(running) {
  state.running = running;
  els.statusDot.className = `dot ${running ? 'running' : state.errorShown ? 'error' : 'idle'}`;
  els.stop.hidden = !running;
  els.send.disabled = false;
  els.send.textContent = running ? '插入' : '发送';
  els.input.placeholder = running
    ? 'Claude 正在工作，输入内容会插入当前任务…'
    : '给 Claude 发消息…';
}

function showError(text) {
  els.errorBar.hidden = false;
  els.errorBar.textContent = text;
  state.errorShown = true;
  els.statusDot.className = 'dot error';
}

function clearError() {
  els.errorBar.hidden = true;
  els.errorBar.textContent = '';
  state.errorShown = false;
}

function setCwd(dir, persist = true) {
  state.cwd = dir || '';
  els.settingsCwd.textContent = dir || '未选择';
  if (persist) {
    window.desk.saveSettings({ cwd: dir });
    refreshSessions();
  }
}

function applyAccent(key) {
  const accent = ACCENTS[key] || ACCENTS.claude;
  state.accent = ACCENTS[key] ? key : 'claude';
  const root = document.documentElement.style;
  root.setProperty('--accent', accent.color);
  root.setProperty('--accent-soft', accent.soft);
  root.setProperty('--accent-border', accent.border);
  renderAccentSwatches();
}

function renderAccentSwatches() {
  els.accentSwatches.innerHTML = '';
  for (const [key, accent] of Object.entries(ACCENTS)) {
    const swatch = document.createElement('button');
    swatch.className = `swatch${key === state.accent ? ' active' : ''}`;
    swatch.style.background = accent.color;
    swatch.title = key;
    swatch.addEventListener('click', () => {
      applyAccent(key);
      window.desk.saveSettings({ accent: state.accent });
    });
    els.accentSwatches.appendChild(swatch);
  }
}

function updateSessionTitle(title) {
  els.sessionTitle.textContent = title || '新会话';
  els.sessionTitle.dataset.custom = title ? '1' : '';
  document.title = title ? `${title} - ClaudeDesk` : 'ClaudeDesk';
}

function resetConversation() {
  els.messages.innerHTML = `
    <div class="welcome">
      <div class="welcome-mark">✳</div>
      <h1>ClaudeDesk</h1>
      <p>选择工作目录，然后直接在下面提问。Claude 可以读写文件、运行命令、搜索代码。</p>
      <div class="welcome-tips">
        <span>Enter 发送</span>
        <span>Shift + Enter 换行</span>
        <span>Esc 停止生成</span>
      </div>
    </div>`;
  state.streamEl = null;
  state.toolCards.clear();
  state.sessionId = null;
  state.sessionActive = false;
  state.currentQuestion = null;
  state.currentPlan = null;
  els.questionModal.hidden = true;
  els.planModal.hidden = true;
  hideSlashPalette();
  updateSessionTitle('');
  els.sessionMeta.textContent = '';
  setRunning(false);
  clearError();
}

/* ---------------- 会话操作 ---------------- */

async function refreshSessions() {
  const result = await window.desk.listSessions({});
  if (!result?.ok) return;
  state.sessions = result.sessions || [];
  renderSessionGroups();
  renderTrash();
}

function renderSessionGroups() {
  const groups = buildSessionGroups(state.sessions, state.settings.trash || [], state.cwd);
  els.sessionList.innerHTML = '';

  if (groups.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = '还没有会话';
    els.sessionList.appendChild(hint);
    return;
  }

  for (const group of groups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'session-group';

    const header = document.createElement('div');
    header.className = 'group-header';
    header.title = group.dir;

    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = group.name;

    const add = document.createElement('button');
    add.className = 'icon-button';
    add.textContent = '＋';
    add.title = '在此目录新建会话';
    add.addEventListener('click', () => createSessionInDir(group.dir));

    header.append(name, add);
    header.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      moveGroupToTrash(group);
    });
    groupEl.appendChild(header);

    if (group.sessions.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = '暂无会话';
      groupEl.appendChild(hint);
    }

    for (const session of group.sessions) {
      groupEl.appendChild(renderSessionItem(session));
    }

    els.sessionList.appendChild(groupEl);
  }
}

function renderSessionItem(session) {
  const item = document.createElement('div');
  item.className = 'session-item';
  item.dataset.sessionId = session.sessionId;
  if (session.sessionId === state.sessionId) item.classList.add('active');

  const main = document.createElement('button');
  main.className = 'session-main';

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = session.title || '未命名会话';

  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = [relativeTime(session.lastModified), session.gitBranch].filter(Boolean).join(' · ');

  main.append(title, sub);
  main.addEventListener('click', () => resumeSession(session));

  const trash = document.createElement('button');
  trash.className = 'session-trash';
  trash.textContent = '🗑';
  trash.title = '移到回收站';
  trash.addEventListener('click', (event) => {
    event.stopPropagation();
    moveToTrash(session);
  });

  item.append(main, trash);
  return item;
}

function addToTrash(sessions) {
  const trash = [...(state.settings.trash || [])];
  const existing = new Set(trash.map((item) => item.sessionId));
  let added = 0;

  for (const session of sessions) {
    if (existing.has(session.sessionId)) continue;
    trash.push({
      sessionId: session.sessionId,
      title: session.title,
      cwd: session.cwd,
      trashedAt: Date.now(),
    });
    existing.add(session.sessionId);
    added += 1;
  }

  if (added === 0) return false;
  state.settings.trash = trash;
  window.desk.saveSettings({ trash });
  return true;
}

function moveToTrash(session) {
  if (!addToTrash([session])) return;
  if (state.sessionId === session.sessionId) newSession();
  renderSessionGroups();
  renderTrash();
}

function moveGroupToTrash(group) {
  if (group.sessions.length === 0) return;
  const ok = window.confirm(`把「${group.name}」下的 ${group.sessions.length} 个会话全部移到回收站？`);
  if (!ok) return;
  if (!addToTrash(group.sessions)) return;
  if (group.sessions.some((session) => session.sessionId === state.sessionId)) newSession();
  renderSessionGroups();
  renderTrash();
}

function restoreFromTrash(sessionId) {
  state.settings.trash = (state.settings.trash || []).filter((item) => item.sessionId !== sessionId);
  window.desk.saveSettings({ trash: state.settings.trash });
  refreshSessions();
}

async function deleteForever(item) {
  if (!window.confirm(`彻底删除「${item.title || '未命名会话'}」？此操作不可恢复。`)) return;
  const result = await window.desk.deleteSession({ sessionId: item.sessionId, dir: item.cwd });
  if (!result?.ok) {
    showError(result?.error || '删除失败');
    return;
  }
  restoreFromTrash(item.sessionId);
}

function renderTrash() {
  const trash = state.settings.trash || [];
  els.trashCount.textContent = String(trash.length);
  els.trashList.innerHTML = '';

  if (trash.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = '回收站是空的';
    els.trashList.appendChild(hint);
    return;
  }

  for (const item of trash) {
    const row = document.createElement('div');
    row.className = 'trash-row';

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = item.title || '未命名会话';
    title.title = item.cwd || '';

    const restore = document.createElement('button');
    restore.textContent = '恢复';
    restore.addEventListener('click', () => restoreFromTrash(item.sessionId));

    const remove = document.createElement('button');
    remove.textContent = '删除';
    remove.addEventListener('click', () => deleteForever(item));

    row.append(title, restore, remove);
    els.trashList.appendChild(row);
  }
}

async function refreshMcp() {
  const result = await window.desk.listMcp();
  els.mcpList.innerHTML = '';

  if (!result?.ok) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = '读取 MCP 配置失败';
    els.mcpList.appendChild(hint);
    return;
  }

  if (result.servers.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = '没有配置 MCP 服务器';
    els.mcpList.appendChild(hint);
    return;
  }

  const labels = { connected: '已连接', pending: '连接中', failed: '连接失败' };

  for (const server of result.servers) {
    const row = document.createElement('div');
    row.className = 'mcp-item';

    const status = state.mcpStatus[server.name] || 'unknown';
    const dot = document.createElement('span');
    dot.className = `mcp-status${labels[status] ? ` ${status}` : ''}`;
    dot.title = labels[status] || '未启动（发消息后会自动连接）';

    const name = document.createElement('span');
    name.className = 'mcp-name';
    name.textContent = server.name;

    const scope = document.createElement('span');
    scope.className = 'mcp-scope';
    scope.textContent = server.scope === 'user' ? '用户' : '项目';

    const cmd = document.createElement('span');
    cmd.className = 'mcp-cmd';
    cmd.textContent = [server.command, ...server.args].filter(Boolean).join(' ');
    cmd.title = cmd.textContent;

    row.append(dot, name, scope, cmd);
    els.mcpList.appendChild(row);
  }
}

async function createSessionInDir(dir) {
  await window.desk.closeSession();
  resetConversation();
  setCwd(dir);
  els.input.focus();
}

async function newSession() {
  await window.desk.closeSession();
  resetConversation();
  els.input.focus();
  refreshSessions();
}

async function resumeSession(session) {
  await window.desk.closeSession();
  const dir = session.cwd || state.cwd;
  els.messages.innerHTML = '';
  state.toolCards.clear();
  state.streamEl = null;
  state.sessionId = session.sessionId;
  state.currentQuestion = null;
  state.currentPlan = null;
  els.questionModal.hidden = true;
  els.planModal.hidden = true;
  if (dir) setCwd(dir, true);
  updateSessionTitle(session.title);

  const history = await window.desk.getHistory({ sessionId: session.sessionId, dir });
  if (history?.ok && Array.isArray(history.messages)) {
    for (const item of history.messages) {
      const payload = { ...item, session_id: session.sessionId };
      if (item.type === 'user') {
        if (typeof item.message?.content === 'string') appendUserMessage(item.message.content);
        else handleUser(payload);
      } else if (item.type === 'assistant') {
        handleAssistant(payload);
      }
    }
  }

  const result = await window.desk.resumeSession({
    sessionId: session.sessionId,
    cwd: dir,
    model: state.model,
    permissionMode: state.permissionMode,
  });
  if (!result?.ok) showError(result?.error || '恢复会话失败');
  else state.sessionActive = true;
  scrollToBottom(true);
  refreshSessions();
}

/* ---------------- 权限弹窗 ---------------- */

function enqueuePermission(request) {
  state.permissionQueue.push(request);
  pumpPermission();
}

function pumpPermission() {
  if (state.currentPermission || state.permissionQueue.length === 0) return;
  const request = state.permissionQueue.shift();
  state.currentPermission = request;

  els.permTitle.textContent = request.title || `Claude 想要执行 ${request.toolName}`;
  els.permDetail.textContent = [request.displayName, request.description, request.decisionReason]
    .filter(Boolean)
    .join(' · ');
  els.permInput.textContent = JSON.stringify(request.input ?? {}, null, 2);
  els.permAllowSession.hidden = !request.canAlwaysAllow;
  els.permModal.hidden = false;
  els.permAllow.focus();
}

async function answerPermission(decision) {
  const request = state.currentPermission;
  if (!request) return;
  state.currentPermission = null;
  els.permModal.hidden = true;
  await window.desk.respondPermission(request.id, decision);
  pumpPermission();
}

/* ---------------- 提问弹窗 ---------------- */

function renderQuestionBlock(question, index) {
  const block = document.createElement('div');
  block.className = 'question-block';
  block.dataset.index = String(index);

  const header = document.createElement('div');
  header.className = 'q-header';
  header.textContent = question.header || `问题 ${index + 1}`;

  const text = document.createElement('div');
  text.className = 'q-text';
  text.textContent = question.question || '';

  block.append(header, text);

  const inputType = question.multiSelect ? 'checkbox' : 'radio';
  const name = `q-${index}`;

  for (const option of question.options || []) {
    const label = document.createElement('label');
    label.className = 'option';

    const input = document.createElement('input');
    input.type = inputType;
    input.name = name;
    input.value = option.label;

    const body = document.createElement('span');
    const optionLabel = document.createElement('span');
    optionLabel.className = 'opt-label';
    optionLabel.textContent = option.label;
    body.appendChild(optionLabel);

    if (option.description) {
      const desc = document.createElement('span');
      desc.className = 'opt-desc';
      desc.textContent = option.description;
      body.appendChild(desc);
    }
    if (option.preview) {
      const preview = document.createElement('span');
      preview.className = 'opt-preview';
      preview.textContent = option.preview;
      body.appendChild(preview);
    }

    label.append(input, body);
    block.appendChild(label);
  }

  const otherLabel = document.createElement('label');
  otherLabel.className = 'option';
  const otherInput = document.createElement('input');
  otherInput.type = inputType;
  otherInput.name = name;
  otherInput.value = '__other__';
  const otherBody = document.createElement('span');
  const otherText = document.createElement('span');
  otherText.className = 'opt-label';
  otherText.textContent = '其他';
  otherBody.appendChild(otherText);
  const freeText = document.createElement('input');
  freeText.type = 'text';
  freeText.className = 'other-input';
  freeText.placeholder = '输入你自己的答案';
  otherBody.appendChild(freeText);
  otherLabel.append(otherInput, otherBody);
  block.appendChild(otherLabel);

  freeText.addEventListener('focus', () => {
    otherInput.checked = true;
  });

  return block;
}

function showQuestion(request) {
  state.currentQuestion = request;
  els.questionList.innerHTML = '';
  (request.questions || []).forEach((question, index) => {
    els.questionList.appendChild(renderQuestionBlock(question, index));
  });
  els.questionModal.hidden = false;
  els.questionSubmit.focus();
}

function collectAnswers() {
  const answers = {};
  const blocks = els.questionList.querySelectorAll('.question-block');

  for (const block of blocks) {
    const index = Number(block.dataset.index);
    const question = state.currentQuestion?.questions?.[index];
    if (!question) continue;

    const checked = block.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked');
    const values = [];
    for (const input of checked) {
      if (input.value === '__other__') {
        const free = block.querySelector('.other-input');
        if (free && free.value.trim()) values.push(free.value.trim());
      } else {
        values.push(input.value);
      }
    }

    if (values.length > 0) answers[question.question] = values.join(', ');
  }

  return answers;
}

async function submitQuestion() {
  const request = state.currentQuestion;
  if (!request) return;
  const answers = collectAnswers();
  state.currentQuestion = null;
  els.questionModal.hidden = true;

  if (Object.keys(answers).length > 0) {
    await window.desk.respondQuestion(request.id, { answers });
  } else {
    await window.desk.respondQuestion(request.id, { response: '用户没有做出选择，请自行判断后继续。' });
  }
}

async function skipQuestion() {
  const request = state.currentQuestion;
  if (!request) return;
  state.currentQuestion = null;
  els.questionModal.hidden = true;
  await window.desk.respondQuestion(request.id, { response: '用户跳过了这些问题，请自行判断后继续。' });
}

/* ---------------- 计划审批 ---------------- */

function showPlan(request) {
  state.currentPlan = request;
  els.planBody.innerHTML = renderMarkdown(request.plan || '（计划内容为空）');
  highlightCode(els.planBody);
  els.planFeedbackWrap.hidden = true;
  els.planFeedback.value = '';
  els.planReject.textContent = '拒绝，继续修改';
  els.planModal.hidden = false;
  els.planApprove.focus();
}

async function respondPlan(decision) {
  const request = state.currentPlan;
  if (!request) return;

  const feedback = els.planFeedback.value.trim();
  state.currentPlan = null;
  els.planModal.hidden = true;
  els.planFeedbackWrap.hidden = true;
  els.planFeedback.value = '';
  els.planReject.textContent = '拒绝，继续修改';

  if (decision === 'approve') {
    state.permissionMode = 'default';
    els.modeSelect.value = 'default';
    window.desk.saveSettings({ permissionMode: 'default' });
  }

  await window.desk.respondPlan(request.id, decision, undefined, decision === 'reject' ? feedback : undefined);
  if (decision === 'approve' && state.sessionActive) window.desk.setPermissionMode('default');
}

/* ---------------- 斜杠命令 ---------------- */

function hideSlashPalette() {
  els.slashPalette.hidden = true;
  state.slashItems = [];
  state.slashIndex = 0;
}

function handleCommands(commands) {
  state.commands = Array.isArray(commands) ? commands : [];
}

function updateSlashPalette() {
  const value = els.input.value;
  if (!value.startsWith('/') || value.includes(' ') || state.commands.length === 0) {
    hideSlashPalette();
    return;
  }

  const token = value.slice(1).toLowerCase();
  const items = state.commands
    .filter((cmd) => !state.terminalCommands.has(cmd.name) && cmd.name.toLowerCase().startsWith(token))
    .slice(0, 8);
  if (items.length === 0) {
    hideSlashPalette();
    return;
  }

  state.slashItems = items;
  state.slashIndex = 0;
  els.slashPalette.innerHTML = '';

  items.forEach((cmd, index) => {
    const row = document.createElement('div');
    row.className = `slash-item${index === 0 ? ' active' : ''}`;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `/${cmd.name}`;
    row.appendChild(name);
    const description = COMMAND_ZH[cmd.name] || cmd.description;
    if (description) {
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = description;
      row.appendChild(desc);
    }
    row.addEventListener('mousedown', (event) => {
      event.preventDefault();
      applySlash(cmd.name);
    });
    els.slashPalette.appendChild(row);
  });

  els.slashPalette.hidden = false;
}

function moveSlash(delta) {
  if (els.slashPalette.hidden || state.slashItems.length === 0) return false;
  const count = state.slashItems.length;
  state.slashIndex = (state.slashIndex + delta + count) % count;
  [...els.slashPalette.children].forEach((row, index) => {
    row.classList.toggle('active', index === state.slashIndex);
  });
  return true;
}

function applySlash(command) {
  els.input.value = `/${command} `;
  hideSlashPalette();
  els.input.focus();
  autosize();
}

/* ---------------- 发送 ---------------- */

function autosize() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 220)}px`;
}

async function ensureSession() {
  if (state.sessionActive) return true;
  if (!state.cwd) {
    const picked = await window.desk.pickDirectory();
    if (!picked?.ok || !picked.path) {
      showError('请先选择工作目录');
      return false;
    }
    setCwd(picked.path);
  }
  clearError();
  const result = await window.desk.startSession({
    cwd: state.cwd,
    model: state.model,
    permissionMode: state.permissionMode,
  });
  if (!result?.ok) {
    showError(result?.error || '启动会话失败');
    return false;
  }
  state.sessionActive = true;
  return true;
}

async function sendMessage() {
  if (state.sending) return;
  const text = els.input.value.trim();
  if (!text) return;

  state.sending = true;
  try {
    clearError();
    const steer = state.running;
    const ready = await ensureSession();
    if (!ready) return;

    appendUserMessage(text, steer);
    els.input.value = '';
    autosize();
    hideSlashPalette();
    setRunning(true);

    const result = await window.desk.send(text, { steer });
    if (!result?.ok) {
      setRunning(false);
      showError(result?.error || '发送失败');
    }
  } finally {
    state.sending = false;
  }
}

async function stopCurrent() {
  await window.desk.interrupt();
  setRunning(false);
}

/* ---------------- 应用菜单 ---------------- */

function buildAppMenu() {
  els.appMenu.innerHTML = '';

  for (const menu of APP_MENU) {
    const wrap = document.createElement('div');
    wrap.className = 'menu-wrap';

    const button = document.createElement('button');
    button.className = 'menu-button';
    button.textContent = menu.label;

    const dropdown = document.createElement('div');
    dropdown.className = 'menu-dropdown';
    dropdown.hidden = true;

    for (const item of menu.items) {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'menu-sep';
        dropdown.appendChild(sep);
        continue;
      }

      const entry = document.createElement('button');
      entry.className = 'menu-item';
      const label = document.createElement('span');
      label.textContent = item.label;
      entry.appendChild(label);

      if (item.accel) {
        const accel = document.createElement('span');
        accel.className = 'accel';
        accel.textContent = item.accel;
        entry.appendChild(accel);
      }

      entry.addEventListener('click', (event) => {
        event.stopPropagation();
        closeAppMenu();
        runMenuAction(item.action);
      });
      dropdown.appendChild(entry);
    }

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = dropdown.hidden;
      closeAppMenu();
      if (willOpen) {
        dropdown.hidden = false;
        button.classList.add('open');
      }
    });

    wrap.append(button, dropdown);
    els.appMenu.appendChild(wrap);
  }
}

function closeAppMenu() {
  els.appMenu.querySelectorAll('.menu-dropdown').forEach((dropdown) => {
    dropdown.hidden = true;
  });
  els.appMenu.querySelectorAll('.menu-button').forEach((button) => {
    button.classList.remove('open');
  });
}

function runMenuAction(action) {
  if (action === 'new-session') {
    newSession();
  } else if (action === 'pick-directory') {
    pickDirectoryAndOpen();
  } else {
    window.desk.menuAction(action);
  }
}

async function pickDirectoryAndOpen() {
  const picked = await window.desk.pickDirectory();
  if (!picked?.ok || !picked.path) return;
  createSessionInDir(picked.path);
}

/* ---------------- 初始化 ---------------- */

async function init() {
  const initial = await window.desk.getState();
  if (initial?.ok) {
    state.settings = initial.settings || {};
    state.model = 'default';
    state.permissionMode = state.settings.permissionMode || 'default';
    els.modeSelect.value = state.permissionMode;
    applyAccent(state.settings.accent || 'claude');

    const fontSize = state.settings.fontSize || 14;
    els.fontSize.value = String(fontSize);
    els.fontSizeValue.textContent = String(fontSize);
    document.documentElement.style.setProperty('--base-font-size', `${fontSize}px`);

    els.settingsVersion.textContent = `ClaudeDesk ${initial.version}`;
    setCwd(state.settings.cwd || '', false);
    if (!state.cwd) {
      setCwd(initial.defaultCwd || '', false);
    }
    refreshSessions();
  }

  buildAppMenu();

  els.send.addEventListener('click', sendMessage);
  els.stop.addEventListener('click', stopCurrent);
  $('new-session').addEventListener('click', newSession);
  $('refresh-sessions').addEventListener('click', refreshSessions);
  els.addDirectory.addEventListener('click', pickDirectoryAndOpen);
  els.trashToggle.addEventListener('click', () => {
    els.trashList.hidden = !els.trashList.hidden;
    els.trashArrow.textContent = els.trashList.hidden ? '▸' : '▾';
  });

  els.input.addEventListener('input', () => {
    autosize();
    updateSlashPalette();
  });
  els.input.addEventListener('keydown', (event) => {
    if (!els.slashPalette.hidden) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSlash(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSlash(-1);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        applySlash(state.slashItems[state.slashIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideSlashPalette();
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.menu-wrap')) closeAppMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeAppMenu();
    if (!els.slashPalette.hidden) {
      hideSlashPalette();
    } else if (!els.questionModal.hidden) {
      skipQuestion();
    } else if (!els.permModal.hidden) {
      answerPermission('deny');
    } else if (state.running) {
      stopCurrent();
    }
  });

  els.permAllow.addEventListener('click', () => answerPermission('allow'));
  els.permAllowSession.addEventListener('click', () => answerPermission('allow-session'));
  els.permDeny.addEventListener('click', () => answerPermission('deny'));

  els.questionSubmit.addEventListener('click', submitQuestion);
  els.questionSkip.addEventListener('click', skipQuestion);
  els.planApprove.addEventListener('click', () => respondPlan('approve'));
  els.planReject.addEventListener('click', () => {
    if (els.planFeedbackWrap.hidden) {
      els.planFeedbackWrap.hidden = false;
      els.planReject.textContent = '拒绝并发送';
      els.planFeedback.focus();
      return;
    }
    respondPlan('reject');
  });
  els.planFeedback.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      respondPlan('reject');
    }
  });

  els.modeSelect.addEventListener('change', async () => {
    const mode = els.modeSelect.value;
    if (
      mode === 'bypassPermissions' &&
      !window.confirm('「全部放行」会让 Claude 无需确认即可执行任何命令和修改文件，确定开启吗？')
    ) {
      els.modeSelect.value = state.permissionMode;
      return;
    }
    state.permissionMode = mode;
    await window.desk.saveSettings({ permissionMode: mode });
    if (state.sessionActive) await window.desk.setPermissionMode(mode);
  });

  $('open-settings').addEventListener('click', () => {
    els.settingsModal.hidden = false;
    refreshMcp();
  });
  els.mcpRefresh.addEventListener('click', refreshMcp);
  $('settings-close').addEventListener('click', () => {
    els.settingsModal.hidden = true;
  });
  els.settingsModal.addEventListener('click', (event) => {
    if (event.target === els.settingsModal) els.settingsModal.hidden = true;
  });

  els.fontSize.addEventListener('input', () => {
    const value = Number(els.fontSize.value);
    els.fontSizeValue.textContent = String(value);
    document.documentElement.style.setProperty('--base-font-size', `${value}px`);
  });
  els.fontSize.addEventListener('change', () => {
    window.desk.saveSettings({ fontSize: Number(els.fontSize.value) });
  });

  window.desk.onEvent(handleEvent);
  window.desk.onState((payload) => {
    if (payload.status === 'starting') setRunning(true);
    if (payload.status === 'running') setRunning(true);
    if (payload.status === 'idle') setRunning(false);
    if (payload.sessionId) state.sessionId = payload.sessionId;
    if (payload.ended) state.sessionActive = false;
    if (payload.cwd && payload.cwd !== state.cwd) setCwd(payload.cwd, false);
  });
  window.desk.onPermission(enqueuePermission);
  window.desk.onQuestion(showQuestion);
  window.desk.onPlan(showPlan);
  window.desk.onCommands(handleCommands);
  window.desk.onError((payload) => {
    clearInsertBadges();
    setRunning(false);
    showError(payload?.message || '会话出错');
  });
  window.desk.onNewSession(newSession);
  window.desk.onPickDirectory(async () => {
    const picked = await window.desk.pickDirectory();
    if (picked?.ok && picked.path) {
      if (state.sessionActive) await newSession();
      setCwd(picked.path);
    }
  });

  els.input.focus();
  autosize();
}

init();
