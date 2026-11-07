import { marked } from 'marked';
import DOMPurify from 'dompurify';
import 'highlight.js/styles/github-dark.css';
import '@xterm/xterm/css/xterm.css';
import { buildSessionGroups } from './session-groups.js';
import { formatDuration, formatStallLabel } from './format.js';
import { createDraftStore } from './composer-drafts.js';

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

const state = {
  settings: {},
  sessions: [],
  cwd: '',
  accent: 'claude',
  model: 'default',
  permissionMode: 'default',
  sessionId: null,
  sessionActive: false,
  // 多会话：key 是后端会话标识，sessionId 是 SDK 会话标识
  activeKey: null,
  startedKeys: new Set(),
  closedKeys: new Set(),
  switchToken: 0,
  keyToSession: new Map(),
  sessionKeys: new Map(),
  sessionStatus: new Map(),
  keyTitles: new Map(),
  commandsByKey: new Map(),
  metaByKey: new Map(),
  mcpByKey: new Map(),
  modeByKey: new Map(),
  startingKeys: new Map(),
  sessionsRequest: 0,
  sessionsInFlight: null,
  sessionsFetchedAt: 0,
  historyCache: new Map(),
  historyView: null,
  renderTarget: null,
  compacting: false,
  lastStderrByKey: new Map(),
  running: false,
  sending: false,
  interruptRequested: false,
  attachments: [],
  streamEl: null,
  thinkingLive: [],
  activityStartedAt: 0,
  activityTimer: null,
  activityHideTimer: null,
  activityLabel: '',
  activityByKey: new Map(),
  lastEventAt: 0,
  awaitingUser: false,
  replaying: false,
  pendingEvents: [],
  toolCards: new Map(),
  permissionQueue: [],
  currentPermission: null,
  currentQuestion: null,
  questionQueue: [],
  pendingPlans: new Map(),
  planCards: new Map(),
  drafts: createDraftStore(),
  commands: [],
  terminalCommands: new Set(),
  slashItems: [],
  slashIndex: 0,
  mcpStatus: {},
  lastUserText: '',
  searchQuery: '',
  selectMode: false,
  selectedSessions: new Set(),
  terminalOpen: false,
  terminalCwd: '',
  terminal: null,
  terminalFit: null,
  terminalStarted: false,
  terminalStarting: false,
  terminalRestarting: false,
  findQuery: '',
  findMatches: [],
  findIndex: 0,
};

const $ = (id) => document.getElementById(id);

const els = {
  messages: $('messages'),
  activityBar: $('activity-bar'),
  activityLabel: $('activity-label'),
  activityTime: $('activity-time'),
  attachmentBar: $('attachment-bar'),
  attach: $('attach'),
  input: $('input'),
  send: $('send'),
  stop: $('stop'),
  errorBar: $('error-bar'),
  statusDot: $('status-dot'),
  sessionTitle: $('session-title'),
  sessionMeta: $('session-meta'),
  sessionList: $('session-list'),
  addDirectory: $('add-directory'),
  trashToggle: $('trash-toggle'),
  trashArrow: $('trash-arrow'),
  trashList: $('trash-list'),
  trashCount: $('trash-count'),
  permissionButton: $('permission-button'),
  permissionMenu: $('permission-menu'),
  permissionLabel: $('permission-label'),
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
  slashPalette: $('slash-palette'),
  settingsModal: $('settings-modal'),
  accentSwatches: $('accent-swatches'),
  fontSize: $('font-size'),
  fontSizeValue: $('font-size-value'),
  settingsCwd: $('settings-cwd'),
  settingsVersion: $('settings-version'),
  mcpList: $('mcp-list'),
  mcpRefresh: $('mcp-refresh'),
  sessionSearch: $('session-search'),
  multiToggle: $('multi-toggle'),
  batchBar: $('batch-bar'),
  batchCount: $('batch-count'),
  batchTrash: $('batch-trash'),
  batchCancel: $('batch-cancel'),
  findBar: $('find-bar'),
  findInput: $('find-input'),
  findCount: $('find-count'),
  findPrev: $('find-prev'),
  findNext: $('find-next'),
  findClose: $('find-close'),
  toggleTerminal: $('toggle-terminal'),
  terminalPanel: $('terminal-panel'),
  terminalCwd: $('terminal-cwd'),
  terminalView: $('terminal-view'),
  terminalRestart: $('terminal-restart'),
  terminalClear: $('terminal-clear'),
  terminalClose: $('terminal-close'),
};

/* ---------------- 工具函数 ---------------- */

const scriptLoads = new Map();

/** 按需加载拆分的本地脚本（终端、代码高亮），避免首屏解析大依赖。 */
function loadScriptOnce(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (scriptLoads.has(src)) return scriptLoads.get(src);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      if (window[globalName]) resolve(window[globalName]);
      else reject(new Error(`${src} 未初始化`));
    };
    script.onerror = () => reject(new Error(`${src} 加载失败`));
    document.head.appendChild(script);
  }).finally(() => scriptLoads.delete(src));

  scriptLoads.set(src, promise);
  return promise;
}

function renderMarkdown(text) {
  const html = marked.parse(text ?? '');
  return DOMPurify.sanitize(html);
}

function highlightCode(root) {
  const blocks = root.querySelectorAll('pre code');
  if (blocks.length === 0) return;

  const apply = (hljs) => {
    blocks.forEach((block) => {
      try {
        hljs.highlightElement(block);
      } catch {
        /* 忽略未知语言 */
      }
    });
  };

  if (window.__ClaudeDeskHljs) {
    apply(window.__ClaudeDeskHljs);
    return;
  }
  loadScriptOnce('highlight.bundle.js', '__ClaudeDeskHljs')
    .then(apply)
    .catch(() => {});
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
  // 回放历史时逐条滚动会触发大量布局计算，等整批渲染完再滚一次
  if (state.renderTarget || state.replaying) return;
  const el = els.messages;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  if (force || nearBottom) el.scrollTop = el.scrollHeight;
}

function removeWelcome() {
  const welcome = els.messages.querySelector('.welcome');
  if (welcome) welcome.remove();
}

function appendEl(el, force = false) {
  // 回放时先写进 DocumentFragment，整批插一次 DOM
  if (state.renderTarget) {
    state.renderTarget.appendChild(el);
    return el;
  }
  removeWelcome();
  els.messages.appendChild(el);
  scrollToBottom(force);
  return el;
}

/* ---------------- 消息渲染 ---------------- */

function attachmentDataUrl(attachment) {
  return attachment.url || `data:${attachment.mediaType};base64,${attachment.data}`;
}

function appendUserMessage(text, steer = false, uuid = '', attachments = []) {
  const wrap = document.createElement('div');
  wrap.className = 'msg user';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (text) bubble.textContent = text;
  if (attachments.length > 0) {
    const gallery = document.createElement('div');
    gallery.className = 'user-attachments';
    for (const attachment of attachments) {
      if (attachment.kind === 'image' && (attachment.data || attachment.url)) {
        const img = document.createElement('img');
        img.className = 'user-attachment-thumb';
        img.src = attachmentDataUrl(attachment);
        img.alt = attachment.name || '图片';
        gallery.appendChild(img);
      } else {
        const chip = document.createElement('span');
        chip.className = 'user-attachment-file';
        chip.textContent = `📄 ${attachment.name || attachment.path}`;
        chip.title = attachment.path || '';
        gallery.appendChild(chip);
      }
    }
    bubble.appendChild(gallery);
  }
  if (steer) {
    const badge = document.createElement('span');
    badge.className = 'bubble-badge';
    badge.textContent = '插入';
    bubble.appendChild(badge);
  }
  wrap.appendChild(bubble);
  if (uuid) addMessageActions(wrap, uuid);
  appendEl(wrap, true);
  return wrap;
}

/* ---------------- 附件 ---------------- */

const MAX_ATTACHMENTS = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderAttachments() {
  els.attachmentBar.innerHTML = '';
  els.attachmentBar.hidden = state.attachments.length === 0;

  for (const attachment of state.attachments) {
    const item = document.createElement('div');
    item.className = 'attachment-item';

    if (attachment.kind === 'image' && (attachment.data || attachment.url)) {
      const img = document.createElement('img');
      img.className = 'attachment-thumb';
      img.src = attachmentDataUrl(attachment);
      img.alt = attachment.name || '图片';
      item.appendChild(img);
    } else {
      const icon = document.createElement('span');
      icon.className = 'attachment-file-icon';
      icon.textContent = '📄';
      item.appendChild(icon);
    }

    const meta = document.createElement('span');
    meta.className = 'attachment-meta';
    const name = document.createElement('span');
    name.className = 'attachment-name';
    name.textContent = attachment.name || attachment.path || '附件';
    name.title = attachment.path || attachment.name || '';
    const size = document.createElement('span');
    size.className = 'attachment-size';
    size.textContent = formatFileSize(attachment.size);
    meta.append(name, size);

    const remove = document.createElement('button');
    remove.className = 'attachment-remove';
    remove.textContent = '×';
    remove.title = '移除附件';
    remove.addEventListener('click', () => {
      state.attachments = state.attachments.filter((entry) => entry.id !== attachment.id);
      renderAttachments();
    });

    item.append(meta, remove);
    els.attachmentBar.appendChild(item);
  }
}

function addAttachment(entry) {
  if (state.attachments.length >= MAX_ATTACHMENTS) {
    showError(`一次最多添加 ${MAX_ATTACHMENTS} 个附件`);
    return;
  }
  if (entry.kind === 'image' && (Number(entry.size) || 0) > MAX_IMAGE_BYTES) {
    showError('图片不能超过 5MB');
    return;
  }
  state.attachments.push({
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...entry,
  });
  renderAttachments();
}

async function addAttachmentPaths(paths) {
  const target = state.attachments;
  for (const filePath of paths || []) {
    if (state.attachments !== target) return;
    if (state.attachments.length >= MAX_ATTACHMENTS) {
      showError(`一次最多添加 ${MAX_ATTACHMENTS} 个附件`);
      return;
    }
    const result = await window.desk.describeFile(filePath);
    // 读取期间发送/切换了会话，附件数组已被替换，丢弃迟到结果
    if (state.attachments !== target) return;
    if (!result?.ok) {
      showError(result?.error || '读取文件失败');
      continue;
    }
    addAttachment(result);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function addAttachmentFiles(files) {
  const target = state.attachments;
  for (const file of files || []) {
    if (state.attachments !== target) return;
    if (state.attachments.length >= MAX_ATTACHMENTS) {
      showError(`一次最多添加 ${MAX_ATTACHMENTS} 个附件`);
      return;
    }
    if (file.type && file.type.startsWith('image/')) {
      if (!IMAGE_TYPES.has(file.type)) {
        showError('只支持 PNG、JPG、GIF、WebP 图片');
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        showError('图片不能超过 5MB');
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        if (state.attachments !== target) return;
        const comma = dataUrl.indexOf(',');
        addAttachment({
          kind: 'image',
          name: file.name || '图片',
          size: file.size,
          mediaType: file.type,
          data: comma >= 0 ? dataUrl.slice(comma + 1) : '',
        });
      } catch {
        showError('读取图片失败');
      }
      continue;
    }

    let filePath = '';
    try {
      filePath = window.desk.pathForFile(file);
    } catch {
      filePath = '';
    }
    if (filePath) await addAttachmentPaths([filePath]);
    else showError('无法获取文件路径，请点击附件按钮选择');
  }
}

async function pickAttachments() {
  const result = await window.desk.pickAttachments();
  if (result?.ok && Array.isArray(result.paths) && result.paths.length > 0) {
    await addAttachmentPaths(result.paths);
  }
}

function buildMessageContent(text, attachments) {
  const blocks = [];
  if (text) blocks.push({ type: 'text', text });
  for (const attachment of attachments) {
    if (attachment.kind === 'image' && attachment.data) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: attachment.mediaType, data: attachment.data },
      });
    }
  }
  const paths = attachments.filter((a) => a.kind === 'file' && a.path).map((a) => a.path);
  if (paths.length > 0) {
    blocks.push({
      type: 'text',
      text: `用户附加了以下文件，请使用 Read 工具读取：\n${paths.map((p) => `- ${p}`).join('\n')}`,
    });
  }
  return blocks;
}

