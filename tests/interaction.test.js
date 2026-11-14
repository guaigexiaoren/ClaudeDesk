'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { SessionManager } = require('../electron/session');

const QUESTIONS = [
  {
    question: '用哪个 Markdown 库？',
    header: '库',
    options: [
      { label: 'marked', description: '轻量' },
      { label: 'remark', description: '插件多' },
    ],
  },
];

test('AskUserQuestion 返回原始问题与用户答案', async () => {
  const session = new SessionManager();
  let request = null;
  session.on('question', (payload) => {
    request = payload;
  });

  const pending = session._askPermission('AskUserQuestion', { questions: QUESTIONS }, {});
  assert.ok(request, '应该发出 question 事件');

  session.respondQuestion(request.id, { answers: { '用哪个 Markdown 库？': 'marked' } });
  const result = await pending;

  assert.equal(result.behavior, 'allow');
  assert.deepEqual(result.updatedInput.questions, QUESTIONS);
  assert.deepEqual(result.updatedInput.answers, { '用哪个 Markdown 库？': 'marked' });
});

test('AskUserQuestion 跳过时回传 response', async () => {
  const session = new SessionManager();
  let request = null;
  session.on('question', (payload) => {
    request = payload;
  });

  const pending = session._askPermission('AskUserQuestion', { questions: QUESTIONS }, {});
  session.respondQuestion(request.id, { response: '用户跳过了这些问题。' });
  const result = await pending;

  assert.equal(result.updatedInput.response, '用户跳过了这些问题。');
  assert.equal(result.updatedInput.answers, undefined);
});

test('ExitPlanMode 批准后带回计划原文', async () => {
  const session = new SessionManager();
  let request = null;
  session.on('plan', (payload) => {
    request = payload;
  });

  const input = { plan: '# 计划\n1. 改 A', planFilePath: 'C:/x/plan.md' };
  const pending = session._askPermission('ExitPlanMode', input, { toolUseID: 'tu-1' });
  assert.equal(request.plan, '# 计划\n1. 改 A');
  assert.equal(request.toolUseId, 'tu-1');

  session.respondPlan(request.id, 'approve');
  const result = await pending;

  assert.equal(result.behavior, 'allow');
  assert.equal(result.updatedInput.plan, '# 计划\n1. 改 A');
});

test('ExitPlanMode 拒绝时提示继续修改', async () => {
  const session = new SessionManager();
  let request = null;
  session.on('plan', (payload) => {
    request = payload;
  });

  const pending = session._askPermission('ExitPlanMode', { plan: '草案' }, {});
  session.respondPlan(request.id, 'reject');
  const result = await pending;

  assert.equal(result.behavior, 'deny');
  assert.match(result.message, /计划/);
});

test('ExitPlanMode 没有 toolUseID 时为空字符串', async () => {
  const session = new SessionManager();
  let request = null;
  session.on('plan', (payload) => {
    request = payload;
  });

  const pending = session._askPermission('ExitPlanMode', { plan: '草案' }, {});
  assert.equal(request.toolUseId, '');
  session.respondPlan(request.id, 'reject');
  await pending;
});

test('普通工具仍然走权限回调', async () => {
  const session = new SessionManager();
  let request = null;
  session.on('permission', (payload) => {
    request = payload;
  });

  const pending = session._askPermission('Bash', { command: 'echo 1' }, { suggestions: [] });
  assert.equal(request.toolName, 'Bash');

  session.respondPermission(request.id, 'allow');
  const result = await pending;

  assert.equal(result.behavior, 'allow');
  assert.equal(result.updatedInput, undefined);
});

test('计划模式下普通工具自动允许，不再弹权限', async () => {
  const session = new SessionManager();
  session.permissionMode = 'plan';
  let request = null;
  session.on('permission', (payload) => {
    request = payload;
  });

  const result = await session._askPermission('Bash', { command: 'echo 1' }, {});
  assert.equal(result.behavior, 'allow');
  assert.equal(request, null);
});

test('计划模式下提问和计划提交仍走各自事件', async () => {
  const session = new SessionManager();
  session.permissionMode = 'plan';

  let question = null;
  session.on('question', (payload) => {
    question = payload;
  });
  const questionPending = session._askPermission(
    'AskUserQuestion',
    { questions: QUESTIONS },
    {}
  );
  assert.ok(question);
  session.respondQuestion(question.id, { response: '继续' });
  assert.equal((await questionPending).behavior, 'allow');

  let plan = null;
  session.on('plan', (payload) => {
    plan = payload;
  });
  const planPending = session._askPermission('ExitPlanMode', { plan: '草案' }, {});
  assert.ok(plan);
  session.respondPlan(plan.id, 'approve');
  assert.equal((await planPending).behavior, 'allow');
});

test('切换权限模式失败时保留旧模式', async () => {
  const session = new SessionManager();
  session.permissionMode = 'plan';
  session.query = {
    setPermissionMode: async () => {
      throw new Error('切换失败');
    },
  };

  await assert.rejects(() => session.setPermissionMode('default'), /切换失败/);
  assert.equal(session.permissionMode, 'plan');
});
