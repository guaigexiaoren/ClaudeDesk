'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  deriveScope,
  describeImpact,
  ticketTitle,
  buildPermissionTicket,
  buildQuestionTicket,
  buildPlanTicket,
  queueKeys,
} = require('../renderer/ticket-facts');

test('Bash 审批项：标题带命令，范围提示需核对', () => {
  const ticket = buildPermissionTicket({
    key: 'k1',
    cwd: '/Users/me/project',
    request: {
      id: 'p1',
      toolName: 'Bash',
      input: { command: 'npm test', cwd: '/Users/me/project' },
      canAlwaysAllow: true,
    },
  });
  assert.equal(ticket.kind, 'permission');
  assert.equal(ticket.id, 'p1');
  assert.match(ticketTitle(ticket), /Bash · npm test/);
  assert.equal(ticket.scope.label, '需确认');
  assert.match(ticket.impact, /运行命令/);
  assert.equal(ticket.canAlwaysAllow, true);
});

test('Edit 项目内文件：范围判定为项目内', () => {
  const scope = deriveScope({
    cwd: '/Users/me/project',
    input: { file_path: '/Users/me/project/renderer/app.js' },
  });
  assert.equal(scope.label, '项目内');
});

test('Edit 项目外文件：范围判定为项目外', () => {
  const scope = deriveScope({
    cwd: '/Users/me/project',
    input: { file_path: '/Users/me/other/secret.txt' },
  });
  assert.equal(scope.label, '项目外');
});

test('相对路径会拼到工作目录后判断', () => {
  const scope = deriveScope({
    cwd: '/Users/me/project',
    input: { file_path: 'renderer/app.js' },
  });
  assert.equal(scope.label, '项目内');
  assert.match(scope.detail, /renderer\/app\.js$/);
});

test('缺少工作目录或路径时显示需确认，不猜', () => {
  assert.equal(deriveScope({ input: { file_path: '/tmp/a' } }).label, '需确认');
  assert.equal(deriveScope({ cwd: '/Users/me/project', input: {} }).label, '需确认');
});

test('不同工具的后果描述只写可核对事实', () => {
  assert.match(describeImpact('Edit', { file_path: '/a/b.js' }), /写入该文件/);
  assert.match(describeImpact('WebFetch', { url: 'https://example.com' }), /外部网络/);
  assert.match(describeImpact('Read', { file_path: '/a/b.js' }), /不会修改/);
  assert.match(describeImpact('UnknownTool', {}), /UnknownTool/);
});

test('提问审批保留题目、选项与多选信息', () => {
  const ticket = buildQuestionTicket({
    key: 'k2',
    request: {
      id: 'q1',
      questions: [
        {
          header: '刷新范围',
          question: '恢复后要不要同时刷新状态灯？',
          multiSelect: false,
          options: [{ label: '一起刷新' }, { label: '只刷新列表' }],
        },
      ],
    },
  });
  assert.equal(ticket.kind, 'question');
  assert.equal(ticket.questions.length, 1);
  assert.equal(ticket.questions[0].options.length, 2);
  assert.match(ticketTitle(ticket), /1 个问题/);
});

test('计划审批保留计划正文与文件路径', () => {
  const ticket = buildPlanTicket({
    key: 'k3',
    request: {
      id: 'plan1',
      toolUseId: 'tool-1',
      plan: '1. 刷新列表\n2. 补测试',
      planFilePath: '/Users/me/project/plan.md',
    },
  });
  assert.equal(ticket.kind, 'plan');
  assert.equal(ticket.planFilePath, '/Users/me/project/plan.md');
  assert.match(ticketTitle(ticket), /2 步/);
});

test('按会话筛选审批项', () => {
  const tickets = [
    { key: 'a', id: '1' },
    { key: 'b', id: '2' },
    { key: 'a', id: '3' },
  ];
  assert.deepEqual(
    queueKeys(tickets, 'a').map((ticket) => ticket.id),
    ['1', '3']
  );
});