/** 解析历史消息里的文本/图片/文件引用。 */
function parseUserContent(content) {
  if (typeof content === 'string') return { text: content, attachments: [] };

  const attachments = [];
  const textParts = [];
  for (const block of content || []) {
    if (block.type === 'text' && block.text) {
      const note = block.text.match(/^用户附加了以下文件，请使用 Read 工具读取：\n([\s\S]*)$/);
      if (note) {
        for (const line of note[1].split('\n')) {
          const match = line.match(/^-\s+(.+)$/);
          if (match) {
            const filePath = match[1].trim();
            attachments.push({
              kind: 'file',
              path: filePath,
              name: filePath.split(/[\\/]/).pop() || filePath,
            });
          }
        }
      } else {
        textParts.push(block.text);
      }
    } else if (block.type === 'image') {
      if (block.source?.type === 'base64') {
        attachments.push({
          kind: 'image',
          mediaType: block.source.media_type,
          data: block.source.data,
          name: '图片',
        });
      } else if (block.source?.type === 'url') {
        attachments.push({ kind: 'image', url: block.source.url, name: '图片' });
      }
    }
  }
  return { text: textParts.join('\n'), attachments };
}

function addMessageActions(wrap, uuid) {
  if (!uuid || wrap.querySelector('.msg-actions')) return;
  const actions = document.createElement('span');
  actions.className = 'msg-actions';

  const fork = document.createElement('button');
  fork.textContent = '分叉';
  fork.title = '从这条消息分叉出一个新会话';
  fork.addEventListener('click', () => forkFromMessage(uuid));

  const rewind = document.createElement('button');
  rewind.textContent = '回滚文件';
  rewind.title = '把文件恢复到这条消息时的状态';
  rewind.addEventListener('click', () => rewindFilesTo(uuid));

  actions.append(fork, rewind);
  wrap.prepend(actions);
}

async function forkFromMessage(uuid) {
  if (!state.sessionId) return;
  if (state.running || state.sending) {
    showError('请先停止当前回合再分叉');
    return;
  }
  if (!window.confirm('从这条消息分叉出一个新会话？原会话不会改变。')) return;

  const base = els.sessionTitle.textContent.trim() || 'Claude 会话';
  const title = `${base}（分叉）`;
  const result = await window.desk.forkSession({
    sessionId: state.sessionId,
    dir: state.cwd,
    upToMessageId: uuid,
    title,
  });
  if (!result?.ok) {
    showError(result?.error || '分叉失败');
    return;
  }

  await refreshSessions(true);
  await resumeSession({
    sessionId: result.sessionId,
    cwd: state.cwd,
    title,
    lastModified: Date.now(),
  });
}

