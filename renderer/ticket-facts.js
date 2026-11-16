'use strict';

/**
 * 把权限 / 提问 / 计划请求转换成对话内联审批卡的待审批项事实。
 * 只输出请求里能核对的内容，推导不出就写「需确认」，不生成风险评分。
 */

const FILE_PATH_KEYS = ['file_path', 'notebook_path', 'path'];

function normalizePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
}

function isAbsolutePath(value) {
  return /^([a-zA-Z]:\/|\/)/.test(value);
}

function joinPath(cwd, value) {
  const path = normalizePath(value);
  if (isAbsolutePath(path)) return path;
  const base = normalizePath(cwd);
  return base ? normalizePath(`${base}/${path}`) : path;
}

function filePathOf(input) {
  if (!input || typeof input !== 'object') return '';
  for (const name of FILE_PATH_KEYS) {
    if (typeof input[name] === 'string' && input[name].trim()) return input[name].trim();
  }
  return '';
}

function isInside(cwd, filePath) {
  const base = normalizePath(cwd);
  if (!base || !filePath) return null;
  const full = joinPath(base, filePath);
  const baseLower = base.toLowerCase();
  const fullLower = full.toLowerCase();
  return fullLower === baseLower || fullLower.startsWith(`${baseLower}/`);
}

function deriveScope({ cwd, input } = {}) {
  const filePath = filePathOf(input);
  if (!cwd) {
    return { label: '需确认', detail: '当前会话没有工作目录信息' };
  }
  if (filePath) {
    const inside = isInside(cwd, filePath);
    if (inside === null) return { label: '需确认', detail: '无法判断文件是否在工作目录内' };
    return inside
      ? { label: '项目内', detail: joinPath(cwd, filePath) }
      : { label: '项目外', detail: joinPath(cwd, filePath) };
  }
  if (typeof input?.command === 'string' && input.command.trim()) {
    return { label: '需确认', detail: '命令可能访问项目外文件，请核对命令' };
  }
  return { label: '需确认', detail: '无法从请求推导工作范围' };
}

function describeImpact(toolName, input = {}) {
  const command = typeof input?.command === 'string' ? input.command.trim() : '';
  const filePath = filePathOf(input);
  const pattern = typeof input?.pattern === 'string' ? input.pattern.trim() : '';
  const url = typeof input?.url === 'string' ? input.url.trim() : '';
  const query = typeof input?.query === 'string' ? input.query.trim() : '';

  switch (toolName) {
    case 'Bash':
      return command
        ? `运行命令，可能修改文件或访问网络；批准后会在当前工作目录执行。`
        : '运行命令；批准后会在当前工作目录执行。';
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return filePath
        ? `写入该文件；批准后会修改文件内容，工具卡随即开始执行。`
        : '写入文件；批准后会修改文件内容，工具卡随即开始执行。';
    case 'Read':
    case 'Grep':
    case 'Glob':
      return pattern
        ? `只读取 / 搜索，不会修改项目文件。`
        : '只读取文件，不会修改项目文件。';
    case 'WebFetch':
    case 'WebSearch':
      return url || query
        ? '访问外部网络；请求会发送到外部服务。'
        : '访问外部网络；请求会发送到外部服务。';
    case 'Task':
      return '启动子代理；子代理会继续调用工具。';
    default:
      return `执行 ${toolName || '工具'}；完整参数见下方原始请求。`;
  }
}

function ticketTitle(ticket = {}) {
  if (ticket.kind === 'question') {
    const count = Array.isArray(ticket.questions) ? ticket.questions.length : 0;
    return count > 0 ? `Claude 想确认 ${count} 个问题` : 'Claude 想确认一下';
  }
  if (ticket.kind === 'plan') {
    const steps = String(ticket.plan || '')
      .split('\n')
      .filter((line) => /^\s*(\d+[.、]|[-*]\s)/.test(line)).length;
    return steps > 0 ? `计划 · ${steps} 步` : '计划待批准';
  }
  const input = ticket.input || {};
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  if (command) return `${ticket.toolName || '工具'} · ${command}`;
  const filePath = filePathOf(input);
  if (filePath) {
    const name = filePath.split(/[\\/]/).pop() || filePath;
    return `${ticket.toolName || '工具'} · ${name}`;
  }
  const pattern = typeof input.pattern === 'string' ? input.pattern.trim() : '';
  if (pattern) return `${ticket.toolName || '工具'} · ${pattern}`;
  return ticket.title || `Claude 想要执行 ${ticket.toolName || '工具'}`;
}

function buildPermissionTicket({ key, request, cwd, sessionTitle } = {}) {
  const input = request?.input && typeof request.input === 'object' ? request.input : {};
  const toolName = request?.toolName || '工具';
  return {
    kind: 'permission',
    key,
    id: request?.id || '',
    toolName,
    title: request?.title || `Claude 想要执行 ${toolName}`,
    displayName: request?.displayName || '',
    description: request?.description || '',
    decisionReason: request?.decisionReason || '',
    blockedPath: request?.blockedPath || '',
    canAlwaysAllow: Boolean(request?.canAlwaysAllow),
    input,
    scope: deriveScope({ cwd, input }),
    impact: describeImpact(toolName, input),
    sessionTitle: sessionTitle || '',
    createdAt: Date.now(),
    status: 'pending',
  };
}

function buildQuestionTicket({ key, request, sessionTitle } = {}) {
  const questions = Array.isArray(request?.questions) ? request.questions : [];
  return {
    kind: 'question',
    key,
    id: request?.id || '',
    questions,
    sessionTitle: sessionTitle || '',
    createdAt: Date.now(),
    status: 'pending',
  };
}

function buildPlanTicket({ key, request, sessionTitle } = {}) {
  return {
    kind: 'plan',
    key,
    id: request?.id || '',
    toolUseId: request?.toolUseId || '',
    plan: typeof request?.plan === 'string' ? request.plan : '',
    planFilePath: request?.planFilePath || '',
    sessionTitle: sessionTitle || '',
    createdAt: Date.now(),
    status: 'pending',
  };
}

function queueKeys(tickets, key) {
  return (tickets || []).filter((ticket) => ticket.key === key);
}

module.exports = {
  normalizePath,
  isAbsolutePath,
  joinPath,
  filePathOf,
  isInside,
  deriveScope,
  describeImpact,
  ticketTitle,
  buildPermissionTicket,
  buildQuestionTicket,
  buildPlanTicket,
  queueKeys,
};
