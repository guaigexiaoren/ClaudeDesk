import { marked } from 'marked';
import DOMPurify from 'dompurify';
import 'highlight.js/styles/github-dark.css';
import { buildSessionGroups } from './session-groups.js';
import { formatDuration, formatStallLabel } from './format.js';
import { createDraftStore } from './composer-drafts.js';
import {
  startTurn,
  pauseTurn,
  resumeTurn,
  turnElapsed,
  finishTurn,
  lastTurnTiming,
} from './turn-timing.js';

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

const DIR_TONES = ['claude', 'blue', 'green', 'purple', 'pink', 'amber'];

/** 目录路径越稳定，颜色越稳定；空目录（置顶组）交给 accent 色。 */
function toneForDir(dir) {
  const normalized = String(dir || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!normalized) return '';
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return DIR_TONES[(hash >>> 0) % DIR_TONES.length];
}

const GROUP_ICON_PATHS = {
  folder:
    'M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.4 1.6h4.8A1.5 1.5 0 0 1 14 6.1v5.4A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z',
  star: 'M8 2.5l1.65 3.35 3.7.54-2.68 2.6.63 3.68L8 10.93l-3.3 1.74.63-3.68-2.68-2.6 3.7-.54L8 2.5Z',
};

function createGroupIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'group-folder');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', GROUP_ICON_PATHS[kind] || GROUP_ICON_PATHS.folder);
  svg.appendChild(path);
  return svg;
}


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
  platform: '',
  // 多会话：key 是后端会话标识，sessionId 是 SDK 会话标识
  activeKey: null,
  startedKeys: new Set(),
  closedKeys: new Set(),
  switchToken: 0,
  keyToSession: new Map(),
  sessionKeys: new Map(),
  sessionStatus: new Map(),
  turnTimingByKey: new Map(),
  pendingTurnStartedAt: 0,
  keyTitles: new Map(),
  commandsByKey: new Map(),
  mcpByKey: new Map(),
  modeByKey: new Map(),
  startingKeys: new Map(),
  sessionsRequest: 0,
  sessionsInFlight: null,
  sessionsFetchedAt: 0,
  historyCache: new Map(),
  historyView: null,
  preCompactView: null,
  renderTarget: null,
  compacting: false,
  lastStderrByKey: new Map(),
  running: false,
  sending: false,
  stoppingKey: null,
  stopSeq: 0,
  stopNoticeShown: false,
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
  toolGroup: null,
  thinkingGroup: null,
  conciseMode: true,
  envLoading: false,
  globalRulesLoadedContent: '',
  globalRulesLoading: false,
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
  searchQuery: '',
  settingsTab: 'general',
  providers: { activeId: '', profiles: [] },
  providersLoaded: false,
  pricingStatus: null,
  providerEditingId: null,
  usageRange: '7d',
  usageRequest: 0,
  selectMode: false,
  selectedSessions: new Set(),
  findQuery: '',
  findMatches: [],
  findIndex: 0,
};

const $ = (id) => document.getElementById(id);

const els = {
  messages: $('messages'),
  planReview: $('plan-review'),
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
  sessionTurnTime: $('session-turn-time'),
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
  questionReview: $('question-review'),
  questionList: $('question-list'),
  questionSubmit: $('question-submit'),
  questionSkip: $('question-skip'),
  slashPalette: $('slash-palette'),
  settingsModal: $('settings-modal'),
  usageModal: $('usage-modal'),
  usageClose: $('usage-close'),
  accentSwatches: $('accent-swatches'),
  fontSize: $('font-size'),
  fontSizeValue: $('font-size-value'),
  settingsCwd: $('settings-cwd'),
  settingsVersion: $('settings-version'),
  mcpList: $('mcp-list'),
  mcpRefresh: $('mcp-refresh'),
  conciseMode: $('concise-mode'),
  globalRulesText: $('global-rules-text'),
  globalRulesSave: $('global-rules-save'),
  globalRulesReload: $('global-rules-reload'),
  globalRulesStatus: $('global-rules-status'),
  envSummary: $('env-summary'),
  envList: $('env-list'),
  envRefresh: $('env-refresh'),
  envCheckedAt: $('env-checked-at'),
  envNote: $('env-note'),
  providerAdd: $('provider-add'),
  providerActiveSelect: $('provider-active-select'),
  providerList: $('provider-list'),
  providerForm: $('provider-form'),
  providerFormTitle: $('provider-form-title'),
  providerPresetDeepseek: $('provider-preset-deepseek'),
  providerName: $('provider-name'),
  providerBaseUrl: $('provider-base-url'),
  providerAuthMode: $('provider-auth-mode'),
  providerKey: $('provider-key'),
  providerClearKey: $('provider-clear-key'),
  providerModelOpus: $('provider-model-opus'),
  providerModelSonnet: $('provider-model-sonnet'),
  providerModelHaiku: $('provider-model-haiku'),
  providerModelFable: $('provider-model-fable'),
  providerMultiplier: $('provider-multiplier'),
  pricingStatus: $('pricing-status'),
  pricingSync: $('pricing-sync'),
  providerPricingHint: $('provider-pricing-hint'),
  providerFormError: $('provider-form-error'),
  providerCancel: $('provider-cancel'),
  usageRange: $('usage-range'),
  usageCustomRange: $('usage-custom-range'),
  usageStart: $('usage-start'),
  usageEnd: $('usage-end'),
  usageApply: $('usage-apply'),
  usageCustomError: $('usage-custom-error'),
  usageCards: $('usage-cards'),
  usageTableBody: $('usage-table-body'),
  usageEmpty: $('usage-empty'),
  mcpAddToggle: $('mcp-add-toggle'),
  mcpForm: $('mcp-form'),
  mcpName: $('mcp-name'),
  mcpType: $('mcp-type'),
  mcpCommand: $('mcp-command'),
  mcpArgs: $('mcp-args'),
  mcpUrl: $('mcp-url'),
  mcpEnv: $('mcp-env'),
  mcpHeaders: $('mcp-headers'),
  mcpFormError: $('mcp-form-error'),
  mcpCancel: $('mcp-cancel'),
  mcpStdioFields: $('mcp-stdio-fields'),
  mcpRemoteFields: $('mcp-remote-fields'),
  skillsRootLabel: $('skills-root'),
  skillsList: $('skills-list'),
  skillForm: $('skill-form'),
  skillRepo: $('skill-repo'),
  skillSubpath: $('skill-subpath'),
  skillFormError: $('skill-form-error'),
  skillInstall: $('skill-install'),
  sessionSearch: $('session-search'),
  sessionSearchWrap: $('session-search-wrap'),
  searchSessions: $('search-sessions'),
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
};

/* ---------------- 工具函数 ---------------- */

const scriptLoads = new Map();

/** 按需加载拆分的本地脚本（代码高亮），避免首屏解析大依赖。 */
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
  closeToolGroup();
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
  if (state.conciseMode) {
    const group = ensureThinkingGroup();
    const segment = document.createElement('div');
    segment.className = 'thinking-segment';
    segment.textContent = text;
    group.body.appendChild(segment);
    group.segments += 1;
    updateThinkingGroup(group);
    return group.details;
  }
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

function ensureThinkingGroup() {
  if (state.thinkingGroup) return state.thinkingGroup;
  const details = document.createElement('details');
  details.className = 'thinking-group';
  const summary = document.createElement('summary');
  summary.textContent = '思考过程';
  const body = document.createElement('div');
  body.className = 'thinking-group-body';
  details.append(summary, body);

  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.appendChild(details);
  appendEl(wrap);

  const group = { details, summary, body, wrap, segments: 0, totalMs: 0 };
  state.thinkingGroup = group;
  return group;
}

function updateThinkingGroup(group) {
  if (!group) return;
  const parts = [`思考过程 · ${group.segments} 段`];
  if (group.totalMs > 0) parts.push(`用时 ${formatElapsed(group.totalMs)}`);
  group.summary.textContent = parts.join(' · ');
}

/** 思考开始时插一个默认收起的计时块，只显示“思考中… N 秒”。 */
function beginThinking(index) {
  setActivity('正在思考…');
  if (state.conciseMode) {
    const group = ensureThinkingGroup();
    const segment = document.createElement('div');
    segment.className = 'thinking-segment';
    group.body.appendChild(segment);
    group.segments += 1;

    const entry = {
      group,
      segment,
      body: segment,
      summary: group.summary,
      index,
      startedAt: performance.now(),
      stoppedAt: 0,
      timer: null,
    };
    const tick = () => {
      if (entry.stoppedAt) return;
      group.summary.textContent = `思考中… ${formatElapsed(performance.now() - entry.startedAt)}`;
    };
    tick();
    entry.timer = setInterval(tick, 200);
    state.thinkingLive.push(entry);
    return entry;
  }

  const details = document.createElement('details');
  details.className = 'thinking live';
  details.open = false;
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
  if (entry.group) {
    entry.group.totalMs += entry.stoppedAt - entry.startedAt;
    updateThinkingGroup(entry.group);
    return;
  }
  entry.details.classList.remove('live');
  entry.details.open = false;
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
    if (entry.group) {
      if (!entry.segment.textContent.trim()) {
        entry.segment.remove();
        entry.group.segments = Math.max(0, entry.group.segments - 1);
        entry.group.totalMs = Math.max(
          0,
          entry.group.totalMs - (entry.stoppedAt - entry.startedAt)
        );
        updateThinkingGroup(entry.group);
      }
    } else if (!entry.body.textContent.trim()) {
      entry.details.parentElement?.remove();
    }
  }
  state.thinkingLive = [];
  const group = state.thinkingGroup;
  if (group && group.segments <= 0 && !group.body.textContent.trim()) {
    group.wrap.remove();
    state.thinkingGroup = null;
  }
}

/** 结束当前的工具/思考分组；下一段内容会新建分组。 */
function closeToolGroup() {
  state.toolGroup = null;
  state.thinkingGroup = null;
}