async function rewindFilesTo(uuid) {
  if (state.running || state.sending) {
    showError('请先停止当前回合再回滚');
    return;
  }
  if (!window.confirm('把文件恢复到这条消息时的状态？对话记录不会被删除。')) return;

  const result = await window.desk.rewindFiles({ key: state.activeKey, userMessageId: uuid });
  if (!result?.ok) {
    showError(result?.error || '回滚失败');
    return;
  }

  const info = result.result || {};
  if (!info.canRewind) {
    showError(info.error || '这个会话没有可用于回滚的文件快照');
    return;
  }
  const files = Array.isArray(info.filesChanged) ? info.filesChanged.length : 0;
  appendNotice(
    `已回滚文件：${files} 个（+${info.insertions ?? 0} / -${info.deletions ?? 0}）`
  );
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

/** 思考计时用的简短耗时：不足 10 秒保留一位小数。 */
function formatElapsed(ms) {
  const seconds = Number(ms) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return '0 秒';
  return seconds < 10 ? `${seconds.toFixed(1)} 秒` : formatDuration(ms);
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

/** 思考开始时先插一个带计时的展开块，边想边显示。 */
function beginThinking(index) {
  setActivity('正在思考…');
  const details = document.createElement('details');
  details.className = 'thinking live';
  details.open = true;
  const summary = document.createElement('summary');
  const body = document.createElement('div');
  body.className = 'thinking-body';
  details.append(summary, body);

  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.appendChild(details);
  appendEl(wrap);

  const entry = {
    details,
    summary,
    body,
    index,
    startedAt: performance.now(),
    stoppedAt: 0,
    timer: null,
  };
  const tick = () => {
    const elapsed = (entry.stoppedAt || performance.now()) - entry.startedAt;
    summary.textContent = `思考中… ${formatElapsed(elapsed)}`;
  };
  tick();
  entry.timer = setInterval(tick, 200);
  state.thinkingLive.push(entry);
  return entry;
}

function stopThinkingTimer(entry) {
  if (!entry || entry.stoppedAt) return;
  if (entry.timer) {
    clearInterval(entry.timer);
    entry.timer = null;
  }
  entry.stoppedAt = performance.now();
  entry.details.classList.remove('live');
  entry.summary.textContent = `思考过程 · 用时 ${formatElapsed(entry.stoppedAt - entry.startedAt)}`;
}

function endThinking(index) {
  const live = state.thinkingLive.filter((entry) => !entry.stoppedAt);
  if (live.length === 0) return;
  // 只结束对应的那个内容块，避免把文字块的 stop 误算到思考上
  if (index == null) {
    stopThinkingTimer(live[live.length - 1]);
    return;
  }
  const entry = live.find((item) => item.index === index);
  if (entry) stopThinkingTimer(entry);
}

/** 完整消息到达后，用它替换刚才流式的思考块。 */
function claimThinking(text) {
  if (state.thinkingLive.length === 0) return false;
  const matched = state.thinkingLive.findIndex(
    (entry) => entry.body.textContent.trim() === text.trim()
  );
  // 文本对不上时取最后一条（消息按顺序到达），不要误取第一条
  const index = matched >= 0 ? matched : state.thinkingLive.length - 1;
  const [entry] = state.thinkingLive.splice(index, 1);
  if (!entry) return false;
  stopThinkingTimer(entry);
  entry.body.textContent = text;
  return true;
}

/** 一轮结束时收尾，避免计时器残留。 */
function flushThinking() {
  for (const entry of state.thinkingLive) {
    stopThinkingTimer(entry);
    if (!entry.body.textContent.trim()) entry.details.parentElement?.remove();
  }
  state.thinkingLive = [];
}

function appendToolUse(block) {
  if (block?.name === 'ExitPlanMode') return appendPlanToolCard(block);
  // 同一条 tool_use 重复到达时不重复建卡
  if (block.id && state.toolCards.has(block.id)) {
    return state.toolCards.get(block.id).card;
  }
  setActivity(`正在运行 ${block.name}…`);
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
  const planCard = Array.from(state.planCards.values()).find(
    (record) => record.toolUseId && record.toolUseId === toolUseId
  );
  if (planCard) {
    if (planCard.status === 'pending' || planCard.status === 'readonly') {
      planCard.statusEl.textContent = isError ? '已拒绝' : '已结束';
      planCard.statusEl.className = `plan-inline-status ${isError ? 'rejected' : 'readonly'}`;
      planCard.actions.hidden = true;
      planCard.feedbackWrap.hidden = true;
    }
    return;
  }

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
  if (state.running) setActivity('等待模型响应…');
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

function formatTokenCount(value) {
  const num = Number(value) || 0;
  if (num >= 10000) return `${(num / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  return num.toLocaleString('zh-CN');
}

/** 压缩提示：实时事件带 token 数；历史记录里 SDK 丢掉了这些元信息，只能提示发生过压缩。 */
function appendCompactNotice(meta) {
  const parts = [];
  if (!meta) {
    parts.push('上下文已压缩');
  } else {
    parts.push(`上下文已压缩（${meta.trigger === 'manual' ? '手动' : '自动'}）`);
    if (typeof meta.pre_tokens === 'number' && typeof meta.post_tokens === 'number') {
      parts.push(`${formatTokenCount(meta.pre_tokens)} → ${formatTokenCount(meta.post_tokens)} tokens`);
    }
    if (typeof meta.duration_ms === 'number' && meta.duration_ms > 0) {
      parts.push(`用时 ${formatDuration(meta.duration_ms)}`);
    }
  }
  const el = document.createElement('div');
  el.className = 'msg assistant turn-stats compact-notice';
  el.textContent = parts.join(' · ');
  appendEl(el);
}

/** 压缩摘要默认收起，展开后按 Markdown 排版，避免历史里出现一大段无格式文本。 */
function appendCompactSummary(text) {
  const content = text || '';
  const details = document.createElement('details');
  details.className = 'compact-summary';
  const summary = document.createElement('summary');
  summary.textContent = `上下文摘要（压缩）· 约 ${Math.max(
    1,
    Math.round(content.length / 1000)
  )} 千字`;
  const body = document.createElement('div');
  body.className = 'markdown compact-summary-body';
  body.innerHTML = renderMarkdown(content);
  highlightCode(body);
  details.append(summary, body);

  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.appendChild(details);
  appendEl(wrap);
}

/** 后台任务通知等内容很长，收进折叠块，避免历史里出现一大段纯文本。 */
function appendSystemNote(title, text) {
  const content = text || '';
  const details = document.createElement('details');
  details.className = 'system-note';
  const summary = document.createElement('summary');
  summary.textContent = `${title} · 约 ${Math.max(
    1,
    Math.round(content.length / 1000)
  )} 千字`;
  const body = document.createElement('pre');
  body.className = 'system-note-body';
  body.textContent = content;
  details.append(summary, body);

  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.appendChild(details);
  appendEl(wrap);
}

/* ---------------- 流式输出 ---------------- */

function startStreaming() {
  setActivity('正在回复…');
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
  // 子代理的思考不混进主对话
  const isSubagent = Boolean(message.parent_tool_use_id);
  if (event.type === 'content_block_start' && event.content_block?.type === 'thinking') {
    if (!isSubagent) beginThinking(event.index);
    return;
  }
  if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
    if (isSubagent) return;
    let entry = state.thinkingLive[state.thinkingLive.length - 1];
    if (!entry || entry.stoppedAt || (event.index != null && entry.index !== event.index)) {
      entry = beginThinking(event.index);
    }
    entry.body.textContent += event.delta.thinking || '';
    scrollToBottom();
    return;
  }
  if (event.type === 'content_block_stop') {
    if (!isSubagent) endThinking(event.index);
    return;
  }
  if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
    if (message.parent_tool_use_id) return;
    startStreaming();
    return;
  }
  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
    if (isSubagent || !state.streamEl) return;
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

function finalizeStream() {
  if (!state.streamEl) return;
  if (state.streamEl.textContent) {
    finishStreaming(state.streamEl.textContent);
  } else {
    state.streamEl.parentElement?.remove();
    state.streamEl = null;
  }
}

/* ---------------- SDK 消息 ---------------- */

function handleAssistant(message) {
  // 子代理的思考、文字和工具都不混进主对话
  if (message.parent_tool_use_id) return;
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
      const claimed = !message.parent_tool_use_id && claimThinking(block.thinking);
      if (!claimed) appendThinking(block.thinking);
    } else if (block.type === 'tool_use') {
      appendToolUse(block);
    }
  }

  if (!usedStream && state.streamEl && !blocks.some((b) => b.type === 'text')) {
    state.streamEl.parentElement?.remove();
    state.streamEl = null;
  }

  // 这条完整消息里没有思考块时，收尾残留的实时思考块，避免呼吸点一直亮
  if (!message.parent_tool_use_id && !blocks.some((b) => b.type === 'thinking' && b.thinking)) {
    flushThinking();
  }
}

function handleUser(message) {
  if (message.parent_tool_use_id) return;
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

function handleToolProgress(message) {
  const seconds = Number(message.elapsed_time_seconds) || 0;
  const entry = state.toolCards.get(message.tool_use_id);
  if (entry && !entry.hasResult) {
    entry.status.textContent = `运行中 · ${formatElapsed(seconds * 1000)}`;
  }
  if (state.running && !state.awaitingUser) {
    setActivity(`正在运行 ${message.tool_name || '工具'}…`, performance.now() - seconds * 1000);
  }
}

function handleResult(message) {
  flushThinking();
  finalizeStream();
  clearInsertBadges();
  state.awaitingUser = false;
  state.compacting = false;
  const interrupted = state.interruptRequested;
  state.interruptRequested = false;
  clearPrompts(state.activeKey);
  markUnfinishedTools();
  if (interrupted) {
    appendNotice('已停止生成');
  } else if (message.is_error && message.result) {
    showError(message.result);
  } else if (message.subtype !== 'success' && Array.isArray(message.errors) && message.errors.length) {
    showError(message.errors.join('\n'));
  }
  appendStats(message);
  setRunning(false);
  finishActivity(
    interrupted ? '已停止生成' : message.duration_ms
      ? `已完成 · 本轮用时 ${formatDuration(message.duration_ms)}`
      : '已完成',
    interrupted ? 'stopped' : 'done'
  );

  // 新会话的第一轮结束后它才会出现在历史列表里，这里补一次刷新
  if (state.sessionId && !state.sessions.some((item) => item.sessionId === state.sessionId)) {
    refreshSessions(true);
  }
}

function handleSystem(message) {
  if (message.subtype === 'init') {
    state.sessionId = message.session_id;
    state.sessionActive = true;
    const meta = { model: message.model, version: message.claude_code_version };
    if (state.activeKey) state.metaByKey.set(state.activeKey, meta);
    els.sessionMeta.textContent = [meta.model, meta.version].filter(Boolean).join(' · ');
    if (!els.sessionTitle.dataset.custom) {
      els.sessionTitle.textContent = '当前会话';
    }
    if (message.cwd) setCwd(message.cwd, false);
    if (Array.isArray(message.mcp_servers)) {
      const status = Object.fromEntries(
        message.mcp_servers.map((server) => [server.name, server.status])
      );
      state.mcpStatus = status;
      if (state.activeKey) state.mcpByKey.set(state.activeKey, status);
    }
    state.terminalCommands = new Set(message.terminal_slash_commands || []);
    const commands = (message.slash_commands || []).map((name) => ({ name, description: '' }));
    // 保证 /compact 一定能在斜杠面板里找到
    if (!commands.some((cmd) => cmd.name === 'compact')) {
      commands.push({ name: 'compact', description: '' });
    }
    if (state.activeKey) state.commandsByKey.set(state.activeKey, commands);
    if (state.commands.length === 0) state.commands = commands;
    // 新会话第一次 init 时还没进入历史列表，立刻刷新一次并高亮当前会话
    if (!state.sessions.some((session) => session.sessionId === message.session_id)) {
      refreshSessions(true);
    }
  } else if (message.subtype === 'permission_denied') {
    appendNotice(`已自动拒绝工具调用：${message.tool_name}`);
  } else if (message.subtype === 'status') {
    if (message.compact_result === 'failed') {
      state.compacting = false;
      showError(message.compact_error || '上下文压缩失败');
      finishActivity('上下文压缩失败', 'error');
    } else if (message.compact_result === 'success' && state.compacting) {
      state.compacting = false;
      finishActivity('上下文已压缩', 'done');
    } else if (message.status === 'compacting') {
      state.compacting = true;
      setActivity('正在压缩上下文…');
    }
  } else if (message.subtype === 'compact_boundary') {
    if (state.compacting) {
      state.compacting = false;
      finishActivity('上下文已压缩', 'done');
    }
    appendCompactNotice(message.compact_metadata || {});
  } else if (message.subtype === 'local_command_output') {
    appendMarkdown(message.content || '');
  }
}

/** 所有会话的事件都从这里进来：后台会话只更新状态灯，不渲染到当前对话。 */
function handleSessionEvent(key, message) {
  if (!key || !message || state.closedKeys.has(key)) return;
  // 会话有新内容后历史缓存就过期了，切回来时重新读取
  if (
    message.type === 'assistant' ||
    message.type === 'user' ||
    message.type === 'result' ||
    message.type === 'stream_event' ||
    (message.type === 'system' && message.subtype === 'compact_boundary')
  ) {
    dropHistory(message.session_id || state.keyToSession.get(key));
  }
  if (message.type === 'system' && message.subtype === 'init') {
    registerSessionKey(key, message.session_id);
    // 后台会话的 init 不会进入 handleSystem，这里也记录一份元信息
    state.metaByKey.set(key, {
      model: message.model,
      version: message.claude_code_version,
    });
    if (Array.isArray(message.mcp_servers)) {
      state.mcpByKey.set(
        key,
        Object.fromEntries(message.mcp_servers.map((server) => [server.name, server.status]))
      );
    }
  }
  updateSessionStatusFromEvent(key, message);
  if (key !== state.activeKey) {
    trackBackgroundActivity(key, message);
    return;
  }
  // 切回正在运行的会话时，历史还没画完，先排队
  if (state.replaying) {
    state.pendingEvents.push(message);
    return;
  }
  handleEvent(message);
}

function handleSessionState(key, payload) {
  if (state.closedKeys.has(key)) return;
  if (payload.sessionId) registerSessionKey(key, payload.sessionId);

  if (key !== state.activeKey) {
    if (payload.ended) {
      state.startedKeys.delete(key);
      state.activityByKey.delete(key);
      const status = state.sessionStatus.get(key);
      setSessionStatus(
        key,
        status === 'working' || status === 'waiting' || status === 'error' ? 'error' : null
      );
      clearPrompts(key);
    }
    return;
  }

  const wasRunning = state.running;
  if (payload.status === 'starting') setRunning(true);
  if (payload.status === 'running') setRunning(true);
  if (
    (payload.status === 'starting' || payload.status === 'running') &&
    !state.activityStartedAt &&
    !state.awaitingUser &&
    !hasPendingPlan(key)
  ) {
    // 没有经过 sendMessage 的启动（如恢复会话）也要有可见反馈
    setActivity('正在处理…');
  }
  if (payload.status === 'idle') {
    // 会话结束/报错时收尾，避免思考计时器一直跑
    flushThinking();
    setRunning(false);
    if (state.activityLabel === '正在停止…') {
      finishActivity('已停止生成', 'stopped');
    } else if (
      !state.awaitingUser &&
      ['正在启动会话…', '正在恢复会话…', '正在发送…', '正在处理…'].includes(
        state.activityLabel
      )
    ) {
      clearActivity();
    }
  }
  if (payload.sessionId) state.sessionId = payload.sessionId;
  if (payload.ended) {
    const hadTurn = wasRunning || state.activityStartedAt > 0;
    const stopping = state.activityLabel === '正在停止…';
    state.startedKeys.delete(key);
    state.activityByKey.delete(key);
    state.interruptRequested = false;
    if (hadTurn) {
      if (stopping) finishActivity('已停止生成', 'stopped');
      else handleUnexpectedEnd();
    }
    setSessionStatus(key, null);
    state.sessionActive = false;
    clearPrompts(key);
  }
  if (payload.cwd && payload.cwd !== state.cwd) setCwd(payload.cwd, false);
}

function handleSessionError(key, text) {
  if (state.closedKeys.has(key)) return;
  state.startedKeys.delete(key);
  state.activityByKey.delete(key);
  if (key !== state.activeKey) {
    setSessionStatus(key, 'error');
    clearPrompts(key);
    return;
  }
  flushThinking();
  finalizeStream();
  clearInsertBadges();
  clearPrompts(key);
  markUnfinishedTools();
  setSessionStatus(key, null);
  state.sessionActive = false;
  setRunning(false);
  finishActivity('任务出错', 'error');
  showError(text || '会话出错');
}

function handleEvent(message) {
  state.lastEventAt = Date.now();
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
      case 'tool_progress':
        handleToolProgress(message);
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

const ACTIVITY_HIDE_MS = 5_000;
const ACTIVITY_STATES = ['done', 'stopped', 'error'];

function clearActivityState() {
  els.activityBar.classList.remove(...ACTIVITY_STATES);
}

function updateActivityTime() {
  if (!state.activityStartedAt) return;
  const elapsed = performance.now() - state.activityStartedAt;
  els.activityTime.textContent = formatElapsed(elapsed);

  let label = state.activityLabel;
  if (!state.awaitingUser) {
    const idle = Date.now() - state.lastEventAt;
    let hint = formatStallLabel(idle);
    if (hint) {
      if (idle >= 120_000) {
        const raw = state.lastStderrByKey.get(state.activeKey) || '';
        const detail = raw.trim().split('\n').filter(Boolean).pop();
        if (detail) hint += ` · ${detail.slice(0, 120)}`;
      }
      label = hint;
    }
    // CLI 不发 tool_progress 时，也让运行中的工具卡有时间感
    if (state.running && state.activityLabel.startsWith('正在运行 ')) {
      const elapsedText = formatElapsed(elapsed);
      for (const entry of [...state.toolCards.values()].reverse()) {
        if (entry.hasResult) continue;
        entry.status.textContent = `运行中 · ${elapsedText}`;
        break;
      }
    }
  }
  els.activityLabel.textContent = label;
}

/** 显示当前正在做什么，并开始计时。 */
function setActivity(label, startedAt = performance.now()) {
  if (state.replaying || state.renderTarget) return;
  if (state.activityHideTimer) {
    clearTimeout(state.activityHideTimer);
    state.activityHideTimer = null;
  }
  state.activityLabel = label;
  state.activityStartedAt = startedAt;
  state.lastEventAt = Date.now();
  if (state.activeKey) state.activityByKey.set(state.activeKey, { label, startedAt });
  clearActivityState();
  els.activityBar.hidden = false;
  updateActivityTime();
  if (!state.activityTimer) state.activityTimer = setInterval(updateActivityTime, 200);
}

/** 本轮结束：显示最终结果，几秒后自动隐藏。kind: done / stopped / error */
function finishActivity(label, kind = 'done') {
  if (state.replaying || state.renderTarget) return;
  if (state.activityTimer) {
    clearInterval(state.activityTimer);
    state.activityTimer = null;
  }
  state.activityStartedAt = 0;
  state.activityLabel = label;
  if (state.activeKey) state.activityByKey.delete(state.activeKey);
  clearActivityState();
  els.activityBar.classList.add(kind);
  els.activityBar.hidden = false;
  els.activityLabel.textContent = label;
  els.activityTime.textContent = '';
  if (state.activityHideTimer) clearTimeout(state.activityHideTimer);
  state.activityHideTimer = setTimeout(() => {
    state.activityHideTimer = null;
    els.activityBar.hidden = true;
    clearActivityState();
  }, ACTIVITY_HIDE_MS);
}

function clearActivity() {
  if (state.activityTimer) {
    clearInterval(state.activityTimer);
    state.activityTimer = null;
  }
  if (state.activityHideTimer) {
    clearTimeout(state.activityHideTimer);
    state.activityHideTimer = null;
  }
  state.activityStartedAt = 0;
  state.activityLabel = '';
  els.activityBar.hidden = true;
  clearActivityState();
  els.activityLabel.textContent = '';
  els.activityTime.textContent = '';
}

/** 把还没拿到结果的工具卡片标成已中断。 */
function markUnfinishedTools() {
  for (const entry of state.toolCards.values()) {
    if (entry.hasResult) continue;
    entry.status.className = 'tool-status error';
    entry.status.textContent = '已中断';
  }
}

/** 会话没给出完成结果就结束了：提示用户，并标记未完成的工具。 */
function handleUnexpectedEnd() {
  finalizeStream();
  clearInsertBadges();
  finishActivity('本轮任务未完成', 'error');
  appendNotice('本轮任务未完成：会话已结束（没有收到完成结果）');
  markUnfinishedTools();
  const raw = state.lastStderrByKey.get(state.activeKey) || '';
  const detail = raw.trim().split('\n').filter(Boolean).pop();
  if (detail) showError(`会话异常结束：${detail.slice(0, 300)}`);
}

/* ---------------- 多会话状态 ---------------- */

function newSessionKey() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function registerSessionKey(key, sessionId) {
  if (!key || !sessionId || state.closedKeys.has(key)) return;
  state.keyToSession.set(key, sessionId);
  state.sessionKeys.set(sessionId, key);
  applySessionStatusToDom(sessionId);
  if (!state.sessions.some((session) => session.sessionId === sessionId)) refreshSessions(true);
}

function sessionTitleFor(key) {
  const sessionId = state.keyToSession.get(key);
  const session = state.sessions.find((item) => item.sessionId === sessionId);
  return session?.title || state.keyTitles.get(key) || '当前会话';
}

function setSessionStatus(key, status) {
  if (!key) return;
  if (status) state.sessionStatus.set(key, status);
  else state.sessionStatus.delete(key);
  const sessionId = state.keyToSession.get(key);
  if (sessionId) applySessionStatusToDom(sessionId);
}

function applySessionStatusToDom(sessionId) {
  const key = state.sessionKeys.get(sessionId);
  const status = key ? state.sessionStatus.get(key) : null;
  for (const item of els.sessionList.querySelectorAll('.session-item')) {
    if (item.dataset.sessionId !== sessionId) continue;
    const dot = item.querySelector('.session-status');
    if (dot) dot.className = `session-status${status ? ` ${status}` : ''}`;
  }
}

function updateSessionStatusFromEvent(key, message) {
  switch (message.type) {
    case 'assistant':
    case 'user':
    case 'stream_event':
    case 'tool_progress':
      // 正在等用户审批计划时，后续消息不能把状态灯从 waiting 翻回 working
      if (!hasPendingPlan(key)) setSessionStatus(key, 'working');
      break;
    case 'result': {
      state.activityByKey.delete(key);
      if (key === state.activeKey && state.interruptRequested) {
        setSessionStatus(key, null);
      } else if (message.is_error || message.subtype !== 'success') {
        setSessionStatus(key, key === state.activeKey ? null : 'error');
      } else {
        setSessionStatus(key, key === state.activeKey ? null : 'done');
      }
      // 新会话第一次跑完后才会出现在会话列表里，后台会话也要补一次刷新
      const sessionId = state.keyToSession.get(key);
      if (sessionId && !state.sessions.some((item) => item.sessionId === sessionId)) {
        refreshSessions(true);
      }
      break;
    }
    default:
      break;
  }
}

/** 后台会话不渲染，但要记录它当前的动作用于切换回来时恢复计时。 */
function trackBackgroundActivity(key, message) {
  if (message.parent_tool_use_id) return;
  if (hasPendingPlan(key)) {
    rememberActivity(key, '等待你审批计划…');
    return;
  }
  if (message.type === 'stream_event') {
    const event = message.event;
    if (event?.type === 'content_block_start') {
      if (event.content_block?.type === 'thinking') rememberActivity(key, '正在思考…');
      else if (event.content_block?.type === 'text') rememberActivity(key, '正在回复…');
    }
    return;
  }
  if (message.type === 'assistant') {
    const blocks = message.message?.content || [];
    const tool = blocks.filter((block) => block.type === 'tool_use').pop();
    if (tool) rememberActivity(key, `正在运行 ${tool.name}…`);
    return;
  }
  if (message.type === 'user') {
    rememberActivity(key, '等待模型响应…');
    return;
  }
  if (message.type === 'tool_progress') {
    const seconds = Number(message.elapsed_time_seconds) || 0;
    rememberActivity(
      key,
      `正在运行 ${message.tool_name || '工具'}…`,
      performance.now() - seconds * 1000
    );
  }
}

function rememberActivity(key, label, startedAt = performance.now()) {
  if (!key) return;
  state.activityByKey.set(key, { label, startedAt });
}

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

function setCwd(dir, persist = true, refresh = persist) {
  const changed = (dir || '') !== state.cwd;
  state.cwd = dir || '';
  els.settingsCwd.textContent = dir || '未选择';
  if (!state.terminalStarted) state.terminalCwd = state.cwd;
  updateTerminalCwd();
  if (persist && changed) window.desk.saveSettings({ cwd: dir });
  if (refresh) refreshSessions(true);
}

/* ---------------- 权限模式 ---------------- */

const PERMISSION_MODES = [
  { value: 'plan', label: '计划模式', desc: '开启计划模式' },
  { value: 'default', label: '请求批准', desc: '编辑外部文件和使用互联网时始终询问' },
  { value: 'auto', label: '替我审批', desc: '仅对检测到的风险操作请求批准' },
  {
    value: 'bypassPermissions',
    label: '完全访问权限',
    desc: '可不受限制地访问互联网和您电脑上的任何文件',
  },
];

function permissionModeInfo(mode) {
  return PERMISSION_MODES.find((item) => item.value === mode) || PERMISSION_MODES[1];
}

function renderPermissionMode(mode) {
  const info = permissionModeInfo(mode);
  els.permissionLabel.textContent = info.label;
  for (const option of els.permissionMenu.querySelectorAll('.permission-option')) {
    option.classList.toggle('selected', option.dataset.mode === info.value);
  }
}

function setPermissionModeUI(mode) {
  const info = permissionModeInfo(mode);
  state.permissionMode = info.value;
  renderPermissionMode(info.value);
  return info.value;
}

async function changePermissionMode(mode) {
  if (
    mode === 'bypassPermissions' &&
    !window.confirm('「完全访问权限」会让 Claude 无需确认即可访问互联网和电脑上的任何文件，确定开启吗？')
  ) {
    return;
  }
  const selected = setPermissionModeUI(mode);
  if (state.activeKey) state.modeByKey.set(state.activeKey, selected);
  els.permissionMenu.hidden = true;
  await window.desk.saveSettings({ permissionMode: selected });
  if (state.sessionActive) {
    const result = await window.desk.setPermissionMode({ key: state.activeKey, mode: selected });
    if (!result?.ok) showError(result?.error || '切换权限模式失败');
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
  saveDraft(state.activeKey);
  state.switchToken += 1;
  state.interruptRequested = false;
  if (!els.findBar.hidden) closeFindBar();
  flushThinking();
  els.messages.innerHTML = `
    <div class="welcome">
      <div class="welcome-mark">✳</div>
      <h1>ClaudeDesk</h1>
      <p>选择工作目录，然后直接在下面提问。Claude 可以读写文件、运行命令、搜索代码。</p>
      <div class="welcome-tips">
        <span>Enter 发送</span>
        <span>Shift + Enter 换行</span>
        <span>Esc 停止生成</span>
        <span>Ctrl / Cmd + F 查找</span>
        <span>Ctrl / Cmd + Alt + Space 快速提问</span>
      </div>
    </div>`;
  state.streamEl = null;
  state.toolCards.clear();
  state.planCards.clear();
  state.sessionId = null;
  state.sessionActive = false;
  state.activeKey = null;
  state.awaitingUser = false;
  state.replaying = false;
  state.pendingEvents = [];
  state.historyView = null;
  state.renderTarget = null;
  state.compacting = false;
  state.commands = [];
  state.attachments = [];
  state.mcpStatus = {};
  els.input.value = '';
  renderPermissionMode(state.permissionMode);
  renderAttachments();
  autosize();
  clearActivity();
  hideSlashPalette();
  updateSessionTitle('');
  els.sessionMeta.textContent = '';
  setRunning(false);
  clearError();
}

/* ---------------- 会话操作 ---------------- */

const SESSIONS_CACHE_MS = 1500;

async function refreshSessions(force = false) {
  // 一次切换会触发多次刷新，合并成同一个请求，短时间内直接复用结果
  if (!force) {
    if (state.sessionsInFlight) return state.sessionsInFlight;
    if (Date.now() - state.sessionsFetchedAt < SESSIONS_CACHE_MS) return;
  }
  const token = ++state.sessionsRequest;
  const promise = (async () => {
    const result = await window.desk.listSessions({});
    // 后台会话会并发触发刷新，只采用最后一次请求的结果
    if (token !== state.sessionsRequest) return;
    if (!result?.ok) return;
    state.sessionsFetchedAt = Date.now();
    const titles = state.settings.sessionTitles || {};
    state.sessions = (result.sessions || []).map((session) => ({
      ...session,
      title: titles[session.sessionId] || session.title,
    }));
    renderSessionGroups();
    renderTrash();

    const current = state.sessions.find((session) => session.sessionId === state.sessionId);
    if (current?.title && !els.sessionTitle.dataset.custom) {
      els.sessionTitle.textContent = current.title;
    }
  })();
  if (!force) state.sessionsInFlight = promise;
  try {
    await promise;
  } finally {
    if (state.sessionsInFlight === promise) state.sessionsInFlight = null;
  }
}

function renderSessionGroups() {
  const groups = buildSessionGroups(state.sessions, state.settings.trash || [], state.cwd, {
    pinned: state.settings.pinned || [],
    query: state.searchQuery,
  });
  els.sessionList.innerHTML = '';

  if (groups.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = state.searchQuery ? '没有匹配的会话' : '还没有会话';
    els.sessionList.appendChild(hint);
    return;
  }

  for (const group of groups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'session-group';

    const header = document.createElement('div');
    header.className = 'group-header';
    header.title = group.dir || '置顶的会话';

    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = group.name;

    header.append(name);

    if (!group.pinned) {
      const add = document.createElement('button');
      add.className = 'icon-button';
      add.textContent = '＋';
      add.title = '在此目录新建会话';
      add.addEventListener('click', () => createSessionInDir(group.dir));
      header.appendChild(add);

      header.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        moveGroupToTrash(group);
      });
    }

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
  if (state.selectMode) item.classList.add('selecting');

  if (state.selectMode) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'session-select';
    checkbox.checked = state.selectedSessions.has(session.sessionId);
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', () => toggleSelected(session.sessionId));
    item.appendChild(checkbox);
  }

  const main = document.createElement('button');
  main.className = 'session-main';

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = session.title || '未命名会话';

  const titleRow = document.createElement('span');
  titleRow.className = 'session-title-row';
  const statusDot = document.createElement('span');
  statusDot.className = 'session-status';
  const sessionKey = state.sessionKeys.get(session.sessionId);
  const sessionStatus = sessionKey ? state.sessionStatus.get(sessionKey) : null;
  if (sessionStatus) statusDot.classList.add(sessionStatus);
  titleRow.append(title, statusDot);

  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = [relativeTime(session.lastModified), session.gitBranch].filter(Boolean).join(' · ');

  main.append(titleRow, sub);
  main.addEventListener('click', () => {
    if (state.selectMode) {
      toggleSelected(session.sessionId);
      renderSessionGroups();
      return;
    }
    resumeSession(session);
  });

  item.appendChild(main);

  if (state.selectMode) return item;

  const pinned = (state.settings.pinned || []).includes(session.sessionId);

  const pin = document.createElement('button');
  pin.className = `session-action${pinned ? ' pinned' : ''}`;
  pin.textContent = pinned ? '★' : '☆';
  pin.title = pinned ? '取消置顶' : '置顶会话';
  pin.addEventListener('click', (event) => {
    event.stopPropagation();
    togglePin(session);
  });

  const rename = document.createElement('button');
  rename.className = 'session-action';
  rename.textContent = '✎';
  rename.title = '重命名会话';
  rename.addEventListener('click', (event) => {
    event.stopPropagation();
    startRename(session, item);
  });

  const exportButton = document.createElement('button');
  exportButton.className = 'session-action';
  exportButton.textContent = '⇩';
  exportButton.title = '导出为 Markdown';
  exportButton.addEventListener('click', (event) => {
    event.stopPropagation();
    exportSession(session);
  });

  const trash = document.createElement('button');
  trash.className = 'session-trash';
  trash.textContent = '🗑';
  trash.title = '移到回收站';
  trash.addEventListener('click', (event) => {
    event.stopPropagation();
    moveToTrash(session);
  });

  item.append(pin, rename, exportButton, trash);
  return item;
}

function togglePin(session) {
  const pinned = new Set(state.settings.pinned || []);
  if (pinned.has(session.sessionId)) pinned.delete(session.sessionId);
  else pinned.add(session.sessionId);
  state.settings.pinned = [...pinned];
  window.desk.saveSettings({ pinned: state.settings.pinned });
  renderSessionGroups();
}

function startRename(session, item) {
  const titleEl = item.querySelector('.title');
  if (!titleEl) return;

  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = session.title || '';
  titleEl.replaceWith(input);
  input.addEventListener('mousedown', (event) => event.stopPropagation());
  input.addEventListener('click', (event) => event.stopPropagation());
  input.focus();
  input.select();

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (save && value) {
      const titles = { ...(state.settings.sessionTitles || {}) };
      titles[session.sessionId] = value;
      state.settings.sessionTitles = titles;
      window.desk.saveSettings({ sessionTitles: titles });
      session.title = value;
      if (session.sessionId === state.sessionId) updateSessionTitle(value);
    }
    renderSessionGroups();
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

function toggleSelected(sessionId) {
  if (state.selectedSessions.has(sessionId)) state.selectedSessions.delete(sessionId);
  else state.selectedSessions.add(sessionId);
  updateBatchBar();
}

function updateBatchBar() {
  els.batchCount.textContent = `已选 ${state.selectedSessions.size} 个`;
  els.batchTrash.disabled = state.selectedSessions.size === 0;
}

function toggleSelectMode(force) {
  state.selectMode = force ?? !state.selectMode;
  state.selectedSessions.clear();
  els.multiToggle.textContent = state.selectMode ? '完成' : '多选';
  els.batchBar.hidden = !state.selectMode;
  updateBatchBar();
  renderSessionGroups();
}

function batchMoveToTrash() {
  const sessions = state.sessions.filter((session) => state.selectedSessions.has(session.sessionId));
  if (sessions.length === 0) return;
  if (!window.confirm(`把选中的 ${sessions.length} 个会话移到回收站？`)) return;
  if (!addToTrash(sessions)) return;
  for (const session of sessions) closeSessionBackend(session.sessionId);
  if (sessions.some((session) => session.sessionId === state.sessionId)) newSession();
  toggleSelectMode(false);
  renderTrash();
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
  closeSessionBackend(session.sessionId);
  if (state.sessionId === session.sessionId) newSession();
  renderSessionGroups();
  renderTrash();
}

function moveGroupToTrash(group) {
  if (group.sessions.length === 0) return;
  const ok = window.confirm(`把「${group.name}」下的 ${group.sessions.length} 个会话全部移到回收站？`);
  if (!ok) return;
  if (!addToTrash(group.sessions)) return;
  for (const session of group.sessions) closeSessionBackend(session.sessionId);
  if (group.sessions.some((session) => session.sessionId === state.sessionId)) newSession();
  renderSessionGroups();
  renderTrash();
}

function restoreFromTrash(sessionId) {
  state.settings.trash = (state.settings.trash || []).filter((item) => item.sessionId !== sessionId);
  window.desk.saveSettings({ trash: state.settings.trash });
  refreshSessions(true);
}

async function deleteForever(item) {
  if (!window.confirm(`彻底删除「${item.title || '未命名会话'}」？此操作不可恢复。`)) return;
  await closeSessionBackend(item.sessionId);
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

function historyToMarkdown(session, messages) {
  const lines = [
    `# ${session.title || 'Claude 会话'}`,
    '',
    `> 工作目录：${session.cwd || '未知'}`,
    `> 导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
  ];

  for (const item of messages) {
    const content = item?.message?.content;
    if (item.type === 'user') {
      const texts =
        typeof content === 'string'
          ? [content]
          : Array.isArray(content)
            ? content.filter((block) => block.type === 'text').map((block) => block.text)
            : [];
      for (const text of texts) {
        if (text && text.trim()) lines.push('## 我', '', text.trim(), '');
      }
    } else if (item.type === 'assistant') {
      const blocks = Array.isArray(content) ? content : [];
      for (const block of blocks) {
        if (block.type === 'text' && block.text?.trim()) {
          lines.push('## Claude', '', block.text.trim(), '');
        } else if (block.type === 'thinking' && block.thinking?.trim()) {
          lines.push(
            '<details><summary>思考过程</summary>',
            '',
            block.thinking.trim(),
            '',
            '</details>',
            ''
          );
        } else if (block.type === 'tool_use') {
          lines.push(
            `**调用工具 \`${block.name}\`**`,
            '',
            '```json',
            JSON.stringify(block.input ?? {}, null, 2),
            '```',
            ''
          );
        }
      }
    }
  }

  return lines.join('\n');
}

