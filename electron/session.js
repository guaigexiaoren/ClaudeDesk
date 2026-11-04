'use strict';

const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');

/**
 * 一个可以被异步 for-await 消费的消息队列，用来把界面发来的消息喂给 SDK。
 */
class MessageQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
  }

  push(item) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }

  close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.items.length > 0) {
        yield this.items.shift();
        continue;
      }
      if (this.closed) return;
      const next = await new Promise((resolve) => this.waiters.push(resolve));
      if (next.done) return;
      yield next.value;
    }
  }
}

/**
 * 封装 Agent SDK：负责启动/恢复会话、发送消息、权限回调、中断和关闭。
 * 对外只抛事件，不直接碰窗口。
 */
class SessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.claudeExecutable = options.claudeExecutable || null;
    this.query = null;
    this.queue = null;
    this.controller = null;
    this.sessionId = null;
    this.cwd = null;
    this.model = null;
    this.status = 'idle';
    this.pendingPermissions = new Map();
    this.starting = false;
  }

  _emitState(extra = {}) {
    this.emit('state', {
      status: this.status,
      sessionId: this.sessionId,
      cwd: this.cwd,
      model: this.model,
      ...extra,
    });
  }

  async start({ cwd, model, permissionMode, resume } = {}) {
    if (this.starting) throw new Error('会话正在启动中');
    this.starting = true;
    try {
      await this.close();

      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      this.cwd = cwd || process.cwd();
      this.model = model && model !== 'default' ? model : null;
      this.sessionId = resume || null;
      this.status = 'starting';
      this.queue = new MessageQueue();
      this.controller = new AbortController();

      const options = {
        cwd: this.cwd,
        permissionMode: permissionMode || 'default',
        includePartialMessages: true,
        abortController: this.controller,
        settingSources: ['user', 'project', 'local'],
        env: {
          ...process.env,
          CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
          CLAUDE_AGENT_SDK_CLIENT_APP: 'claude-desk/1.0.0',
        },
        stderr: (data) => this.emit('stderr', data),
        canUseTool: (toolName, input, opts) => this._askPermission(toolName, input, opts),
      };
      if (this.model) options.model = this.model;
      if (resume) options.resume = resume;
      if (this.claudeExecutable) options.pathToClaudeCodeExecutable = this.claudeExecutable;
      // 始终允许切换到「全部放行」：不传这个标志时，会话中途 setPermissionMode('bypassPermissions') 会被 CLI 忽略
      options.allowDangerouslySkipPermissions = true;

      try {
        this.query = query({ prompt: this.queue, options });
      } catch (err) {
        this.queue?.close();
        this.queue = null;
        this.controller?.abort();
        this.controller = null;
        this.status = 'idle';
        throw err;
      }
      const activeQuery = this.query;
      try {
        this.query
          .initializationResult()
          .then((info) => {
            if (this.query !== activeQuery) return;
            if (info?.commands?.length) this.emit('commands', info.commands);
          })
          .catch(() => {});
      } catch {
        // 老版本 CLI 可能不支持，忽略即可
      }
      this._pump(activeQuery);
      this._emitState();
      return { ok: true, sessionId: this.sessionId };
    } finally {
      this.starting = false;
    }
  }

  async _pump(activeQuery) {
    const isCurrent = () => this.query === activeQuery;
    try {
      for await (const message of activeQuery) {
        if (!isCurrent()) return;
        if (message.type === 'system' && message.subtype === 'init') {
          this.sessionId = message.session_id;
          this.model = message.model || this.model;
          this.cwd = message.cwd || this.cwd;
          if (this.status !== 'running') this.status = 'idle';
          this._emitState({ tools: message.tools, claudeCodeVersion: message.claude_code_version });
        }
        if (message.type === 'assistant') {
          this.status = 'running';
        }
        if (message.type === 'result') {
          this.status = 'idle';
          this._emitState({ costUsd: message.total_cost_usd, durationMs: message.duration_ms });
        }
        this.emit('message', message);
      }
      if (!isCurrent()) return;
      this.status = 'idle';
      this._emitState({ ended: true });
    } catch (err) {
      if (!isCurrent()) return;
      if (this.controller?.signal.aborted) {
        this.status = 'idle';
        this._emitState();
      } else {
        this.status = 'idle';
        this.emit('error', err);
        this._emitState({ ended: true });
      }
    }
  }

  send(text, options = {}) {
    if (!this.queue || !this.query) throw new Error('会话尚未启动');
    if (!text || !text.trim()) return { ok: false };

    const message = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      uuid: randomUUID(),
      origin: { kind: 'human' },
    };
    if (options.priority) message.priority = options.priority;

    this.status = 'running';
    this._emitState();
    this.queue.push(message);
    return { ok: true, uuid: message.uuid };
  }

  _askPermission(toolName, input, opts = {}) {
    return new Promise((resolve) => {
      const id = randomUUID();
      this.pendingPermissions.set(id, { resolve, input, suggestions: opts.suggestions });

      if (toolName === 'AskUserQuestion') {
        this.emit('question', {
          id,
          toolName,
          questions: Array.isArray(input?.questions) ? input.questions : [],
        });
        return;
      }

      if (toolName === 'ExitPlanMode') {
        this.emit('plan', {
          id,
          toolName,
          plan: typeof input?.plan === 'string' ? input.plan : '',
          planFilePath: input?.planFilePath || '',
        });
        return;
      }

      this.emit('permission', {
        id,
        toolName,
        input,
        title: opts.title,
        displayName: opts.displayName,
        description: opts.description,
        decisionReason: opts.decisionReason,
        blockedPath: opts.blockedPath,
        canAlwaysAllow: Array.isArray(opts.suggestions) && opts.suggestions.length > 0,
      });
    });
  }

  respondQuestion(id, { answers, response } = {}) {
    const entry = this.pendingPermissions.get(id);
    if (!entry) return { ok: false };
    this.pendingPermissions.delete(id);

    const updatedInput = { ...entry.input, questions: entry.input?.questions ?? [] };
    if (answers && Object.keys(answers).length > 0) updatedInput.answers = answers;
    if (response) updatedInput.response = response;

    entry.resolve({ behavior: 'allow', updatedInput });
    return { ok: true };
  }

  respondPlan(id, decision, editedPlan, feedback) {
    const entry = this.pendingPermissions.get(id);
    if (!entry) return { ok: false };
    this.pendingPermissions.delete(id);

    if (decision !== 'approve') {
      const note = typeof feedback === 'string' ? feedback.trim() : '';
      entry.resolve({
        behavior: 'deny',
        message: note
          ? `用户拒绝了计划，并提出了修改意见：${note}`
          : '用户没有批准这个计划，请继续完善计划后再提交。',
      });
      return { ok: true };
    }

    const updatedInput = { ...entry.input };
    if (typeof editedPlan === 'string' && editedPlan.trim()) updatedInput.plan = editedPlan;
    entry.resolve({ behavior: 'allow', updatedInput });
    return { ok: true };
  }

  respondPermission(id, decision) {
    const entry = this.pendingPermissions.get(id);
    if (!entry) return { ok: false };
    this.pendingPermissions.delete(id);
    if (decision === 'deny') {
      entry.resolve({ behavior: 'deny', message: '用户拒绝了这次操作。' });
    } else if (decision === 'allow-session') {
      entry.resolve({ behavior: 'allow', updatedPermissions: entry.suggestions });
    } else {
      entry.resolve({ behavior: 'allow' });
    }
    return { ok: true };
  }

  async interrupt() {
    if (!this.query) return { ok: false };
    await this.query.interrupt();
    return { ok: true };
  }

  async setModel(model) {
    if (!this.query) throw new Error('会话尚未启动');
    this.model = model === 'default' ? null : model;
    await this.query.setModel(this.model || 'default');
    this._emitState();
    return { ok: true };
  }

  async setPermissionMode(mode) {
    if (!this.query) throw new Error('会话尚未启动');
    await this.query.setPermissionMode(mode);
    return { ok: true };
  }

  async close() {
    for (const [, entry] of this.pendingPermissions) {
      entry.resolve({ behavior: 'deny', message: '会话已关闭。' });
    }
    this.pendingPermissions.clear();
    if (this.queue) {
      this.queue.close();
      this.queue = null;
    }
    if (this.query) {
      try {
        this.query.close();
      } catch (err) {
        console.error('[session] 关闭查询失败:', err);
      }
      this.query = null;
    }
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
    this.status = 'idle';
    return { ok: true };
  }
}

module.exports = { SessionManager, MessageQueue };