function ensureToolGroup() {
  if (state.toolGroup) return state.toolGroup;
  const details = document.createElement('details');
  details.className = 'tool-group';
  const summary = document.createElement('summary');
  const body = document.createElement('div');
  body.className = 'tool-group-body';
  details.append(summary, body);

  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.appendChild(details);
  appendEl(wrap);

  const group = { details, summary, body, ids: [] };
  state.toolGroup = group;
  updateToolGroup(group);
  return group;
}

function updateToolGroup(group) {
  if (!group) return;
  const entries = group.ids.map((id) => state.toolCards.get(id)).filter(Boolean);
  const names = new Set();
  let running = 0;
  let failed = 0;
  for (const entry of entries) {
    if (entry.name) names.add(entry.name);
    const failedEntry = entry.status.classList.contains('error');
    if (!entry.hasResult && !failedEntry) running += 1;
    if (failedEntry) failed += 1;
  }
  const parts = [`工具调用 · ${entries.length} 次`];
  if (names.size > 0) parts.push([...names].slice(0, 4).join('/'));
  if (running > 0) parts.push(`${running} 个运行中`);
  if (failed > 0) parts.push(`${failed} 个失败`);
  group.summary.textContent = parts.join(' · ');
  group.summary.classList.toggle('running', running > 0 && failed === 0);
  group.summary.classList.toggle('error', failed > 0);
}

function appendToolUse(block) {
  if (block?.name === 'ExitPlanMode') {
    closeToolGroup();
    return appendPlanToolCard(block);
  }
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

  if (state.conciseMode) {
    const group = ensureToolGroup();
    group.body.appendChild(card);
    group.ids.push(block.id);
    state.toolCards.set(block.id, {
      card,
      status,
      body,
      hasResult: false,
      group,
      name: block.name,
    });
    updateToolGroup(group);
    return card;
  }

  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.appendChild(card);
  appendEl(wrap);

  state.toolCards.set(block.id, { card, status, body, hasResult: false, name: block.name });
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
      restorePlanCard(planCard);
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
  if (entry.group) updateToolGroup(entry.group);
  if (state.running) setActivity('等待模型响应…');
  if (!state.conciseMode) scrollToBottom();
}

function appendStats(message) {
  closeToolGroup();
  const parts = [];
  if (message.duration_ms) parts.push(`本轮 ${formatDuration(message.duration_ms)}`);
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
  closeToolGroup();
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
  closeToolGroup();
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
  closeToolGroup();
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
  closeToolGroup();
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
  closeToolGroup();
  finalizeStream();
  clearInsertBadges();
  state.awaitingUser = false;
  state.compacting = false;
  const interrupted = state.interruptRequested;
  state.interruptRequested = false;
  clearPrompts(state.activeKey);
  markUnfinishedTools();
  if (interrupted) {
    if (!state.stopNoticeShown) appendNotice('已停止生成');
  } else if (message.is_error && message.result) {
    showError(withContextLimitHint(message.result));
  } else if (message.subtype !== 'success' && Array.isArray(message.errors) && message.errors.length) {
    showError(withContextLimitHint(message.errors.join(' ')));
  }
  state.stopNoticeShown = false;
  appendStats(message);
  setRunning(false);
  finishActivity(
    interrupted ? '已停止生成' : message.duration_ms
      ? `已完成 · 本轮用时 ${formatDuration(message.duration_ms)}`
      : '已完成',
    interrupted ? 'stopped' : 'done'
  );

  // 新会话的 transcript 可能稍晚才被 listSessions 看到，延迟重试刷新
  if (state.sessionId) scheduleSessionRefresh(state.sessionId);
}

function handleSystem(message) {
  if (message.subtype === 'init') {
    state.sessionId = message.session_id;
    state.sessionActive = true;
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
    // 新会话第一次 init 时还没进入历史列表，自动重试刷新并高亮当前会话
    scheduleSessionRefresh(message.session_id);
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
    if (Array.isArray(message.mcp_servers)) {
      state.mcpByKey.set(
        key,
        Object.fromEntries(message.mcp_servers.map((server) => [server.name, server.status]))
      );
    }
  }
  updateSessionStatusFromEvent(key, message);
  if (message.type === 'result') finishTurnTiming(key, message.duration_ms);
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
    // 后台会话已经空闲时，不要把状态灯和“停止按钮”留在 working
    if (payload.status === 'idle' && state.sessionStatus.get(key) === 'working') {
      setSessionStatus(key, 'done');
    }
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
  // starting 只是 CLI 在启动/恢复，不代表有回合在跑，不显示停止按钮
  if (payload.status === 'running') setRunning(true);
  if (
    (payload.status === 'starting' || payload.status === 'running') &&
    !state.activityStartedAt &&
    !state.awaitingUser &&
    !hasPendingPlan(key)
  ) {
    // 没有经过 sendMessage 的启动（如恢复会话）也要有可见反馈
    setActivity(payload.status === 'starting' ? '正在恢复会话…' : '正在处理…');
  }
  if (payload.status === 'idle') {
    // 会话结束/报错时收尾，避免思考计时器一直跑
    flushThinking();
    setRunning(false);
    if (state.sessionStatus.get(key) === 'working') setSessionStatus(key, 'done');
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
    if (state.stoppingKey === key) state.stoppingKey = null;
    if (hadTurn) {
      if (stopping) finishActivity('已停止生成', 'stopped');
      else handleUnexpectedEnd();
    }
    closeToolGroup();
    setSessionStatus(key, null);
    state.sessionActive = false;
    clearPrompts(key);
  }
  if (payload.cwd && payload.cwd !== state.cwd) setCwd(payload.cwd, false);
}

const CONTEXT_LIMIT_ERROR =
  /maximum context length|context_length_exceeded|prompt is too long|too many tokens|context window.*(exceed|limit)|token limit/i;