async function exportSession(session) {
  const result = await window.desk.getHistory({ sessionId: session.sessionId, dir: session.cwd });
  if (!result?.ok) {
    showError(result?.error || '读取会话失败');
    return;
  }

  const content = historyToMarkdown(session, result.messages || []);
  const safeName = String(session.title || 'claude-session')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 60);
  const saved = await window.desk.saveText({ defaultPath: `${safeName}.md`, content });
  if (!saved?.ok) showError(saved?.error || '导出失败');
  else if (saved.path) appendNotice(`已导出到 ${saved.path}`);
}

function exportCurrentSession() {
  if (!state.sessionId) {
    showError('当前没有可导出的会话');
    return;
  }
  const current = state.sessions.find((session) => session.sessionId === state.sessionId);
  exportSession(
    current || {
      sessionId: state.sessionId,
      cwd: state.cwd,
      title: els.sessionTitle.textContent,
    }
  );
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
  resetConversation();
  setCwd(dir);
  els.input.focus();
}

async function newSession() {
  resetConversation();
  els.input.focus();
  refreshSessions();
}

/** 关闭某个会话的后端进程（删除/移入回收站时用）。 */
async function closeSessionBackend(sessionId) {
  if (!sessionId) return;
  // 恢复中的会话可能还没走到 init，映射还没建立，用 sessionId 兜底
  const key = state.sessionKeys.get(sessionId) || sessionId;
  state.closedKeys.add(key);
  state.startedKeys.delete(key);
  state.sessionStatus.delete(key);
  state.sessionKeys.delete(sessionId);
  state.keyToSession.delete(key);
  state.keyTitles.delete(key);
  state.commandsByKey.delete(key);
  state.metaByKey.delete(key);
  state.mcpByKey.delete(key);
  state.modeByKey.delete(key);
  state.lastStderrByKey.delete(key);
  state.activityByKey.delete(key);
  dropHistory(sessionId);
  dropDraft(key);
  clearPrompts(key);
  if (state.activeKey === key) {
    state.activeKey = null;
    state.sessionActive = false;
    setRunning(false);
  }
  await window.desk.closeSession({ key });
}

const HISTORY_PAGE = 50;
const HISTORY_CACHE_MAX = 5;

function cacheHistory(sessionId, messages) {
  if (!sessionId) return;
  // 重新插入一次，维持 Map 的 LRU 顺序
  state.historyCache.delete(sessionId);
  state.historyCache.set(sessionId, messages);
  while (state.historyCache.size > HISTORY_CACHE_MAX) {
    state.historyCache.delete(state.historyCache.keys().next().value);
  }
}

function dropHistory(sessionId) {
  if (sessionId) state.historyCache.delete(sessionId);
}

/** 是否是一轮对话的开头（用户文字消息，而不是工具结果）。 */
function isUserTurnStart(item) {
  if (!item || item.type !== 'user' || item.parent_tool_use_id) return false;
  const content = item.message?.content;
  if (!Array.isArray(content)) return true;
  return content.some((block) => block?.type !== 'tool_result');
}

/** 从目标位置往回找，尽量从完整的一轮开始显示；回退距离有上限，避免长回合把整个历史都画出来。 */
function historyStartIndex(messages, wanted) {
  const floor = Math.max(0, wanted - Math.floor(HISTORY_PAGE / 2));
  let index = Math.max(0, Math.min(wanted, messages.length));
  while (index > floor && index < messages.length && !isUserTurnStart(messages[index])) {
    index--;
  }
  return index;
}

function renderHistoryRange(messages, sessionId, from, to, renderedUuids) {
  for (let i = from; i < to; i += 1) {
    const item = messages[i];
    if (!item) continue;
    if (item.type === 'system') {
      // 历史里的系统消息目前只会是压缩边界，SDK 没有保留 subtype 和 token 数
      appendCompactNotice(null);
      continue;
    }
    if (item.parent_tool_use_id) continue;
    if (item.uuid && renderedUuids) renderedUuids.add(item.uuid);

    // 后台任务通知通常是一大段 XML 文本，收进折叠块
    if (item.type === 'user' && item.origin?.kind === 'task-notification') {
      const content = item.message?.content;
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .filter((block) => block?.type === 'text')
                .map((block) => block.text)
                .join('\n')
            : '';
      if (text) appendSystemNote('后台任务通知', text);
      continue;
    }

    // 压缩摘要是一大段纯文本，收进可展开的摘要块，不再当普通用户消息渲染
    if (item.type === 'user' && item.isCompactSummary) {
      const content = item.message?.content;
      if (typeof content === 'string') {
        appendCompactSummary(content);
      } else if (Array.isArray(content)) {
        const text = content
          .filter((block) => block?.type === 'text')
          .map((block) => block.text)
          .join('\n');
        if (text) appendCompactSummary(text);
      }
      continue;
    }

    const payload = { ...item, session_id: sessionId };
    if (item.type === 'user') {
      const content = item.message?.content;
      if (typeof content === 'string') {
        appendUserMessage(content, false, item.uuid);
      } else if (Array.isArray(content)) {
        const parsed = parseUserContent(content);
        if (parsed.text || parsed.attachments.length > 0) {
          appendUserMessage(parsed.text, false, item.uuid, parsed.attachments);
        }
        handleUser(payload);
      } else {
        handleUser(payload);
      }
    } else if (item.type === 'assistant') {
      handleAssistant(payload);
    }
  }
}

function updateHistoryLoader() {
  const view = state.historyView;
  let loader = els.messages.querySelector('.history-loader');
  if (!view || view.start <= 0) {
    if (loader) loader.remove();
    return;
  }
  if (!loader) {
    loader = document.createElement('button');
    loader.className = 'history-loader';
    loader.addEventListener('click', loadEarlierHistory);
  }
  loader.textContent = `加载更早的 ${Math.min(HISTORY_PAGE, view.start)} 条`;
  els.messages.prepend(loader);
}

function loadEarlierHistory() {
  const view = state.historyView;
  if (!view || view.start <= 0) return;

  const from = historyStartIndex(view.messages, Math.max(0, view.start - HISTORY_PAGE));
  if (from >= view.start) return;

  const previousHeight = els.messages.scrollHeight;
  const fragment = document.createDocumentFragment();
  state.renderTarget = fragment;
  try {
    renderHistoryRange(view.messages, view.sessionId, from, view.start);
  } finally {
    state.renderTarget = null;
  }

  els.messages.insertBefore(fragment, els.messages.firstChild);
  view.start = from;
  // 插入后补回高度差，视口停在原来的位置
  els.messages.scrollTop += els.messages.scrollHeight - previousHeight;
  updateHistoryLoader();
}

function showSessionLoading() {
  const el = document.createElement('div');
  el.className = 'session-loading';
  el.textContent = '正在加载会话…';
  els.messages.appendChild(el);
}

/** 只渲染最近 HISTORY_PAGE 条，更早的通过顶部按钮按需追加。 */
function renderHistoryWindow(messages, sessionId, renderedUuids) {
  const start = historyStartIndex(messages, Math.max(0, messages.length - HISTORY_PAGE));
  const fragment = document.createDocumentFragment();
  state.renderTarget = fragment;
  try {
    renderHistoryRange(messages, sessionId, start, messages.length, renderedUuids);
  } finally {
    state.renderTarget = null;
  }
  els.messages.innerHTML = '';
  els.messages.appendChild(fragment);
  state.historyView = { sessionId, messages, start };
  updateHistoryLoader();
  // 先把视口放到最新消息，不用等后面的 SDK 恢复
  els.messages.scrollTop = els.messages.scrollHeight;
}

async function resumeSession(session) {
  const key = state.sessionKeys.get(session.sessionId) || session.sessionId;
  if (key === state.activeKey && session.sessionId === state.sessionId) {
    els.input.focus();
    return;
  }

  // 切走前保存旧会话草稿；先 touch 目标，避免随后保存时把目标淘汰
  state.drafts.get(key);
  saveDraft(state.activeKey);

  const token = ++state.switchToken;
  state.closedKeys.delete(key);
  state.interruptRequested = false;
  const dir = session.cwd || state.cwd;
  state.activeKey = key;
  state.sessionId = session.sessionId;
  state.sessionActive = state.startedKeys.has(key);
  state.keyTitles.set(key, session.title || state.keyTitles.get(key) || '当前会话');
  clearError();
  if (!els.findBar.hidden) closeFindBar();
  hideSlashPalette();

  const status = state.sessionStatus.get(key);
  const busy = status === 'working' || status === 'waiting';

  flushThinking();
  clearActivity();
  els.messages.innerHTML = '';
  state.historyView = null;
  state.toolCards.clear();
  state.planCards.clear();
  state.streamEl = null;
  state.commands = state.commandsByKey.get(key) || [];
  restoreDraft(key);
  if (status === 'done' || status === 'error') setSessionStatus(key, null);
  setRunning(busy);
  if (busy) {
    const activity = state.activityByKey.get(key);
    if (activity) setActivity(activity.label, activity.startedAt);
    else setActivity('正在工作…');
  }
  if (dir) setCwd(dir, true, false);
  updateSessionTitle(session.title);
  renderSessionGroups();

  // 恢复这个会话自己的模型/MCP 信息和权限模式
  const meta = state.metaByKey.get(key);
  els.sessionMeta.textContent = meta
    ? [meta.model, meta.version].filter(Boolean).join(' · ')
    : '';
  state.mcpStatus = state.mcpByKey.get(key) || {};
  renderPermissionMode(state.modeByKey.get(key) || state.permissionMode);

  state.pendingEvents = [];
  state.replaying = true;
  const renderedUuids = new Set();
  try {
    let messages = state.historyCache.get(session.sessionId);
    if (messages) {
      // 命中缓存，重新插入以保持 LRU 顺序
      cacheHistory(session.sessionId, messages);
    } else {
      showSessionLoading();
      const history = await window.desk.getHistory({ sessionId: session.sessionId, dir });
      // 快速连续切换时，只让最后一次切换渲染历史
      if (token !== state.switchToken) return;
      if (history && history.ok === false) {
        showError(history.error || '读取会话历史失败');
      }
      if (history?.ok && Array.isArray(history.messages)) {
        messages = history.messages;
        cacheHistory(session.sessionId, messages);
      } else {
        // 读取失败不缓存，下次切换时重试
        messages = [];
      }
    }

    renderHistoryWindow(messages, session.sessionId, renderedUuids);
    // 历史里最后一个工具调用没有结果，说明当时被中断了
    markUnfinishedTools();
  } finally {
    if (token === state.switchToken) {
      state.replaying = false;
      const pending = state.pendingEvents;
      state.pendingEvents = [];
      if (key === state.activeKey) {
        for (const message of pending) {
          if (
            message.uuid &&
            renderedUuids.has(message.uuid) &&
            (message.type === 'assistant' || message.type === 'user' || message.type === 'result')
          ) {
            continue;
          }
          handleEvent(message);
        }
      }
      // 切换过程中又收到了新内容，刚缓存的历史可能已经过期
      if (pending.length > 0) dropHistory(session.sessionId);
    }
  }

  if (token !== state.switchToken) return;

  applyPendingPlans(key);
  recalcAwaitingUser();
  if (hasPendingPlan(key)) setActivity('等待你审批计划…');

  if (state.startedKeys.has(key)) {
    const focus = await window.desk.focusSession({ key });
    // 后端已被空闲回收：清掉本地标记，下面会重新恢复
    if (focus && focus.attached === false) {
      state.startedKeys.delete(key);
      state.sessionActive = false;
    }
  }
  if (!state.startedKeys.has(key)) {
    if (!state.awaitingUser) setActivity('正在恢复会话…');
    const mode = state.modeByKey.get(key) || state.permissionMode;
    state.modeByKey.set(key, mode);
    const result = await beginSession(key, () =>
      window.desk.resumeSession({
        key,
        sessionId: session.sessionId,
        cwd: dir,
        model: state.model,
        permissionMode: mode,
      })
    );
    if (!result?.ok) {
      showError(result?.error || '恢复会话失败');
      if (state.activityLabel === '正在恢复会话…') finishActivity('恢复失败', 'error');
    } else {
      state.startedKeys.add(key);
      state.sessionActive = true;
      if (!state.awaitingUser && state.activityLabel === '正在恢复会话…') clearActivity();
    }
  }
  scrollToBottom(true);
  refreshSessions();
}