function withContextLimitHint(text) {
  const raw = String(text || '会话出错');
  if (!CONTEXT_LIMIT_ERROR.test(raw)) return raw;
  return `${raw} — 当前会话已超过模型上下文上限：请发送 /compact 压缩上下文；若仍失败，请新建会话继续（旧会话会保留）。`;
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
  closeToolGroup();
  finalizeStream();
  clearInsertBadges();
  clearPrompts(key);
  markUnfinishedTools();
  setSessionStatus(key, null);
  state.sessionActive = false;
  setRunning(false);
  finishActivity('任务出错', 'error');
  showError(withContextLimitHint(text));
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

function formatTotalTime(ms) {
  const raw = Math.max(0, Number(ms) || 0);
  if (raw > 0 && raw < 1000) return '不到 1 秒';
  const totalSeconds = Math.round(raw / 1000);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours} 小时 ${restMinutes} 分` : `${hours} 小时`;
}

function beginTurnTiming(key, startedAt = performance.now()) {
  if (!key) return;
  state.turnTimingByKey.set(key, startTurn(startedAt));
  if (key === state.activeKey) updateTurnTimeDisplay();
}

function pauseTurnTiming(key) {
  const timing = key ? state.turnTimingByKey.get(key) : null;
  if (timing && !timing.pausedAt) {
    state.turnTimingByKey.set(key, pauseTurn(timing, performance.now()));
  }
  if (key === state.activeKey) updateTurnTimeDisplay();
}

function resumeTurnTiming(key) {
  const timing = key ? state.turnTimingByKey.get(key) : null;
  if (timing?.pausedAt) {
    state.turnTimingByKey.set(key, resumeTurn(timing, performance.now()));
  }
  if (key === state.activeKey) updateTurnTimeDisplay();
}

function finishTurnTiming(key, durationMs) {
  if (!key) return;
  const timing = state.turnTimingByKey.get(key);
  if (!timing && !(Number(durationMs) > 0)) return;
  state.turnTimingByKey.set(
    key,
    finishTurn(timing || startTurn(performance.now()), durationMs, performance.now())
  );
  if (key === state.activeKey) updateTurnTimeDisplay();
}

function clearTurnTiming(key) {
  if (!key) return;
  state.turnTimingByKey.delete(key);
  if (key === state.activeKey) updateTurnTimeDisplay();
}

/** 顶部只显示「本回合」用时，参考 Codex 的 Worked for；不跨回合累计。 */
function updateTurnTimeDisplay() {
  if (!els.sessionTurnTime) return;
  const key = state.activeKey;
  const timing = key ? state.turnTimingByKey.get(key) : null;
  const running = Boolean(key && state.running);
  let elapsed = 0;
  if (running) {
    elapsed = timing
      ? turnElapsed(timing, performance.now())
      : state.activityStartedAt
        ? Math.max(0, performance.now() - state.activityStartedAt)
        : 0;
  } else if (timing?.lastDurationMs) {
    elapsed = timing.lastDurationMs;
  }

  const visible = Boolean(key) && (elapsed > 0 || running);
  els.sessionTurnTime.hidden = !visible;
  if (!visible) {
    els.sessionTurnTime.textContent = '';
    els.sessionTurnTime.title = '';
    els.sessionTurnTime.classList.remove('paused');
    return;
  }

  const paused = running && Boolean(timing?.pausedAt);
  els.sessionTurnTime.textContent = `⏱ 本轮 ${formatTotalTime(elapsed)}${
    paused ? ' · 等待中' : ''
  }`;
  els.sessionTurnTime.classList.toggle('paused', paused);
  els.sessionTurnTime.title = paused
    ? '等待你确认权限/回答问题/审批计划，计时暂停'
    : running
      ? '从你发出这条消息开始计时，不跨回合累计'
      : '本轮已完成，显示这一回合的总用时';
}

async function loadLastTurn(sessionId, key, token) {
  if (!sessionId || state.turnTimingByKey.has(key)) return;
  try {
    const result = await window.desk.getLastTurn(sessionId);
    const duration = Number(result?.turn?.durationMs) || 0;
    if (!result?.ok || duration <= 0) return;
    if (state.turnTimingByKey.has(key)) return;
    if (key === state.activeKey && state.running) return;
    state.turnTimingByKey.set(key, lastTurnTiming(duration));
    if (key === state.activeKey && (token == null || token === state.switchToken)) {
      updateTurnTimeDisplay();
    }
  } catch (error) {
    console.warn('读取上一回合用时失败:', error);
  }
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
  updateTurnTimeDisplay();
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
  updateTurnTimeDisplay();
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
  updateTurnTimeDisplay();
}

/** 把还没拿到结果的工具卡片标成已中断。 */
function markUnfinishedTools() {
  const groups = new Set();
  for (const entry of state.toolCards.values()) {
    if (entry.group) groups.add(entry.group);
    if (entry.hasResult) continue;
    entry.status.className = 'tool-status error';
    entry.status.textContent = '已中断';
  }
  for (const group of groups) updateToolGroup(group);
}

/** 会话没给出完成结果就结束了：提示用户，并标记未完成的工具。 */
function handleUnexpectedEnd() {
  finalizeStream();
  clearInsertBadges();
  finishTurnTiming(state.activeKey);
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
  scheduleSessionRefresh(sessionId);
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
      // 新会话第一次跑完后才会出现在会话列表里，后台会话也要自动重试刷新
      const sessionId = state.keyToSession.get(key);
      if (sessionId) scheduleSessionRefresh(sessionId);
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
  updateTurnTimeDisplay();
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

async function changePermissionMode(mode) {
  if (
    mode === 'bypassPermissions' &&
    !window.confirm('「完全访问权限」会让 Claude 无需确认即可访问互联网和电脑上的任何文件，确定开启吗？')
  ) {
    return;
  }
  const key = state.activeKey;
  const selected = permissionModeInfo(mode).value;
  els.permissionMenu.hidden = true;

  // 先让后端切换成功，再提交 UI；失败时界面和持久化都保持原样
  if (key && state.startedKeys.has(key)) {
    let result;
    try {
      result = await window.desk.setPermissionMode({ key, mode: selected });
    } catch (error) {
      result = { ok: false, error: error?.message || String(error) };
    }
    if (!result?.ok) {
      showError(result?.error || '切换权限模式失败');
      return;
    }
  }
  if (key) state.modeByKey.set(key, selected);
  state.permissionMode = selected;
  if (state.activeKey === key) renderPermissionMode(selected);
  else renderPermissionMode(state.modeByKey.get(state.activeKey) || state.permissionMode);
  await window.desk.saveSettings({ permissionMode: selected });
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

function applyShortcutTip() {
  const tip = document.getElementById('quick-tip');
  if (!tip) return;
  tip.textContent =
    state.platform === 'darwin'
      ? 'Cmd + Shift + Space 快速提问'
      : 'Ctrl + Alt + Space 快速提问';
}

function toggleSessionSearch(show) {
  const next = typeof show === 'boolean' ? show : els.sessionSearchWrap.hidden;
  els.sessionSearchWrap.hidden = !next;
  els.searchSessions.classList.toggle('active', next);
  if (next) {
    els.sessionSearch.focus();
    els.sessionSearch.select();
    return;
  }
  if (state.searchQuery) {
    state.searchQuery = '';
    els.sessionSearch.value = '';
    renderSessionGroups();
  }
}

function switchSettingsTab(tab) {
  if (tab === 'usage') tab = 'general';
  state.settingsTab = tab;
  for (const button of document.querySelectorAll('.settings-tab')) {
    button.classList.toggle('active', button.dataset.settingsTab === tab);
  }
  for (const panel of document.querySelectorAll('.settings-panel')) {
    panel.hidden = panel.dataset.settingsPanel !== tab;
  }
  if (tab === 'provider') {
    setFormError(els.providerFormError, '');
    if (!state.providersLoaded) refreshProviders();
    refreshPricingStatus();
  }
  if (tab === 'mcp') {
    setFormError(els.mcpFormError, '');
    refreshMcp();
  }
  if (tab === 'skills') {
    setFormError(els.skillFormError, '');
    refreshSkills();
  }
}

function resetConversation() {
  saveDraft(state.activeKey);
  state.switchToken += 1;
  state.interruptRequested = false;
  state.stoppingKey = null;
  state.stopNoticeShown = false;
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
        <span id="quick-tip">Ctrl + Alt + Space 快速提问</span>
      </div>
    </div>`;
  applyShortcutTip();
  state.streamEl = null;
  state.toolCards.clear();
  state.toolGroup = null;
  state.thinkingGroup = null;
  clearPlanDock();
  state.planCards.clear();
  state.sessionId = null;
  state.sessionActive = false;
  state.activeKey = null;
  state.awaitingUser = false;
  state.replaying = false;
  state.pendingEvents = [];
  state.historyView = null;
  state.preCompactView = null;
  state.renderTarget = null;
  state.compacting = false;
  state.commands = [];
  state.mcpStatus = {};
  restoreDraft(null);
  renderPermissionMode(state.permissionMode);
  clearActivity();
  hideSlashPalette();
  updateSessionTitle('');
  setRunning(false);
  clearError();
}

/* ---------------- 会话操作 ---------------- */

const SESSIONS_CACHE_MS = 1500;
const SESSION_REFRESH_DELAYS = [300, 1000, 2500, 5000];
const sessionRefreshTimers = new Map();

/** 新会话的 transcript 可能稍晚才被 listSessions 看到，短间隔重试直到出现在左侧。 */
function scheduleSessionRefresh(sessionId) {
  if (!sessionId || state.sessions.some((session) => session.sessionId === sessionId)) return;
  if (sessionRefreshTimers.has(sessionId)) return;

  const attempt = (index) => {
    if (state.sessions.some((session) => session.sessionId === sessionId)) {
      const timer = sessionRefreshTimers.get(sessionId);
      if (timer) clearTimeout(timer);
      sessionRefreshTimers.delete(sessionId);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        await refreshSessions(true);
      } catch {
        /* 下一轮再试 */
      }
      if (state.sessions.some((session) => session.sessionId === sessionId)) {
        sessionRefreshTimers.delete(sessionId);
        return;
      }
      if (index + 1 < SESSION_REFRESH_DELAYS.length) attempt(index + 1);
      else sessionRefreshTimers.delete(sessionId);
    }, SESSION_REFRESH_DELAYS[index]);
    sessionRefreshTimers.set(sessionId, timer);
  };

  attempt(0);
}

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
    for (const [sessionId, timer] of [...sessionRefreshTimers]) {
      if (state.sessions.some((session) => session.sessionId === sessionId)) {
        clearTimeout(timer);
        sessionRefreshTimers.delete(sessionId);
      }
    }
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
    if (group.pinned) {
      header.dataset.dirTone = 'pinned';
    } else {
      const tone = toneForDir(group.dir);
      if (tone) header.dataset.dirTone = tone;
    }

    const label = document.createElement('span');
    label.className = 'group-label';
    label.append(createGroupIcon(group.pinned ? 'star' : 'folder'));

    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = group.name;

    label.appendChild(name);
    header.append(label);

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
    if (server.scope === 'user') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost-button small-button danger mcp-remove';
      remove.textContent = '删除';
      remove.addEventListener('click', () => removeMcp(server.name));
      row.appendChild(remove);
    }
    els.mcpList.appendChild(row);
  }
}

/* ---------------- 供应商与用量 ---------------- */