/* ---------------- 权限弹窗 ---------------- */

function clearPrompts(key) {
  state.permissionQueue = state.permissionQueue.filter((entry) => entry.key !== key);
  state.questionQueue = state.questionQueue.filter((request) => request.__key !== key);
  for (const [planKey, record] of [...state.pendingPlans]) {
    if (record.key === key) state.pendingPlans.delete(planKey);
  }
  for (const record of state.planCards.values()) {
    if (record.key === key) expirePlanCard(record);
  }
  if (state.currentPermission?.key === key) {
    state.currentPermission = null;
    els.permModal.hidden = true;
  }
  if (state.currentQuestion?.__key === key) {
    state.currentQuestion = null;
    els.questionModal.hidden = true;
  }
  recalcAwaitingUser();
  pumpPermission();
  pumpQuestions();
}

function enqueuePermission(key, request) {
  state.permissionQueue.push({ key, request });
  pumpPermission();
}

function pumpPermission() {
  if (state.currentPermission || state.permissionQueue.length === 0) return;
  const entry = state.permissionQueue.shift();
  state.currentPermission = entry;
  const { key, request } = entry;

  els.permTitle.textContent = `${sessionTitleFor(key)} · ${
    request.title || `Claude 想要执行 ${request.toolName}`
  }`;
  els.permDetail.textContent = [request.displayName, request.description, request.decisionReason]
    .filter(Boolean)
    .join(' · ');
  els.permInput.textContent = JSON.stringify(request.input ?? {}, null, 2);
  els.permAllowSession.hidden = !request.canAlwaysAllow;
  els.permModal.hidden = false;
  els.permDeny.focus();
  setSessionStatus(key, 'waiting');
  state.awaitingUser = true;
  if (key === state.activeKey) setActivity('等待你确认权限…');
  else rememberActivity(key, '等待你确认权限…');
}

async function answerPermission(decision) {
  const entry = state.currentPermission;
  if (!entry) return;
  state.currentPermission = null;
  els.permModal.hidden = true;
  const result = await window.desk.respondPermission({
    key: entry.key,
    id: entry.request.id,
    decision,
  });
  state.awaitingUser = false;
  if (!result?.ok) {
    setSessionStatus(entry.key, null);
    if (entry.key === state.activeKey) clearActivity();
    showError(result?.error || '响应权限请求失败');
  } else {
    setSessionStatus(entry.key, 'working');
    rememberActivity(entry.key, '等待模型响应…');
    if (entry.key === state.activeKey) setActivity('等待模型响应…');
  }
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

function setModalHeading(modal, base, key) {
  const heading = modal.querySelector('h3');
  if (!heading) return;
  heading.textContent = key === state.activeKey ? base : `「${sessionTitleFor(key)}」${base}`;
}

function showQuestion(key, request) {
  request.__key = key;
  state.questionQueue.push(request);
  pumpQuestions();
}

function pumpQuestions() {
  if (state.currentQuestion || state.questionQueue.length === 0) return;
  const request = state.questionQueue.shift();
  state.currentQuestion = request;
  const key = request.__key;

  els.questionList.innerHTML = '';
  (request.questions || []).forEach((question, index) => {
    els.questionList.appendChild(renderQuestionBlock(question, index));
  });
  setModalHeading(els.questionModal, 'Claude 想确认一下', key);
  els.questionModal.hidden = false;
  const firstOption = els.questionList.querySelector(
    'input[type="radio"], input[type="checkbox"]'
  );
  (firstOption || els.questionSkip).focus();
  setSessionStatus(key, 'waiting');
  state.awaitingUser = true;
  if (key === state.activeKey) setActivity('等待你回答问题…');
  else rememberActivity(key, '等待你回答问题…');
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
  const key = request.__key;
  const answers = collectAnswers();
  state.currentQuestion = null;
  els.questionModal.hidden = true;

  const result =
    Object.keys(answers).length > 0
      ? await window.desk.respondQuestion({ key, id: request.id, answers })
      : await window.desk.respondQuestion({
          key,
          id: request.id,
          response: '用户没有做出选择，请自行判断后继续。',
        });
  state.awaitingUser = false;
  if (!result?.ok) {
    setSessionStatus(key, null);
    if (key === state.activeKey) clearActivity();
    showError(result?.error || '提交回答失败');
  } else {
    setSessionStatus(key, 'working');
    rememberActivity(key, '等待模型响应…');
    if (key === state.activeKey) setActivity('等待模型响应…');
  }
  pumpQuestions();
}

async function skipQuestion() {
  const request = state.currentQuestion;
  if (!request) return;
  const key = request.__key;
  state.currentQuestion = null;
  els.questionModal.hidden = true;
  const result = await window.desk.respondQuestion({
    key,
    id: request.id,
    response: '用户跳过了这些问题，请自行判断后继续。',
  });
  state.awaitingUser = false;
  if (!result?.ok) {
    setSessionStatus(key, null);
    if (key === state.activeKey) clearActivity();
    showError(result?.error || '提交回答失败');
  } else {
    setSessionStatus(key, 'working');
    rememberActivity(key, '等待模型响应…');
    if (key === state.activeKey) setActivity('等待模型响应…');
  }
  pumpQuestions();
}

/* ---------------- 计划审批 ---------------- */

function planKeyFor(key, toolUseId, requestId = '') {
  return toolUseId ? `${key}::tool::${toolUseId}` : `${key}::req::${requestId}`;
}

function hasPendingPlan(key) {
  if (!key) return false;
  for (const record of state.pendingPlans.values()) {
    if (record.key === key) return true;
  }
  return false;
}

function recalcAwaitingUser() {
  state.awaitingUser = Boolean(
    state.currentPermission || state.currentQuestion || hasPendingPlan(state.activeKey)
  );
}

function findPlanCardByText(key, plan) {
  if (!plan) return null;
  for (const record of state.planCards.values()) {
    if (record.key === key && record.status === 'readonly' && record.plan === plan) {
      return record;
    }
  }
  return null;
}

function createPlanCard({
  key,
  planKey,
  toolUseId,
  plan,
  planFilePath,
  pendingRecord = null,
  history = false,
}) {
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant plan-request';
  wrap.dataset.planKey = planKey;

  const card = document.createElement('div');
  card.className = 'plan-inline';
  card.dataset.planKey = planKey;

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'plan-inline-head';
  head.dataset.planToggle = '';

  const icon = document.createElement('span');
  icon.className = 'plan-inline-icon';
  icon.textContent = '✳';

  const title = document.createElement('span');
  title.className = 'plan-inline-title';
  title.textContent = '计划';

  const file = document.createElement('span');
  file.className = 'plan-inline-file';
  file.textContent = planFilePath || '';
  file.title = planFilePath || '';

  const statusEl = document.createElement('span');
  statusEl.className = 'plan-inline-status';

  const chevron = document.createElement('span');
  chevron.className = 'plan-inline-chevron';
  chevron.textContent = '▸';

  head.append(icon, title, file, statusEl, chevron);

  const body = document.createElement('div');
  body.className = 'plan-inline-body markdown';
  body.innerHTML = renderMarkdown(plan || '（计划内容为空）');
  highlightCode(body);

  const feedbackWrap = document.createElement('div');
  feedbackWrap.className = 'plan-inline-feedback';
  feedbackWrap.hidden = true;
  const feedback = document.createElement('textarea');
  feedback.rows = 3;
  feedback.placeholder = '告诉 Claude 想怎么改（Enter 发送，Shift+Enter 换行）';
  feedbackWrap.appendChild(feedback);

  const actions = document.createElement('div');
  actions.className = 'plan-inline-actions';
  const rejectBtn = document.createElement('button');
  rejectBtn.type = 'button';
  rejectBtn.className = 'ghost-button';
  rejectBtn.dataset.planAction = 'reject';
  rejectBtn.textContent = '拒绝并反馈';
  const approveBtn = document.createElement('button');
  approveBtn.type = 'button';
  approveBtn.className = 'primary-button';
  approveBtn.dataset.planAction = 'approve';
  approveBtn.textContent = '批准并执行';
  actions.append(rejectBtn, approveBtn);

  card.append(head, body, feedbackWrap, actions);
  wrap.appendChild(card);

  const record = {
    planKey,
    key,
    toolUseId,
    plan,
    planFilePath,
    wrap,
    card,
    head,
    body,
    statusEl,
    chevron,
    actions,
    approveBtn,
    rejectBtn,
    feedbackWrap,
    feedback,
    request: null,
    status: 'readonly',
  };
  state.planCards.set(planKey, record);

  head.addEventListener('click', () => {
    card.classList.toggle('open');
    chevron.textContent = card.classList.contains('open') ? '▾' : '▸';
  });

  rejectBtn.addEventListener('click', () => {
    if (record.status !== 'pending') return;
    if (feedbackWrap.hidden) {
      feedbackWrap.hidden = false;
      rejectBtn.textContent = '拒绝并发送';
      feedback.focus();
      return;
    }
    submitPlanDecision(record, 'reject');
  });

  approveBtn.addEventListener('click', () => {
    if (record.status === 'pending') submitPlanDecision(record, 'approve');
  });

  feedback.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      feedbackWrap.hidden = true;
      rejectBtn.textContent = '拒绝并反馈';
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (record.status === 'pending') submitPlanDecision(record, 'reject');
    }
  });

  if (pendingRecord) {
    attachPlanRequest(record, pendingRecord);
  } else if (history) {
    statusEl.textContent = '历史计划';
    statusEl.className = 'plan-inline-status readonly';
    actions.hidden = true;
    card.classList.remove('open');
  } else {
    // 实时计划：tool_use 先到、审批请求还没到，先展开给用户看
    card.classList.add('open');
    chevron.textContent = '▾';
    actions.hidden = true;
  }

  appendEl(wrap);
  return record;
}

function attachPlanRequest(record, pendingRecord) {
  if (!pendingRecord || !record) return;
  if (record.status === 'pending' && record.request?.id === pendingRecord.request?.id) return;
  record.request = pendingRecord.request;
  record.status = 'pending';
  record.plan = pendingRecord.plan;
  record.planFilePath = pendingRecord.planFilePath;
  record.card.classList.add('open');
  record.chevron.textContent = '▾';
  record.statusEl.textContent = '待批准';
  record.statusEl.className = 'plan-inline-status pending';
  record.actions.hidden = false;
  record.feedbackWrap.hidden = true;
  record.rejectBtn.textContent = '拒绝并反馈';
  record.approveBtn.disabled = false;
  record.rejectBtn.disabled = false;
}

function appendPlanToolCard(block) {
  const key = state.activeKey;
  const toolUseId = block.id || '';
  let planKey = planKeyFor(key, toolUseId);
  let pendingRecord = toolUseId ? state.pendingPlans.get(planKey) : null;

  if (!toolUseId) {
    // 旧 CLI / 假事件没有 toolUseID：按同一会话 + 计划正文完全一致唯一匹配
    const planText = block.input?.plan || '';
    const matches = [...state.pendingPlans.values()].filter(
      (record) => record.key === key && !record.toolUseId && record.plan === planText
    );
    if (matches.length === 1) {
      pendingRecord = matches[0];
      planKey = pendingRecord.planKey;
    } else {
      planKey = planKeyFor(key, '', block.id || 'unknown');
    }
  }

  const existing = state.planCards.get(planKey);
  if (existing) {
    if (pendingRecord) attachPlanRequest(existing, pendingRecord);
    return existing.wrap;
  }

  if (!pendingRecord && !toolUseId) {
    const matched = findPlanCardByText(key, block.input?.plan || '');
    if (matched) {
      attachPlanRequest(matched, state.pendingPlans.get(matched.planKey));
      return matched.wrap;
    }
  }

  return createPlanCard({
    key,
    planKey,
    toolUseId,
    plan: block.input?.plan || pendingRecord?.plan || '',
    planFilePath: block.input?.planFilePath || pendingRecord?.planFilePath || '',
    pendingRecord,
    history: state.replaying || Boolean(state.renderTarget),
  });
}

function handlePlan(key, request) {
  const toolUseId = request.toolUseId || '';
  const planKey = planKeyFor(key, toolUseId, request.id);
  const pendingRecord = {
    planKey,
    key,
    request,
    toolUseId,
    plan: request.plan || '',
    planFilePath: request.planFilePath || '',
  };
  state.pendingPlans.set(planKey, pendingRecord);

  setSessionStatus(key, 'waiting');
  if (key === state.activeKey) {
    setActivity('等待你审批计划…');
  } else {
    rememberActivity(key, '等待你审批计划…');
  }
  recalcAwaitingUser();

  // 后台会话或历史回放中：只登记，绝不碰当前会话的 DOM
  if (key !== state.activeKey || state.replaying || state.renderTarget) return;

  const existing = state.planCards.get(planKey);
  if (existing) {
    attachPlanRequest(existing, pendingRecord);
    return;
  }

  if (!toolUseId) {
    const matched = findPlanCardByText(key, pendingRecord.plan);
    if (matched) {
      state.planCards.set(planKey, matched);
      attachPlanRequest(matched, pendingRecord);
      return;
    }
  }

  createPlanCard({
    key,
    planKey,
    toolUseId,
    plan: pendingRecord.plan,
    planFilePath: pendingRecord.planFilePath,
    pendingRecord,
  });
}

/** 切换会话、历史渲染完成后，把该会话所有待审批计划补成可操作卡片。 */
function applyPendingPlans(key) {
  if (!key || key !== state.activeKey || state.replaying) return;
  for (const pendingRecord of [...state.pendingPlans.values()]) {
    if (pendingRecord.key !== key) continue;
    const existing = state.planCards.get(pendingRecord.planKey);
    if (existing) {
      attachPlanRequest(existing, pendingRecord);
      continue;
    }
    if (!pendingRecord.toolUseId) {
      const matched = findPlanCardByText(key, pendingRecord.plan);
      if (matched) {
        state.planCards.set(pendingRecord.planKey, matched);
        attachPlanRequest(matched, pendingRecord);
        continue;
      }
    }
    createPlanCard({
      key,
      planKey: pendingRecord.planKey,
      toolUseId: pendingRecord.toolUseId,
      plan: pendingRecord.plan,
      planFilePath: pendingRecord.planFilePath,
      pendingRecord,
    });
  }
}

function expirePlanCard(record) {
  if (!record || record.status !== 'pending') return;
  record.status = 'expired';
  record.statusEl.textContent = '已失效';
  record.statusEl.className = 'plan-inline-status expired';
  record.actions.hidden = true;
  record.feedbackWrap.hidden = true;
}

async function submitPlanDecision(record, decision) {
  if (!record?.request || record.status !== 'pending') return;
  const { key, request, planKey } = record;
  const feedback = record.feedback.value.trim();

  record.status = 'submitting';
  record.statusEl.textContent = '提交中…';
  record.statusEl.className = 'plan-inline-status pending';
  record.approveBtn.disabled = true;
  record.rejectBtn.disabled = true;
  state.pendingPlans.delete(planKey);
  recalcAwaitingUser();

  const result = await window.desk.respondPlan({
    key,
    id: request.id,
    decision,
    feedback: decision === 'reject' ? feedback : undefined,
  });

  // 等待期间会话结束/被停止：保持“已失效”，不把按钮重新打开
  if (record.status === 'expired') {
    if (!result?.ok) showError(result?.error || '提交计划审批失败');
    return;
  }

  if (!result?.ok) {
    record.status = 'pending';
    record.statusEl.textContent = '待批准';
    record.statusEl.className = 'plan-inline-status pending';
    record.approveBtn.disabled = false;
    record.rejectBtn.disabled = false;
    state.pendingPlans.set(planKey, {
      planKey,
      key,
      request,
      toolUseId: record.toolUseId,
      plan: record.plan,
      planFilePath: record.planFilePath,
    });
    setSessionStatus(key, 'waiting');
    if (key === state.activeKey) setActivity('等待你审批计划…');
    showError(result?.error || '提交计划审批失败');
    recalcAwaitingUser();
    return;
  }

  record.status = decision === 'approve' ? 'approved' : 'rejected';
  record.statusEl.textContent = decision === 'approve' ? '已批准' : '已拒绝';
  record.statusEl.className = `plan-inline-status ${
    decision === 'approve' ? 'approved' : 'rejected'
  }`;
  record.actions.hidden = true;
  record.feedbackWrap.hidden = true;

  if (decision === 'approve') {
    state.modeByKey.set(key, 'default');
    if (key === state.activeKey) renderPermissionMode('default');
    if (state.startedKeys.has(key)) {
      window.desk.setPermissionMode({ key, mode: 'default' });
    }
  }
  setSessionStatus(key, 'working');
  rememberActivity(key, '等待模型响应…');
  if (key === state.activeKey) setActivity('等待模型响应…');
  recalcAwaitingUser();
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
  if (!command) {
    hideSlashPalette();
    return;
  }
  els.input.value = `/${command} `;
  hideSlashPalette();
  els.input.focus();
  autosize();
}

/* ---------------- 页内查找 ---------------- */

function clearFindHighlight() {
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    CSS.highlights.delete('find-match');
    CSS.highlights.delete('find-active');
  }
  state.findMatches = [];
  state.findIndex = 0;
}

function collectFindMatches(query) {
  const matches = [];
  if (!query) return matches;

  const needle = query.toLowerCase();
  const walker = document.createTreeWalker(els.messages, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.nodeValue;
    // 跳过折叠起来的思考块、工具详情等不可见内容
    if (text && node.parentElement && node.parentElement.getClientRects().length > 0) {
      const haystack = text.toLowerCase();
      let index = haystack.indexOf(needle);
      while (index !== -1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + query.length);
        matches.push(range);
        index = haystack.indexOf(needle, index + query.length);
      }
    }
    node = walker.nextNode();
  }
  return matches;
}

function applyFindHighlight() {
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight !== 'function') return;
  CSS.highlights.delete('find-match');
  CSS.highlights.delete('find-active');
  if (state.findMatches.length === 0) return;

  CSS.highlights.set('find-match', new Highlight(...state.findMatches));
  const active = state.findMatches[state.findIndex];
  if (active) CSS.highlights.set('find-active', new Highlight(active));
}

function updateFindCount() {
  const total = state.findMatches.length;
  if (total === 0) {
    els.findCount.textContent = els.findInput.value.trim() ? '无结果' : '0/0';
    return;
  }
  els.findCount.textContent = `${state.findIndex + 1}/${total}`;
}

function scrollToFindMatch() {
  const range = state.findMatches[state.findIndex];
  if (!range) return;
  const element = range.startContainer.parentElement;
  if (element) element.scrollIntoView({ block: 'center' });
}

function runFind(forward = true, findNext = false) {
  const query = els.findInput.value.trim();
  if (!query) {
    state.findQuery = '';
    clearFindHighlight();
    updateFindCount();
    return;
  }

  if (!findNext || query !== state.findQuery || state.findMatches.length === 0) {
    state.findQuery = query;
    state.findMatches = collectFindMatches(query);
    state.findIndex = 0;
  } else {
    const total = state.findMatches.length;
    state.findIndex = (state.findIndex + (forward ? 1 : -1) + total) % total;
  }

  applyFindHighlight();
  scrollToFindMatch();
  updateFindCount();
}

function openFindBar() {
  els.findBar.hidden = false;
  els.findInput.focus();
  els.findInput.select();
  if (els.findInput.value.trim()) runFind(true, false);
}

function closeFindBar() {
  els.findBar.hidden = true;
  els.findInput.value = '';
  state.findQuery = '';
  clearFindHighlight();
  els.findCount.textContent = '0/0';
  els.input.focus();
}

/* ---------------- 终端 ---------------- */

function terminalDir() {
  return state.terminalCwd || state.cwd || '';
}

function updateTerminalCwd() {
  const normalize = (value) =>
    String(value || '')
      .replace(/\//g, '\\')
      .replace(/\\+$/, '')
      .toLowerCase();
  const mismatch =
    state.terminalStarted &&
    normalize(state.terminalCwd) &&
    normalize(state.cwd) &&
    normalize(state.terminalCwd) !== normalize(state.cwd);
  els.terminalCwd.textContent = mismatch
    ? `${state.terminalCwd}（与当前会话不同，点「重启」切换）`
    : terminalDir() || '未选择目录';
  els.terminalCwd.classList.toggle('mismatch', Boolean(mismatch));
}

function writeClipboard(text) {
  if (!text) return;
  window.desk.writeClipboard(text).catch(() => {});
}

function readClipboard() {
  return window.desk
    .readClipboard()
    .then((result) => result?.text || '')
    .catch(() => '');
}

let terminalCreating = null;

function ensureTerminal() {
  if (state.terminal) return Promise.resolve();
  if (terminalCreating) return terminalCreating;

  terminalCreating = (async () => {
    try {
      const xterm = await loadScriptOnce('xterm.bundle.js', '__ClaudeDeskXterm');
      if (state.terminal) return;

      const term = new xterm.Terminal({
        cursorBlink: true,
        fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
        fontSize: 12.5,
        lineHeight: 1.2,
        scrollback: 5000,
        theme: {
          background: '#0d0f13',
          foreground: '#d6d9de',
          cursor: '#d97757',
          selectionBackground: '#2f353f',
        },
      });
      const fit = new xterm.FitAddon();
      term.loadAddon(fit);
      term.open(els.terminalView);

      term.onData((data) => window.desk.ptyWrite(data));
      term.onResize(({ cols, rows }) => window.desk.ptyResize({ cols, rows }));
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true;
        if (event.code === 'KeyC') {
          writeClipboard(term.getSelection());
          return false;
        }
        if (event.code === 'KeyV') {
          readClipboard().then((text) => {
            if (text) window.desk.ptyWrite(text);
          });
          return false;
        }
        return true;
      });

      state.terminal = term;
      state.terminalFit = fit;

      const resize = () => {
        if (els.terminalPanel.hidden) return;
        try {
          fit.fit();
        } catch {
          // 面板尺寸为 0 时 fit 会失败，忽略
        }
      };
      new ResizeObserver(resize).observe(els.terminalView);
      window.addEventListener('resize', resize);
    } catch (err) {
      console.error('终端组件加载失败:', err);
    } finally {
      terminalCreating = null;
    }
  })();

  return terminalCreating;
}

async function startTerminal() {
  if (state.terminalStarting || state.terminalStarted) return;
  state.terminalStarting = true;
  try {
    await ensureTerminal();
    if (!state.terminal) return;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      state.terminalFit?.fit();
    } catch {
      // 忽略尺寸计算失败
    }

    const result = await window.desk.ptyStart({
      cwd: state.cwd,
      cols: state.terminal.cols,
      rows: state.terminal.rows,
    });
    if (!result?.ok) {
      state.terminal.writeln(`\r\n[无法启动终端] ${result?.error || '未知错误'}\r\n`);
      return;
    }
    state.terminalStarted = true;
    state.terminalCwd = result.cwd || state.cwd;
    updateTerminalCwd();
    state.terminal.focus();
  } finally {
    state.terminalStarting = false;
  }
}

async function restartTerminal() {
  if (state.terminalStarting) return;
  state.terminalRestarting = true;
  await window.desk.ptyStop();
  state.terminal?.reset();
  state.terminalStarted = false;
  state.terminalCwd = state.cwd;
  updateTerminalCwd();
  await new Promise((resolve) => setTimeout(resolve, 150));
  state.terminalRestarting = false;
  await startTerminal();
}

async function toggleTerminal(force) {
  const open = force ?? !state.terminalOpen;
  state.terminalOpen = open;
  els.terminalPanel.hidden = !open;
  els.toggleTerminal.classList.toggle('active', open);
  if (!open) return;

  await ensureTerminal();
  if (!state.terminal) return;
  updateTerminalCwd();
  requestAnimationFrame(() => {
    try {
      state.terminalFit?.fit();
    } catch {
      // 忽略
    }
    if (!state.terminalStarted) startTerminal();
    else state.terminal?.focus();
  });
}