function formatCost(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const num = Number(value);
  if (num === 0) return '$0';
  if (num < 0.0001) return '<$0.0001';
  return `$${num.toFixed(num < 0.01 ? 4 : 2)}`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatSpeed(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(1)} tok/s`;
}

function formatMs(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const num = Number(value);
  return num >= 1000 ? `${(num / 1000).toFixed(1)}s` : `${Math.round(num)}ms`;
}

function formatClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function setFormError(element, message) {
  element.hidden = !message;
  element.textContent = message || '';
}

function renderPricingStatus(status) {
  if (!status || !els.pricingStatus) return;
  state.pricingStatus = status;
  const deepseek = status.deepseek || {};
  const slotLabel = deepseek.label || (deepseek.slot === 'peak' ? '高峰（全价）' : '空闲（5 折）');
  const synced = status.fetchedAt
    ? `models.dev ${status.count} 个模型 · ${formatClock(status.fetchedAt)}`
    : 'models.dev 未同步（使用内置 DeepSeek 价格）';
  const error = status.lastError ? ` · 同步失败：${String(status.lastError).slice(0, 100)}` : '';
  els.pricingStatus.textContent = `模型价格：自动 · ${synced} · DeepSeek 当前${slotLabel}${error}`;
  if (els.providerPricingHint) {
    els.providerPricingHint.textContent =
      '价格自动获取，不用手填。DeepSeek Flash 高峰：输入 $0.30 / 缓存命中 $0.006 / 输出 $1.20；Pro：$1.32 / $0.044 / $3.96（每百万 tokens）。空闲时段全部 5 折；高峰为周一至周五 09:00–12:00、14:00–18:00（北京时间），周末和法定节假日空闲。' +
      `当前：${slotLabel}。`;
  }
}

async function refreshPricingStatus() {
  try {
    const result = await window.desk.pricingStatus();
    if (result?.ok) renderPricingStatus(result.status);
  } catch {
    /* 价格状态失败不影响供应商操作 */
  }
}

async function syncPricingNow() {
  if (!els.pricingSync || els.pricingSync.disabled) return;
  els.pricingSync.disabled = true;
  els.pricingSync.textContent = '同步中…';
  try {
    const result = await window.desk.syncPricing();
    if (result?.status) renderPricingStatus(result.status);
    if (!result?.ok) {
      els.pricingStatus.textContent = `价格同步失败：${result?.error || '未知错误'}（DeepSeek 内置价格仍可用）`;
    }
  } catch (error) {
    els.pricingStatus.textContent = `价格同步失败：${error?.message || error}（DeepSeek 内置价格仍可用）`;
  } finally {
    els.pricingSync.disabled = false;
    els.pricingSync.textContent = '同步价格';
  }
}

function renderProviders() {
  const { profiles, activeId } = state.providers;

  const select = els.providerActiveSelect;
  select.innerHTML = '';
  const systemOption = document.createElement('option');
  systemOption.value = '';
  systemOption.textContent = '系统 / CC Switch（跟随本机 ~/.claude）';
  select.appendChild(systemOption);
  for (const profile of profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    select.appendChild(option);
  }
  select.value = activeId || '';

  els.providerList.innerHTML = '';
  if (profiles.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = '还没有自定义供应商。默认跟随本机 Claude Code / CC Switch 的配置。';
    els.providerList.appendChild(hint);
    return;
  }

  for (const profile of profiles) {
    const card = document.createElement('div');
    card.className = `provider-card${profile.id === activeId ? ' active' : ''}`;

    const head = document.createElement('div');
    head.className = 'provider-card-head';
    const name = document.createElement('span');
    name.className = 'provider-name';
    name.textContent = profile.name;
    head.appendChild(name);

    if (profile.id === activeId) {
      const badge = document.createElement('span');
      badge.className = 'provider-badge active';
      badge.textContent = '使用中';
      head.appendChild(badge);
    }
    if (!profile.hasKey) {
      const badge = document.createElement('span');
      badge.className = 'provider-badge warning';
      badge.textContent = '未保存 Key';
      head.appendChild(badge);
    }

    const actions = document.createElement('span');
    actions.className = 'provider-card-actions';
    if (profile.id !== activeId) {
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'ghost-button small-button';
      use.textContent = '使用';
      use.addEventListener('click', () => activateProvider(profile.id));
      actions.appendChild(use);
    }
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'ghost-button small-button';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => openProviderForm(profile));
    actions.appendChild(edit);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost-button small-button danger';
    remove.textContent = '删除';
    remove.addEventListener('click', () => deleteProvider(profile));
    actions.appendChild(remove);
    head.appendChild(actions);
    card.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'provider-meta';
    meta.textContent = `${profile.baseUrl} · ${
      profile.authMode === 'apiKey' ? 'API Key' : 'Bearer Token'
    }`;
    card.appendChild(meta);

    const models = Object.entries(profile.models || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(' · ');
    if (models) {
      const modelLine = document.createElement('div');
      modelLine.className = 'provider-meta';
      modelLine.textContent = `模型映射：${models}`;
      card.appendChild(modelLine);
    }

    const priceLine = document.createElement('div');
    priceLine.className = 'provider-meta';
    priceLine.textContent = `成本价格：自动匹配（DeepSeek 官方峰谷 / models.dev）${
      Number(profile.costMultiplier) !== 1 ? ` · 倍率 ${profile.costMultiplier}` : ''
    }`;
    card.appendChild(priceLine);

    els.providerList.appendChild(card);
  }
}

async function refreshProviders() {
  try {
    const result = await window.desk.listProviders();
    if (!result?.ok) throw new Error(result?.error || '读取供应商失败');
    state.providers = {
      activeId: result.activeId || '',
      profiles: Array.isArray(result.profiles) ? result.profiles : [],
    };
    state.providersLoaded = true;
    renderProviders();
  } catch (error) {
    els.providerList.innerHTML = '';
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = `读取供应商失败：${error?.message || error}`;
    els.providerList.appendChild(hint);
  }
}

function openProviderForm(profile = null) {
  state.providerEditingId = profile?.id || null;
  els.providerForm.hidden = false;
  els.providerFormTitle.textContent = profile ? '编辑供应商' : '新增供应商';
  els.providerName.value = profile?.name || '';
  els.providerBaseUrl.value = profile?.baseUrl || '';
  els.providerAuthMode.value = profile?.authMode || 'authToken';
  els.providerKey.value = '';
  els.providerKey.placeholder = profile?.hasKey
    ? '已保存 Key，留空保持不变'
    : '填写 API Key';
  els.providerClearKey.checked = false;
  els.providerModelOpus.value = profile?.models?.opus || '';
  els.providerModelSonnet.value = profile?.models?.sonnet || '';
  els.providerModelHaiku.value = profile?.models?.haiku || '';
  els.providerModelFable.value = profile?.models?.fable || '';
  els.providerMultiplier.value = profile?.costMultiplier ?? 1;
  renderPricingStatus(state.pricingStatus);
  setFormError(els.providerFormError, '');
  els.providerForm.scrollIntoView({ block: 'nearest' });
}

function closeProviderForm() {
  els.providerForm.hidden = true;
  state.providerEditingId = null;
  setFormError(els.providerFormError, '');
}

function applyDeepSeekPreset() {
  els.providerName.value = 'DeepSeek';
  els.providerBaseUrl.value = 'https://api.deepseek.com/anthropic';
  els.providerAuthMode.value = 'authToken';
  els.providerModelOpus.value = 'deepseek-flash';
  els.providerModelSonnet.value = 'deepseek-flash';
  els.providerModelHaiku.value = 'deepseek-flash';
  els.providerModelFable.value = '';
  setFormError(els.providerFormError, '');
}

async function saveProviderForm(event) {
  event.preventDefault();
  const profile = {
    id: state.providerEditingId || undefined,
    name: els.providerName.value.trim(),
    baseUrl: els.providerBaseUrl.value.trim(),
    authMode: els.providerAuthMode.value,
    models: {
      opus: els.providerModelOpus.value.trim(),
      sonnet: els.providerModelSonnet.value.trim(),
      haiku: els.providerModelHaiku.value.trim(),
      fable: els.providerModelFable.value.trim(),
    },
    costMultiplier: Number(els.providerMultiplier.value) || 1,
  };
  setFormError(els.providerFormError, '');
  try {
    const result = await window.desk.saveProvider({
      profile,
      key: els.providerKey.value,
      clearKey: els.providerClearKey.checked,
    });
    if (!result?.ok) throw new Error(result?.error || '保存失败');
    closeProviderForm();
    await refreshProviders();
    appendNotice(`供应商「${result.profile?.name || profile.name}」已保存。新启动的会话生效。`);
  } catch (error) {
    setFormError(els.providerFormError, error?.message || String(error));
  }
}

async function activateProvider(id) {
  try {
    const result = await window.desk.activateProvider(id);
    if (!result?.ok) throw new Error(result?.error || '切换失败');
    state.providers = {
      activeId: result.activeId || '',
      profiles: Array.isArray(result.profiles) ? result.profiles : state.providers.profiles,
    };
    renderProviders();
    appendNotice(
      id
        ? '已切换供应商。新启动或恢复的会话会使用它。'
        : '已切回系统 / CC Switch 配置。新启动或恢复的会话生效。'
    );
  } catch (error) {
    els.providerActiveSelect.value = state.providers.activeId || '';
    showError(error?.message || String(error));
  }
}

async function deleteProvider(profile) {
  if (!window.confirm(`删除供应商「${profile.name}」？已保存的 API Key 也会删除。`)) return;
  try {
    const result = await window.desk.removeProvider(profile.id);
    if (!result?.ok) throw new Error(result?.error || '删除失败');
    state.providers = {
      activeId: result.activeId || '',
      profiles: Array.isArray(result.profiles) ? result.profiles : [],
    };
    renderProviders();
  } catch (error) {
    showError(error?.message || String(error));
  }
}

function renderUsageCards(summary) {
  els.usageCards.innerHTML = '';
  const cards = [
    {
      label: '总成本',
      title:
        '自定义供应商按自动价格（DeepSeek 官方峰谷 / models.dev）；系统 / CC Switch 使用 SDK 估算；未匹配到价格时显示 —',
      value: formatCost(summary.costUsd),
      sub:
        summary.requests > 0 && summary.costEntries < summary.requests
          ? `${summary.costEntries}/${summary.requests} 条有价格`
          : '',
    },
    {
      label: '请求数',
      title: 'ClaudeDesk 内完成的对话回合数',
      value: String(summary.requests),
      sub: '对话回合',
    },
    {
      label: '真实 tokens',
      title: '输入 + 输出 + 缓存读 + 缓存写，包含子代理',
      value: formatTokenCount(summary.tokens),
      sub: '输入+输出+缓存',
    },
    {
      label: '缓存命中率',
      title: '缓存读 /（输入 + 缓存读 + 缓存写）',
      value: formatPercent(summary.cacheHitRate),
      sub: '缓存读 / 提示 tokens',
    },
    {
      label: '平均首字',
      title: '首 token 延迟的平均值',
      value: formatMs(summary.avgTtftMs),
      sub: '首 token 延迟',
    },
    {
      label: '生成速度',
      title: '输出 tokens /（总耗时 - 首字耗时）',
      value: formatSpeed(summary.speed),
      sub: '输出 tokens / 秒',
    },
  ];
  for (const card of cards) {
    const node = document.createElement('div');
    node.className = 'usage-card';
    node.title = card.title;
    const label = document.createElement('span');
    label.className = 'usage-card-label';
    label.textContent = card.label;
    label.title = card.title;
    const value = document.createElement('strong');
    value.className = 'usage-card-value';
    value.textContent = card.value;
    value.title = card.title;
    const sub = document.createElement('span');
    sub.className = 'usage-card-sub';
    sub.textContent = card.sub;
    sub.title = card.title;
    node.append(label, value, sub);
    els.usageCards.appendChild(node);
  }
}

function renderUsageEntries(entries) {
  els.usageTableBody.innerHTML = '';
  els.usageEmpty.hidden = entries.length > 0;
  els.usageEmpty.textContent = '这个时间范围内还没有用量记录。';

  for (const entry of entries) {
    const tr = document.createElement('tr');
    const cells = [
      formatClock(entry.t),
      entry.provider || '—',
      entry.model || '—',
      formatCost(entry.costUsd),
      formatTokenCount(entry.input),
      formatTokenCount(entry.output),
      formatTokenCount(entry.cacheRead),
      formatTokenCount(entry.cacheWrite),
      formatPercent(
        entry.input + entry.cacheRead + entry.cacheWrite > 0
          ? entry.cacheRead / (entry.input + entry.cacheRead + entry.cacheWrite)
          : null
      ),
      formatSpeed(
        Number(entry.durationMs) > 0 && Number(entry.output) > 0
          ? entry.output /
              (Math.max(1, entry.durationMs - (Number(entry.ttftMs) || 0)) / 1000)
          : null
      ),
      formatMs(entry.ttftMs),
    ];
    for (const [index, text] of cells.entries()) {
      const td = document.createElement('td');
      td.textContent = text;
      if (index >= 3) td.className = 'num';
      td.title = text;
      if (index === 3 && entry.priceSource) {
        td.title =
          entry.priceSource === 'deepseek-official'
            ? `DeepSeek 官方价格 · ${entry.timeSlot === 'peak' ? '高峰全价' : '空闲 5 折'}`
            : entry.priceSource === 'models-dev'
              ? 'models.dev 自动价格'
              : entry.priceSource === 'legacy-manual'
                ? '旧版手动价格（兼容）'
                : 'SDK 成本估算';
      }
      tr.appendChild(td);
    }
    if (entry.ok === false) tr.classList.add('usage-failed');
    if (entry.partial) {
      tr.title = '恢复会话后的第一回合：只统计主对话 tokens，子代理用量可能未计入';
      const mark = document.createElement('span');
      mark.className = 'usage-partial-mark';
      mark.textContent = '*';
      tr.firstChild.appendChild(mark);
    }
    els.usageTableBody.appendChild(tr);
  }
}

function usageDateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function ensureUsageCustomDates() {
  if (els.usageStart.value && els.usageEnd.value) return;
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  if (!els.usageStart.value) els.usageStart.value = usageDateValue(start);
  if (!els.usageEnd.value) els.usageEnd.value = usageDateValue(end);
}

function usageCustomBounds() {
  const startValue = els.usageStart.value;
  const endValue = els.usageEnd.value;
  if (!startValue || !endValue) throw new Error('请选择开始和结束日期');
  const startParts = startValue.split('-').map(Number);
  const endParts = endValue.split('-').map(Number);
  const start = new Date(startParts[0], startParts[1] - 1, startParts[2], 0, 0, 0, 0).getTime();
  const end = new Date(endParts[0], endParts[1] - 1, endParts[2], 23, 59, 59, 999).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error('结束日期不能早于开始日期');
  }
  return { start, end };
}

async function refreshUsage(range = state.usageRange) {
  state.usageRange = range;
  const custom = range === 'custom';
  const requestId = ++state.usageRequest;
  for (const button of els.usageRange.querySelectorAll('.range-button')) {
    button.classList.toggle('active', button.dataset.range === range);
  }
  els.usageCustomRange.hidden = !custom;
  setFormError(els.usageCustomError, '');

  let payload = { range };
  if (custom) {
    ensureUsageCustomDates();
    try {
      const { start, end } = usageCustomBounds();
      payload = { range: 'custom', start, end };
    } catch (error) {
      const message = error?.message || String(error);
      setFormError(els.usageCustomError, message);
      els.usageCards.innerHTML = '';
      els.usageTableBody.innerHTML = '';
      els.usageEmpty.hidden = false;
      els.usageEmpty.textContent = `无法读取用量：${message}`;
      return;
    }
  }

  els.usageEmpty.hidden = true;
  els.usageCards.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'empty-hint';
  loading.textContent = '正在读取用量…';
  els.usageCards.appendChild(loading);

  try {
    const result = await window.desk.usageStats(payload);
    if (requestId !== state.usageRequest) return;
    if (!result?.ok) throw new Error(result?.error || '读取失败');
    renderUsageCards(result.summary);
    renderUsageEntries(Array.isArray(result.entries) ? result.entries : []);
  } catch (error) {
    if (requestId !== state.usageRequest) return;
    els.usageCards.innerHTML = '';
    els.usageTableBody.innerHTML = '';
    els.usageEmpty.hidden = false;
    els.usageEmpty.textContent = `读取用量失败：${error?.message || error}`;
  }
}

function openUsageModal() {
  els.usageModal.hidden = false;
  refreshUsage(state.usageRange);
}

function closeUsageModal() {
  els.usageModal.hidden = true;
}

/* ---------------- MCP 新增/删除 ---------------- */

function toggleMcpForm(show) {
  const next = typeof show === 'boolean' ? show : els.mcpForm.hidden;
  els.mcpForm.hidden = !next;
  if (next) {
    setFormError(els.mcpFormError, '');
    els.mcpName.focus();
  }
}

function syncMcpTypeFields() {
  const remote = els.mcpType.value !== 'stdio';
  els.mcpStdioFields.hidden = remote;
  els.mcpRemoteFields.hidden = !remote;
}

function parseEnvLines(text) {
  const env = {};
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) throw new Error(`环境变量格式不对：${trimmed.slice(0, 40)}`);
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1);
  }
  return env;
}

async function addMcpFromForm(event) {
  event.preventDefault();
  setFormError(els.mcpFormError, '');
  try {
    const type = els.mcpType.value;
    const payload = {
      name: els.mcpName.value.trim(),
      type,
    };
    if (type === 'stdio') {
      payload.command = els.mcpCommand.value.trim();
      payload.args = els.mcpArgs.value
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean);
      payload.env = parseEnvLines(els.mcpEnv.value);
    } else {
      payload.url = els.mcpUrl.value.trim();
      payload.headers = parseEnvLines(els.mcpHeaders.value);
    }
    const result = await window.desk.addMcp(payload);
    if (!result?.ok) throw new Error(result?.error || '添加失败');
    els.mcpForm.reset();
    els.mcpType.value = 'stdio';
    syncMcpTypeFields();
    toggleMcpForm(false);
    await refreshMcp();
    appendNotice(`MCP「${result.name}」已添加。重启会话后生效。`);
  } catch (error) {
    setFormError(els.mcpFormError, error?.message || String(error));
  }
}

async function removeMcp(name) {
  if (!window.confirm(`删除 MCP「${name}」？会修改 ~/.claude.json。`)) return;
  try {
    const result = await window.desk.removeMcp(name);
    if (!result?.ok) throw new Error(result?.error || '删除失败');
    await refreshMcp();
    appendNotice(`MCP「${name}」已删除。`);
  } catch (error) {
    showError(error?.message || String(error));
  }
}

/* ---------------- 技能管理 ---------------- */

async function refreshSkills() {
  els.skillsList.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'empty-hint';
  loading.textContent = '正在读取技能…';
  els.skillsList.appendChild(loading);
  try {
    const result = await window.desk.listSkills();
    if (!result?.ok) throw new Error(result?.error || '读取技能失败');
    els.skillsRootLabel.textContent = result.root ? `安装位置：${result.root}` : '';
    els.skillsList.innerHTML = '';
    if (!result.skills || result.skills.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = '还没有安装技能。填入 GitHub 仓库地址即可从仓库安装。';
      els.skillsList.appendChild(hint);
      return;
    }
    for (const skill of result.skills) {
      const row = document.createElement('div');
      row.className = 'skill-item';
      const main = document.createElement('div');
      main.className = 'skill-main';
      const name = document.createElement('span');
      name.className = 'skill-name';
      name.textContent = skill.name;
      const description = document.createElement('span');
      description.className = 'skill-description';
      description.textContent = skill.description || '（没有描述）';
      const path = document.createElement('span');
      path.className = 'skill-path';
      path.textContent = skill.path;
      path.title = skill.path;
      main.append(name, description, path);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost-button small-button danger';
      remove.textContent = '删除';
      remove.addEventListener('click', () => deleteSkill(skill));
      row.append(main, remove);
      els.skillsList.appendChild(row);
    }
  } catch (error) {
    els.skillsList.innerHTML = '';
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = `读取技能失败：${error?.message || error}`;
    els.skillsList.appendChild(hint);
  }
}

async function installSkillFromForm(event) {
  event.preventDefault();
  setFormError(els.skillFormError, '');
  const repoUrl = els.skillRepo.value.trim();
  if (!repoUrl) {
    setFormError(els.skillFormError, '请填写 GitHub 仓库地址');
    return;
  }
  els.skillInstall.disabled = true;
  els.skillInstall.textContent = '克隆并安装…';
  try {
    const result = await window.desk.addSkill({
      repoUrl,
      subpath: els.skillSubpath.value.trim(),
    });
    if (!result?.ok) throw new Error(result?.error || '安装失败');
    els.skillForm.reset();
    await refreshSkills();
    appendNotice(`技能「${result.name}」已安装。重启会话后生效。`);
  } catch (error) {
    setFormError(els.skillFormError, error?.message || String(error));
  } finally {
    els.skillInstall.disabled = false;
    els.skillInstall.textContent = '安装技能';
  }
}

async function deleteSkill(skill) {
  if (!window.confirm(`删除技能「${skill.name}」？这会删除 ${skill.path}。`)) return;
  try {
    const result = await window.desk.removeSkill(skill.name);
    if (!result?.ok) throw new Error(result?.error || '删除失败');
    await refreshSkills();
  } catch (error) {
    showError(error?.message || String(error));
  }
}

/* ---------------- 运行环境自检 ---------------- */

const ENV_LEVEL_LABEL = { required: '必需', recommended: '建议', optional: '可选' };
const ENV_DOT_CLASS = {
  ok: 'connected',
  warning: 'pending',
  missing: 'failed',
  error: 'failed',
  unknown: '',
};

function renderEnvItem(item) {
  const row = document.createElement('div');
  row.className = 'mcp-item env-item';

  const dot = document.createElement('span');
  dot.className = `mcp-status${
    ENV_DOT_CLASS[item.status] ? ` ${ENV_DOT_CLASS[item.status]}` : ''
  }`;
  dot.title = item.detail || '';

  const name = document.createElement('span');
  name.className = 'mcp-name';
  name.textContent = item.label;

  const level = document.createElement('span');
  level.className = 'mcp-scope';
  level.textContent = ENV_LEVEL_LABEL[item.level] || '';

  const version = document.createElement('span');
  version.className = 'env-version';
  version.textContent = item.version || '';

  row.append(dot, name, level, version);

  if (Array.isArray(item.actions) && item.actions.length > 0) {
    const actions = document.createElement('span');
    actions.className = 'env-actions';
    for (const action of item.actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost-button env-action';
      button.textContent = action.label || '处理';
      button.addEventListener('click', () => runEnvAction(action, button));
      actions.appendChild(button);
    }
    row.appendChild(actions);
  }

  const detail = document.createElement('span');
  detail.className = 'env-detail';
  detail.textContent = item.detail || '';
  row.appendChild(detail);

  els.envList.appendChild(row);
}

function renderEnvStatus(result) {
  els.envList.innerHTML = '';
  els.envSummary.className = `env-summary ${result.summary.level}`;
  els.envSummary.textContent = result.summary.text;

  renderEnvItem(result.auth);
  for (const item of result.components) renderEnvItem(item);

  const notes = Array.isArray(result.summary.notes) ? result.summary.notes : [];
  els.envNote.hidden = notes.length === 0;
  els.envNote.textContent = notes.join('；');
  els.envCheckedAt.textContent = `检查于 ${new Date(result.checkedAt).toLocaleTimeString(
    'zh-CN',
    { hour12: false }
  )}`;
}

async function refreshEnvStatus() {
  if (state.envLoading) return;
  state.envLoading = true;
  els.envRefresh.disabled = true;
  els.envSummary.className = 'env-summary';
  els.envSummary.textContent = '正在检查运行环境…';
  els.envCheckedAt.textContent = '';
  els.envNote.hidden = true;

  try {
    const result = await window.desk.envStatus();
    if (!result?.ok) throw new Error(result?.error || '检查失败');
    renderEnvStatus(result);
  } catch (error) {
    els.envSummary.className = 'env-summary error';
    els.envSummary.textContent = `检查失败：${error?.message || error}`;
    els.envList.innerHTML = '';
  } finally {
    state.envLoading = false;
    els.envRefresh.disabled = false;
  }
}

async function runEnvAction(action, button) {
  button.disabled = true;
  els.envNote.hidden = false;
  els.envNote.textContent = '正在执行…';
  try {
    const result = await window.desk.envAction(action.id);
    if (!result?.ok) {
      els.envNote.textContent = result?.error || '操作失败';
      return;
    }
    els.envNote.textContent = result.message || '已完成';
    if (result.kind === 'launch') setTimeout(refreshEnvStatus, 2000);
  } catch (error) {
    els.envNote.textContent = `操作失败：${error?.message || error}`;
  } finally {
    button.disabled = false;
  }
}

/* ---------------- 全局工作规范 ---------------- */

function isGlobalRulesDirty() {
  return els.globalRulesText.value !== state.globalRulesLoadedContent;
}

async function loadGlobalRules() {
  if (state.globalRulesLoading) return;
  state.globalRulesLoading = true;
  els.globalRulesText.disabled = true;
  els.globalRulesStatus.textContent = '正在加载…';
  try {
    const result = await window.desk.getGlobalRules();
    if (!result?.ok) throw new Error(result?.error || '读取失败');
    els.globalRulesText.value = result.content || '';
    state.globalRulesLoadedContent = els.globalRulesText.value;
    els.globalRulesStatus.textContent = result.exists
      ? '已加载'
      : '文件不存在，保存后会创建';
  } catch (error) {
    els.globalRulesStatus.textContent = `加载失败：${error?.message || error}`;
  } finally {
    state.globalRulesLoading = false;
    els.globalRulesText.disabled = false;
  }
}

async function saveGlobalRules() {
  const content = els.globalRulesText.value;
  if (content === state.globalRulesLoadedContent) {
    els.globalRulesStatus.textContent = '内容没有变化';
    return;
  }
  els.globalRulesSave.disabled = true;
  els.globalRulesStatus.textContent = '正在保存…';
  try {
    const result = await window.desk.saveGlobalRules(content);
    if (!result?.ok) throw new Error(result?.error || '保存失败');
    state.globalRulesLoadedContent = content;
    els.globalRulesStatus.textContent = result.backup
      ? '已保存（旧版本备份在 CLAUDE.md.bak）'
      : '已保存';
  } catch (error) {
    els.globalRulesStatus.textContent = `保存失败：${error?.message || error}`;
  } finally {
    els.globalRulesSave.disabled = false;
  }
}

function canCloseSettings() {
  if (!isGlobalRulesDirty()) return true;
  return window.confirm('全局规范还有未保存的修改，确定关闭吗？');
}

function reloadGlobalRules() {
  if (isGlobalRulesDirty() && !window.confirm('放弃未保存的修改并重新加载？')) return;
  loadGlobalRules();
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
  state.mcpByKey.delete(key);
  state.modeByKey.delete(key);
  state.lastStderrByKey.delete(key);
  state.activityByKey.delete(key);
  state.turnTimingByKey.delete(key);
  dropHistory(sessionId);
  dropDraft(key);
  clearPrompts(key);
  if (state.activeKey === key) {
    state.activeKey = null;
    state.sessionActive = false;
    state.preCompactView = null;
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

function addPreCompactLoader(sessionId) {
  if (!sessionId || state.preCompactView) return;
  if (els.messages.querySelector('.precompact-loader')) return;
  const summary = [...els.messages.querySelectorAll('.compact-summary')]
    .filter((item) => !item.closest('.precompact-history'))
    .pop();
  if (!summary) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'precompact-loader';
  button.textContent = '加载压缩前记录';
  button.title = '从本地 transcript 读取压缩前的消息';
  button.addEventListener('click', () => openPreCompactHistory(sessionId, button));
  summary.insertAdjacentElement('afterend', button);
}

function renderPreCompactMessages(messages, sessionId, listEl, prepend) {
  if (!Array.isArray(messages) || messages.length === 0) return;
  flushThinking();
  closeToolGroup();
  const fragment = document.createDocumentFragment();
  state.renderTarget = fragment;
  try {
    renderHistoryRange(messages, sessionId, 0, messages.length);
  } finally {
    state.renderTarget = null;
  }
  closeToolGroup();
  if (prepend) listEl.prepend(fragment);
  else listEl.appendChild(fragment);
}

async function openPreCompactHistory(sessionId, button) {
  if (state.running) {
    showError('请先等本轮结束后再加载压缩前记录');
    return;
  }
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = '正在读取压缩前记录…';

  let result;
  try {
    result = await window.desk.getPreCompactHistory({
      sessionId,
      offset: 0,
      limit: 100,
    });
  } catch (error) {
    button.textContent = `读取失败：${error?.message || error}`;
    return;
  }
  if (sessionId !== state.sessionId) return;
  if (!result?.ok || !result.available || !result.total) {
    button.textContent = '没有找到压缩前记录';
    button.disabled = true;
    button.title = '该会话可能来自远程存储，或本地 transcript 不含压缩前消息';
    return;
  }

  const head = document.createElement('summary');
  head.textContent = `压缩前记录 · 共 ${result.total} 条`;
  const note = document.createElement('div');
  note.className = 'precompact-note';
  note.textContent = '以下消息来自本地 transcript，位于上一次「上下文已压缩」之前。';
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'precompact-more';
  more.textContent = result.hasMore ? '加载更早的压缩前记录' : '已加载全部压缩前记录';
  more.hidden = !result.hasMore;
  more.disabled = !result.hasMore;
  const list = document.createElement('div');
  list.className = 'precompact-list';

  const details = document.createElement('details');
  details.className = 'precompact-history';
  details.open = true;
  details.append(head, note, more, list);

  const anchor = button.closest('.msg') || button.previousElementSibling;
  if (anchor) anchor.before(details);
  else els.messages.prepend(details);
  button.remove();

  state.preCompactView = {
    sessionId,
    offset: result.nextOffset,
    total: result.total,
    listEl: list,
    moreEl: more,
    headEl: head,
  };
  renderPreCompactMessages(result.messages, sessionId, list, false);
  more.addEventListener('click', () => loadMorePreCompact());
  requestAnimationFrame(() => details.scrollIntoView({ block: 'start' }));
}

async function loadMorePreCompact() {
  const view = state.preCompactView;
  if (!view || view.sessionId !== state.sessionId) return;
  if (state.running) {
    showError('请先等本轮结束后再加载压缩前记录');
    return;
  }
  if (view.moreEl.disabled || view.moreEl.hidden) return;
  view.moreEl.disabled = true;
  view.moreEl.textContent = '正在读取…';

  let result;
  try {
    result = await window.desk.getPreCompactHistory({
      sessionId: view.sessionId,
      offset: view.offset,
      limit: 100,
    });
  } catch (error) {
    view.moreEl.textContent = `读取失败：${error?.message || error}`;
    view.moreEl.disabled = false;
    return;
  }
  if (!view || view.sessionId !== state.sessionId) return;
  if (!result?.ok || !result.available || !result.messages?.length) {
    view.moreEl.textContent = '没有更多压缩前记录';
    view.moreEl.disabled = true;
    return;
  }

  renderPreCompactMessages(result.messages, view.sessionId, view.listEl, true);
  view.offset = result.nextOffset;
  view.total = result.total;
  view.headEl.textContent = `压缩前记录 · 共 ${result.total} 条`;
  view.moreEl.hidden = !result.hasMore;
  view.moreEl.disabled = !result.hasMore;
  view.moreEl.textContent = result.hasMore ? '加载更早的压缩前记录' : '已加载全部压缩前记录';
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

  const preCompact = els.messages.querySelector('.precompact-history');
  const sdkSummary = [...els.messages.querySelectorAll('.compact-summary')].find(
    (item) => !item.closest('.precompact-history')
  );
  const sdkSummaryWrap = sdkSummary?.closest('.msg');
  const fragmentHasSummary = Boolean(fragment.querySelector('.compact-summary'));
  if (fragmentHasSummary && sdkSummaryWrap) sdkSummaryWrap.before(fragment);
  else if (sdkSummaryWrap) sdkSummaryWrap.after(fragment);
  else if (preCompact) preCompact.after(fragment);
  else els.messages.insertBefore(fragment, els.messages.firstChild);
  view.start = from;
  // 插入后补回高度差，视口停在原来的位置
  els.messages.scrollTop += els.messages.scrollHeight - previousHeight;
  updateHistoryLoader();
  addPreCompactLoader(view.sessionId);
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
  addPreCompactLoader(sessionId);
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
  state.preCompactView = null;
  state.toolCards.clear();
  state.toolGroup = null;
  state.thinkingGroup = null;
  clearPlanDock();
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
    if (!state.turnTimingByKey.has(key)) {
      beginTurnTiming(key, state.activityStartedAt || performance.now());
    }
  }
  if (dir) setCwd(dir, true, false);
  updateSessionTitle(session.title);
  renderSessionGroups();

  // 恢复这个会话自己的 MCP 信息和权限模式
  state.mcpStatus = state.mcpByKey.get(key) || {};
  renderPermissionMode(state.modeByKey.get(key) || state.permissionMode);

  state.pendingEvents = [];
  state.replaying = true;
  const renderedUuids = new Set();
  let historyFailed = false;
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
    loadLastTurn(session.sessionId, key, token);
  } catch (error) {
    historyFailed = true;
    if (token === state.switchToken) {
      showError(`读取会话历史失败：${error?.message || error}`);
      setRunning(false);
      setSessionStatus(key, null);
      state.sessionActive = false;
      finishActivity('加载失败', 'error');
    }
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

  if (historyFailed || token !== state.switchToken) return;

  applyPendingPlans(key);
  recalcAwaitingUser();
  if (hasPendingPlan(key)) setActivity('等待你审批计划…');

  if (state.startedKeys.has(key)) {
    const focus = await window.desk.focusSession({ key });
    if (token !== state.switchToken) {
      if (state.activeKey) window.desk.focusSession({ key: state.activeKey });
      return;
    }
    // 后端已被空闲回收：清掉本地标记，下面会重新恢复
    if (focus && focus.attached === false) {
      state.startedKeys.delete(key);
      state.sessionActive = false;
    }
  }
  if (!state.startedKeys.has(key)) {
    if (token !== state.switchToken) return;
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
    // 恢复期间用户又切走了：关掉刚启动的后台会话，别把它留在后台
    if (token !== state.switchToken) {
      window.desk.closeSession({ key });
      if (state.activeKey) window.desk.focusSession({ key: state.activeKey });
      return;
    }
    if (!result?.ok) {
      setSessionStatus(key, null);
      if (key === state.activeKey) {
        setRunning(false);
        state.sessionActive = false;
        showError(result?.error || '恢复会话失败');
        if (state.activityLabel === '正在恢复会话…') finishActivity('恢复失败', 'error');
      }
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
    els.questionReview.hidden = true;
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
  recalcAwaitingUser();
  pauseTurnTiming(key);
  if (key === state.activeKey) setActivity('等待你确认权限…');
  else rememberActivity(key, '等待你确认权限…');
}

async function answerPermission(decision) {
  const entry = state.currentPermission;
  if (!entry) return;
  state.currentPermission = null;
  els.permModal.hidden = true;
  let result;
  try {
    result = await window.desk.respondPermission({
      key: entry.key,
      id: entry.request.id,
      decision,
    });
  } catch (error) {
    result = { ok: false, error: error?.message || String(error) };
  }
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
  if (!hasPendingPromptFor(entry.key)) resumeTurnTiming(entry.key);
  recalcAwaitingUser();
}

/* ---------------- 提问面板 ---------------- */

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
  setModalHeading(els.questionReview, 'Claude 想确认一下', key);
  els.questionReview.hidden = false;
  const active = document.activeElement;
  const canFocus =
    key === state.activeKey &&
    !els.input.value.trim() &&
    (active === document.body || active === els.input) &&
    els.settingsModal.hidden &&
    els.usageModal.hidden &&
    els.permModal.hidden;
  if (canFocus) {
    const firstOption = els.questionList.querySelector(
      'input[type="radio"], input[type="checkbox"]'
    );
    (firstOption || els.questionSkip).focus();
  }
  setSessionStatus(key, 'waiting');
  recalcAwaitingUser();
  pauseTurnTiming(key);
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
  els.questionReview.hidden = true;

  let result;
  try {
    result =
      Object.keys(answers).length > 0
        ? await window.desk.respondQuestion({ key, id: request.id, answers })
        : await window.desk.respondQuestion({
            key,
            id: request.id,
            response: '用户没有做出选择，请自行判断后继续。',
          });
  } catch (error) {
    result = { ok: false, error: error?.message || String(error) };
  }
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
  if (!hasPendingPromptFor(key)) resumeTurnTiming(key);
  recalcAwaitingUser();
}

async function skipQuestion() {
  const request = state.currentQuestion;
  if (!request) return;
  const key = request.__key;
  state.currentQuestion = null;
  els.questionReview.hidden = true;
  let result;
  try {
    result = await window.desk.respondQuestion({
      key,
      id: request.id,
      response: '用户跳过了这些问题，请自行判断后继续。',
    });
  } catch (error) {
    result = { ok: false, error: error?.message || String(error) };
  }
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
  if (!hasPendingPromptFor(key)) resumeTurnTiming(key);
  recalcAwaitingUser();
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

function hasPendingPromptFor(key) {
  if (!key) return false;
  return Boolean(
    state.currentPermission?.key === key ||
      state.currentQuestion?.__key === key ||
      state.permissionQueue.some((entry) => entry.key === key) ||
      state.questionQueue.some((request) => request.__key === key) ||
      hasPendingPlan(key)
  );
}

function recalcAwaitingUser() {
  state.awaitingUser = hasPendingPromptFor(state.activeKey);
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

function hidePlanDockIfEmpty() {
  if (els.planReview && els.planReview.childElementCount === 0) {
    els.planReview.hidden = true;
  }
}

function mountPlanCardToDock(record) {
  if (!record?.wrap || !els.planReview) return;
  if (record.wrap.parentElement !== els.planReview) {
    removeWelcome();
    els.planReview.appendChild(record.wrap);
  }
  els.planReview.hidden = false;
}

function restorePlanCard(record) {
  if (!record?.wrap) return;
  if (record.wrap.parentElement === els.planReview) {
    const eligible = record.key === state.activeKey && !state.closedKeys.has(record.key);
    if (eligible) appendEl(record.wrap);
    else record.wrap.remove();
  }
  hidePlanDockIfEmpty();
}

function clearPlanDock() {
  if (!els.planReview) return;
  while (els.planReview.firstChild) els.planReview.removeChild(els.planReview.firstChild);
  els.planReview.hidden = true;
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
  rejectBtn.textContent = '继续修改计划';
  rejectBtn.title = '告诉 Claude 想调整哪些步骤，保持计划模式';
  const approveBtn = document.createElement('button');
  approveBtn.type = 'button';
  approveBtn.className = 'primary-button';
  approveBtn.dataset.planAction = 'approve';
  approveBtn.textContent = '批准并开始实现';
  approveBtn.title = '批准整份计划，切换到默认权限并开始执行';
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
      rejectBtn.textContent = '发送修改意见';
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
      rejectBtn.textContent = '继续修改计划';
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

  if (wrap.parentElement !== els.planReview) appendEl(wrap);
  return record;
}

function attachPlanRequest(record, pendingRecord) {
  if (!pendingRecord || !record) return;
  const previousKey = record.planKey;
  if (pendingRecord.planKey && pendingRecord.planKey !== previousKey) {
    if (state.planCards.get(previousKey) === record) state.planCards.delete(previousKey);
    record.planKey = pendingRecord.planKey;
    record.wrap.dataset.planKey = record.planKey;
    record.card.dataset.planKey = record.planKey;
    state.planCards.set(record.planKey, record);
  }
  if (!record.toolUseId && pendingRecord.toolUseId) record.toolUseId = pendingRecord.toolUseId;
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
  record.rejectBtn.textContent = '继续修改计划';
  record.approveBtn.disabled = false;
  record.rejectBtn.disabled = false;
  if (record.key === state.activeKey && !state.replaying && !state.renderTarget) {
    mountPlanCardToDock(record);
  }
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
  pauseTurnTiming(key);
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

function markPlanExpired(record) {
  record.status = 'expired';
  record.statusEl.textContent = '已失效';
  record.statusEl.className = 'plan-inline-status expired';
  record.actions.hidden = true;
  record.feedbackWrap.hidden = true;
  restorePlanCard(record);
}

function expirePlanCard(record) {
  if (!record) return;
  if (record.status === 'submitting') {
    // 提交中的卡片等 IPC 返回后再落成“已失效”，不要让它变回“待批准”
    record.cancelled = true;
    return;
  }
  if (record.status !== 'pending') return;
  markPlanExpired(record);
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

  let result;
  try {
    result = await window.desk.respondPlan({
      key,
      id: request.id,
      decision,
      feedback: decision === 'reject' ? feedback : undefined,
    });
  } catch (error) {
    result = { ok: false, error: error?.message || String(error) };
  }

  const settleTiming = () => {
    if (!hasPendingPromptFor(key)) resumeTurnTiming(key);
    recalcAwaitingUser();
  };

  // 等待期间会话结束/被停止：按 IPC 结果落成“已批准/已失效”，不要变回“待批准”
  if (record.cancelled) {
    record.cancelled = false;
    if (result?.ok) {
      record.status = decision === 'approve' ? 'approved' : 'rejected';
      record.statusEl.textContent = decision === 'approve' ? '已批准' : '已拒绝';
      record.statusEl.className = `plan-inline-status ${
        decision === 'approve' ? 'approved' : 'rejected'
      }`;
      record.actions.hidden = true;
      record.feedbackWrap.hidden = true;
    } else {
      markPlanExpired(record);
    }
    restorePlanCard(record);
    settleTiming();
    return;
  }
  if (record.status === 'expired') {
    if (!result?.ok) showError(result?.error || '提交计划审批失败');
    restorePlanCard(record);
    settleTiming();
    return;
  }

  if (!result?.ok) {
    // respondPlan 失败只可能是会话已关闭或请求已结算，复活 pending 只会留下死卡
    markPlanExpired(record);
    showError(result?.error || '提交计划审批失败');
    settleTiming();
    return;
  }

  record.status = decision === 'approve' ? 'approved' : 'rejected';
  record.statusEl.textContent = decision === 'approve' ? '已批准' : '已拒绝';
  record.statusEl.className = `plan-inline-status ${
    decision === 'approve' ? 'approved' : 'rejected'
  }`;
  record.actions.hidden = true;
  record.feedbackWrap.hidden = true;
  restorePlanCard(record);

  if (decision === 'approve') {
    let switched = true;
    if (state.startedKeys.has(key)) {
      let modeResult;
      try {
        modeResult = await window.desk.setPermissionMode({ key, mode: 'default' });
      } catch (error) {
        modeResult = { ok: false, error: error?.message || String(error) };
      }
      switched = Boolean(modeResult?.ok);
      if (!switched) showError(modeResult?.error || '切换权限模式失败');
    }
    if (switched) {
      state.modeByKey.set(key, 'default');
      state.permissionMode = 'default';
      if (key === state.activeKey) renderPermissionMode('default');
      await window.desk.saveSettings({ permissionMode: 'default' });
    }
  }
  setSessionStatus(key, 'working');
  rememberActivity(key, '等待模型响应…');
  if (key === state.activeKey) setActivity('等待模型响应…');
  settleTiming();
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

/* ---------------- 发送 ---------------- */

function autosize() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 220)}px`;
}