/* ---------------- 发送 ---------------- */

function autosize() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 220)}px`;
}

/** 按会话保存输入框草稿（文字 + 附件），切走不串台。 */
function saveDraft(key) {
  if (!key) return;
  const text = els.input.value;
  if (!text && state.attachments.length === 0) {
    state.drafts.delete(key);
    return;
  }
  state.drafts.set(key, {
    text,
    attachments: state.attachments.slice(),
    start: els.input.selectionStart ?? 0,
    end: els.input.selectionEnd ?? 0,
  });
}

function restoreDraft(key) {
  const draft = state.drafts.get(key);
  els.input.value = draft?.text || '';
  state.attachments = draft ? draft.attachments.slice() : [];
  renderAttachments();
  autosize();
  if (draft) {
    try {
      els.input.setSelectionRange(draft.start, draft.end);
    } catch {
      /* 忽略 */
    }
  }
}

function dropDraft(key) {
  if (key) state.drafts.delete(key);
}

/** 同一个 key 的启动/恢复只跑一次，避免并发 resume 把刚启动的会话又重启。 */
function beginSession(key, starter) {
  if (state.startingKeys.has(key)) return state.startingKeys.get(key);
  const promise = Promise.resolve()
    .then(starter)
    .finally(() => state.startingKeys.delete(key));
  state.startingKeys.set(key, promise);
  return promise;
}

async function ensureSession() {
  if (state.activeKey && state.startedKeys.has(state.activeKey)) return true;
  if (!state.cwd) {
    const picked = await window.desk.pickDirectory();
    if (!picked?.ok || !picked.path) {
      showError('请先选择工作目录');
      return false;
    }
    setCwd(picked.path);
  }
  clearError();

  const key = state.activeKey || state.sessionId || newSessionKey();
  state.activeKey = key;
  state.closedKeys.delete(key);
  if (!state.keyTitles.get(key)) {
    state.keyTitles.set(key, els.sessionTitle.textContent || '当前会话');
  }
  const mode = state.modeByKey.get(key) || state.permissionMode;
  state.modeByKey.set(key, mode);
  const options = {
    key,
    cwd: state.cwd,
    model: state.model,
    permissionMode: mode,
  };
  const result = state.sessionId
    ? await beginSession(key, () =>
        window.desk.resumeSession({ ...options, sessionId: state.sessionId })
      )
    : await beginSession(key, () => window.desk.startSession(options));
  if (!result?.ok) {
    showError(result?.error || '启动会话失败');
    return false;
  }
  state.startedKeys.add(key);
  state.sessionActive = true;
  setSessionStatus(key, 'working');
  renderPermissionMode(mode);
  return true;
}

async function sendMessage() {
  if (state.sending || state.replaying) return;
  const text = els.input.value.trim();
  const attachments = state.attachments.slice();
  if (!text && attachments.length === 0) return;

  const viewToken = state.switchToken;
  state.sending = true;
  try {
    clearError();
    const sendKey = state.activeKey;
    const prevStatus = sendKey ? state.sessionStatus.get(sendKey) : null;
    const planWaiting = hasPendingPlan(sendKey);
    if (sendKey && !planWaiting) setSessionStatus(sendKey, 'working');
    if (!planWaiting) {
      // 启动/恢复 CLI 可能有一段时间没有事件，先给用户明确反馈
      setActivity(
        state.sessionActive
          ? '正在发送…'
          : state.sessionId
            ? '正在恢复会话…'
            : '正在启动会话…'
      );
    }

    const ready = await ensureSession();
    if (!ready) {
      if (sendKey) setSessionStatus(sendKey, prevStatus || null);
      if (
        state.activityLabel === '正在启动会话…' ||
        state.activityLabel === '正在恢复会话…' ||
        state.activityLabel === '正在发送…'
      ) {
        finishActivity('启动失败', 'error');
      }
      return;
    }
    // 启动/恢复期间用户切走了会话：消息留在输入框，不要发到别的会话
    if (viewToken !== state.switchToken) {
      if (sendKey) setSessionStatus(sendKey, prevStatus || null);
      return;
    }
    const key = state.activeKey;
    if (!key) return;

    const steer = state.running;
    const content = buildMessageContent(text, attachments);
    setRunning(true);
    state.interruptRequested = false;
    state.lastStderrByKey.delete(key);
    recalcAwaitingUser();
    setActivity('等待模型响应…');

    const result = await window.desk.send(text, { key, steer, content });
    if (!result?.ok) {
      if (key === state.activeKey) {
        setRunning(false);
        setSessionStatus(key, null);
        finishActivity('发送失败', 'error');
        showError(result?.error || '发送失败');
      }
      return;
    }

    // 新消息已经进入这个会话，历史缓存和草稿都作废
    dropHistory(state.keyToSession.get(key) || state.sessionId);
    dropDraft(key);
    if (key !== state.activeKey) return;
    appendUserMessage(text, steer, result.uuid || '', attachments);
    // 发送期间用户可能又输入了新内容，只清掉本次发送的部分
    if (els.input.value.trim() === text) els.input.value = '';
    const sameAttachments =
      state.attachments.length === attachments.length &&
      state.attachments.every((item, index) => item === attachments[index]);
    if (sameAttachments) {
      state.attachments = [];
      renderAttachments();
    }
    autosize();
    hideSlashPalette();
  } finally {
    state.sending = false;
  }
}

async function stopCurrent() {
  state.interruptRequested = true;
  if (state.running) setActivity('正在停止…');
  clearPrompts(state.activeKey);
  await window.desk.interrupt({ key: state.activeKey });
  setRunning(false);
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
    const initialMode = state.settings.permissionMode || 'default';
    const modeValue = PERMISSION_MODES.some((item) => item.value === initialMode)
      ? initialMode
      : 'default';
    state.permissionMode = modeValue;
    renderPermissionMode(modeValue);
    if (modeValue !== initialMode) window.desk.saveSettings({ permissionMode: modeValue });
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
    // 会话列表需要 import SDK 并扫描磁盘，放到首帧之后再加载
    const refresh = () => refreshSessions();
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(refresh, { timeout: 1500 });
    } else {
      setTimeout(refresh, 50);
    }
  }

  els.send.addEventListener('click', sendMessage);
  els.stop.addEventListener('click', stopCurrent);
  $('new-session').addEventListener('click', newSession);
  $('refresh-sessions').addEventListener('click', () => refreshSessions(true));
  els.addDirectory.addEventListener('click', pickDirectoryAndOpen);
  els.sessionSearch.addEventListener('input', () => {
    state.searchQuery = els.sessionSearch.value.trim();
    renderSessionGroups();
  });
  els.multiToggle.addEventListener('click', () => toggleSelectMode());
  els.batchTrash.addEventListener('click', batchMoveToTrash);
  els.batchCancel.addEventListener('click', () => toggleSelectMode(false));
  updateBatchBar();

  els.toggleTerminal.addEventListener('click', () => toggleTerminal());
  els.terminalClose.addEventListener('click', () => toggleTerminal(false));
  els.terminalClear.addEventListener('click', () => state.terminal?.clear());
  els.terminalRestart.addEventListener('click', restartTerminal);

  els.findInput.addEventListener('input', () => runFind(true, false));
  els.findInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      runFind(!event.shiftKey, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeFindBar();
    }
  });
  els.findNext.addEventListener('click', () => runFind(true, true));
  els.findPrev.addEventListener('click', () => runFind(false, true));
  els.findClose.addEventListener('click', closeFindBar);
  els.trashToggle.addEventListener('click', () => {
    els.trashList.hidden = !els.trashList.hidden;
    els.trashArrow.textContent = els.trashList.hidden ? '▸' : '▾';
  });

  els.input.addEventListener('input', () => {
    autosize();
    updateSlashPalette();
  });
  els.attach.addEventListener('click', pickAttachments);
  els.input.addEventListener('paste', (event) => {
    const files = Array.from(event.clipboardData?.files || []).filter((file) =>
      String(file.type || '').startsWith('image/')
    );
    if (files.length === 0) return;
    // 图文混排时保留文本，只额外添加图片
    if (!event.clipboardData?.getData('text/plain')) event.preventDefault();
    addAttachmentFiles(files);
  });
  for (const target of [els.messages, $('composer')]) {
    target.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    target.addEventListener('drop', (event) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      addAttachmentFiles(Array.from(event.dataTransfer.files));
    });
  }
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
        applySlash(state.slashItems[state.slashIndex]?.name);
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

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      openFindBar();
      return;
    }
    if (event.key !== 'Escape') return;
    if (els.terminalPanel.contains(event.target)) return;
    if (!els.permissionMenu.hidden) {
      els.permissionMenu.hidden = true;
      return;
    }
    if (!els.findBar.hidden) {
      closeFindBar();
    } else if (!els.settingsModal.hidden) {
      els.settingsModal.hidden = true;
    } else if (!els.slashPalette.hidden) {
      hideSlashPalette();
    } else if (!els.questionModal.hidden) {
      skipQuestion();
    } else if (!els.permModal.hidden) {
      answerPermission('deny');
    } else if (hasPendingPlan(state.activeKey)) {
      // 等待计划审批时不要用 Esc 误拒，也不要误停当前回合
      return;
    } else if (state.running) {
      stopCurrent();
    }
  });

  els.permAllow.addEventListener('click', () => answerPermission('allow'));
  els.permAllowSession.addEventListener('click', () => answerPermission('allow-session'));
  els.permDeny.addEventListener('click', () => answerPermission('deny'));

  els.questionSubmit.addEventListener('click', submitQuestion);
  els.questionSkip.addEventListener('click', skipQuestion);

  els.permissionButton.addEventListener('click', (event) => {
    event.stopPropagation();
    els.permissionMenu.hidden = !els.permissionMenu.hidden;
  });
  els.permissionMenu.addEventListener('click', (event) => {
    const option = event.target.closest('.permission-option');
    if (option) changePermissionMode(option.dataset.mode);
  });
  document.addEventListener('click', (event) => {
    if (!els.permissionMenu.hidden && !event.target.closest('.permission-control')) {
      els.permissionMenu.hidden = true;
    }
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

  window.desk.onEvent(({ key, message }) => handleSessionEvent(key, message));
  window.desk.onState(({ key, ...payload }) => handleSessionState(key, payload));
  window.desk.onPermission(({ key, request }) => {
    if (!state.closedKeys.has(key)) enqueuePermission(key, request);
  });
  window.desk.onQuestion(({ key, request }) => {
    if (!state.closedKeys.has(key)) showQuestion(key, request);
  });
  window.desk.onPlan(({ key, request }) => {
    if (!state.closedKeys.has(key)) handlePlan(key, request);
  });
  window.desk.onCommands(({ key, commands }) => {
    if (state.closedKeys.has(key)) return;
    state.commandsByKey.set(key, Array.isArray(commands) ? commands : []);
    if (key === state.activeKey) {
      handleCommands(commands);
      updateSlashPalette();
    }
  });
  window.desk.onPtyData(({ data }) => state.terminal?.write(data));
  window.desk.onPtyExit((info) => {
    state.terminalStarted = false;
    if (state.terminalRestarting || els.terminalPanel.hidden) return;
    const code = info?.exitCode === null || info?.exitCode === undefined ? '未知' : info.exitCode;
    state.terminal?.writeln(`\r\n[终端已退出，退出码 ${code}]`);
  });
  window.desk.onQuickSend(({ text }) => {
    if (!text) return;
    els.input.value = text;
    autosize();
    if (!state.sending) sendMessage();
  });
  window.desk.onMenuExport(exportCurrentSession);
  window.desk.onMenuFind(openFindBar);
  window.desk.onError(({ key, message }) => handleSessionError(key, message));
  window.desk.onStderr(({ key, text }) => {
    if (!key || !text || state.closedKeys.has(key)) return;
    const prev = state.lastStderrByKey.get(key) || '';
    state.lastStderrByKey.set(key, (prev + String(text)).slice(-1000));
  });
  window.desk.onSessionReleased(({ key }) => {
    if (!key) return;
    state.startedKeys.delete(key);
    if (state.activeKey === key) {
      state.sessionActive = false;
      if (!hasPendingPlan(key) && !state.awaitingUser) clearActivity();
      setSessionStatus(key, null);
    }
  });
  window.desk.onNewSession(newSession);
  window.desk.onPickDirectory(async () => {
    const picked = await window.desk.pickDirectory();
    if (picked?.ok && picked.path) {
      if (state.activeKey) await newSession();
      setCwd(picked.path);
    }
  });

  els.input.focus();
  autosize();
}

init();