const NEW_DRAFT_KEY = '__composer__';

/** 按会话保存输入框草稿（文字 + 附件），切走不串台。 */
function saveDraft(key) {
  const draftKey = key || NEW_DRAFT_KEY;
  const text = els.input.value;
  if (!text && state.attachments.length === 0) {
    state.drafts.delete(draftKey);
    return;
  }
  state.drafts.set(draftKey, {
    text,
    attachments: state.attachments.slice(),
    start: els.input.selectionStart ?? 0,
    end: els.input.selectionEnd ?? 0,
  });
}

function restoreDraft(key) {
  const draft = state.drafts.get(key || NEW_DRAFT_KEY);
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
  state.drafts.delete(key || NEW_DRAFT_KEY);
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
  const stopSeqAtSend = state.stopSeq;
  const newTurn = !state.running;
  if (newTurn) state.pendingTurnStartedAt = performance.now();
  state.sending = true;
  try {
    clearError();
    const sendKey = state.activeKey;
    const fromNewComposer = !sendKey && !state.sessionId;
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
      state.pendingTurnStartedAt = 0;
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
      state.pendingTurnStartedAt = 0;
      if (sendKey) setSessionStatus(sendKey, prevStatus || null);
      return;
    }
    // 启动/恢复期间用户点了停止：不要继续发送这条消息
    if (state.stopSeq !== stopSeqAtSend) {
      state.pendingTurnStartedAt = 0;
      if (sendKey) setSessionStatus(sendKey, prevStatus || null);
      return;
    }
    const key = state.activeKey;
    if (!key) {
      state.pendingTurnStartedAt = 0;
      return;
    }

    const steer = state.running;
    const content = buildMessageContent(text, attachments);
    if (!steer) {
      beginTurnTiming(key, state.pendingTurnStartedAt || performance.now());
    }
    state.pendingTurnStartedAt = 0;
    setRunning(true);
    state.interruptRequested = false;
    state.stopNoticeShown = false;
    state.stoppingKey = null;
    state.lastStderrByKey.delete(key);
    recalcAwaitingUser();
    setActivity('等待模型响应…');

    const result = await window.desk.send(text, { key, steer, content });
    if (!result?.ok) {
      // 用户在这期间点了停止并强制结束了会话：不要再覆盖成“发送失败”
      if (state.interruptRequested || state.stoppingKey || state.stopNoticeShown) {
        return;
      }
      // 发送失败时无论是否已切走，都要清掉这次发送留下的“工作中”状态
      if (!steer) clearTurnTiming(key);
      const stillBusy = prevStatus === 'working' || prevStatus === 'waiting';
      setSessionStatus(key, prevStatus || null);
      if (key === state.activeKey) {
        setRunning(stillBusy);
        if (!stillBusy) finishActivity('发送失败', 'error');
        showError(result?.error || '发送失败');
      }
      return;
    }

    // 新消息已经进入这个会话，历史缓存和草稿都作废
    dropHistory(state.keyToSession.get(key) || state.sessionId);
    dropDraft(key);
    if (fromNewComposer) dropDraft(null);
    if (key !== state.activeKey) return;
    // 旧回合的 result 可能在 send IPC 返回前到达；这里重新确认新一轮仍在运行
    setRunning(true);
    if (!state.awaitingUser && !state.activityStartedAt) setActivity('等待模型响应…');
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
  const key = state.activeKey;
  if (!key || state.stoppingKey === key) return;

  state.stoppingKey = key;
  state.stopSeq += 1;
  state.interruptRequested = true;
  clearPrompts(key);
  finishTurnTiming(key);

  // 立即给用户“已停止”的反馈，然后直接结束这个 CLI 进程；
  // 下一条消息会通过 resume 重新拉起会话。
  setRunning(false);
  state.startedKeys.delete(key);
  state.sessionActive = false;
  setSessionStatus(key, null);
  finishActivity('已停止生成', 'stopped');
  if (!state.stopNoticeShown) {
    appendNotice('已停止生成');
    state.stopNoticeShown = true;
  }

  try {
    await window.desk.closeSession({ key });
  } catch {
    /* 会话可能已经结束，忽略 */
  } finally {
    if (state.stoppingKey === key) state.stoppingKey = null;
    if (state.activeKey === key) {
      setRunning(false);
      state.sessionActive = false;
    }
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
    state.platform = initial.platform || '';
    applyShortcutTip();
    state.conciseMode = initial.settings.conciseMode !== false;
    els.conciseMode.checked = state.conciseMode;
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
  els.searchSessions.addEventListener('click', () => toggleSessionSearch());
  els.sessionSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      toggleSessionSearch(false);
    }
  });
  els.multiToggle.addEventListener('click', () => toggleSelectMode());
  els.batchTrash.addEventListener('click', batchMoveToTrash);
  els.batchCancel.addEventListener('click', () => toggleSelectMode(false));
  updateBatchBar();


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
    if (!els.permissionMenu.hidden) {
      els.permissionMenu.hidden = true;
      return;
    }
    if (!els.findBar.hidden) {
      closeFindBar();
    } else if (!els.usageModal.hidden) {
      closeUsageModal();
    } else if (!els.settingsModal.hidden) {
      if (canCloseSettings()) els.settingsModal.hidden = true;
    } else if (!els.slashPalette.hidden) {
      hideSlashPalette();
    } else if (
      !els.questionReview.hidden &&
      els.questionReview.contains(document.activeElement)
    ) {
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

  for (const tab of document.querySelectorAll('.settings-tab')) {
    tab.addEventListener('click', () => switchSettingsTab(tab.dataset.settingsTab));
  }

  $('open-usage').addEventListener('click', openUsageModal);
  els.usageClose.addEventListener('click', closeUsageModal);
  els.usageModal.addEventListener('click', (event) => {
    if (event.target === els.usageModal) closeUsageModal();
  });
  $('open-settings').addEventListener('click', () => {
    els.settingsModal.hidden = false;
    switchSettingsTab(state.settingsTab || 'general');
    refreshProviders();
    refreshPricingStatus();
    refreshMcp();
    refreshEnvStatus();
    loadGlobalRules();
  });
  els.mcpRefresh.addEventListener('click', refreshMcp);
  els.envRefresh.addEventListener('click', refreshEnvStatus);
  els.providerAdd.addEventListener('click', () => openProviderForm());
  els.providerActiveSelect.addEventListener('change', () =>
    activateProvider(els.providerActiveSelect.value)
  );
  els.providerCancel.addEventListener('click', closeProviderForm);
  els.providerForm.addEventListener('submit', saveProviderForm);
  els.providerPresetDeepseek.addEventListener('click', applyDeepSeekPreset);
  els.pricingSync.addEventListener('click', syncPricingNow);
  els.usageRange.addEventListener('click', (event) => {
    const button = event.target.closest('[data-range]');
    if (button) refreshUsage(button.dataset.range);
  });
  els.usageApply.addEventListener('click', () => refreshUsage('custom'));
  for (const input of [els.usageStart, els.usageEnd]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        refreshUsage('custom');
      }
    });
  }
  els.mcpAddToggle.addEventListener('click', () => toggleMcpForm());
  els.mcpType.addEventListener('change', syncMcpTypeFields);
  els.mcpCancel.addEventListener('click', () => {
    els.mcpForm.reset();
    els.mcpType.value = 'stdio';
    syncMcpTypeFields();
    toggleMcpForm(false);
  });
  els.mcpForm.addEventListener('submit', addMcpFromForm);
  els.skillForm.addEventListener('submit', installSkillFromForm);
  syncMcpTypeFields();
  els.globalRulesSave.addEventListener('click', saveGlobalRules);
  els.globalRulesReload.addEventListener('click', reloadGlobalRules);
  els.globalRulesText.addEventListener('input', () => {
    if (isGlobalRulesDirty()) els.globalRulesStatus.textContent = '有未保存的修改';
  });
  els.conciseMode.addEventListener('change', () => {
    state.conciseMode = els.conciseMode.checked;
    closeToolGroup();
    window.desk.saveSettings({ conciseMode: state.conciseMode });
  });
  $('settings-close').addEventListener('click', () => {
    if (canCloseSettings()) els.settingsModal.hidden = true;
  });
  els.settingsModal.addEventListener('click', (event) => {
    if (event.target === els.settingsModal && canCloseSettings()) {
      els.settingsModal.hidden = true;
    }
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
    state.activityByKey.delete(key);
    if (state.activeKey === key) {
      state.sessionActive = false;
      setRunning(false);
      if (!hasPendingPlan(key) && !state.awaitingUser) clearActivity();
    }
    setSessionStatus(key, null);
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
