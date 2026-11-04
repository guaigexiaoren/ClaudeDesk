'use strict';

/**
 * 端到端冒烟：真实拉起 Claude 子进程，验证「启动 → 发送 → 流式 → 结果」整条链路。
 * 手动运行：node tools/e2e-session.js
 * 会消耗极少量 API 额度。
 */

const { SessionManager } = require('../electron/session');

const TIMEOUT_MS = 90_000;

async function main() {
  const session = new SessionManager();
  let finished = false;

  const done = (code, reason) => {
    if (finished) return;
    finished = true;
    console.log(`\n[e2e] ${reason}`);
    session.close().finally(() => process.exit(code));
  };

  const timer = setTimeout(() => done(1, '超时未收到结果'), TIMEOUT_MS);

  session.on('state', (state) => {
    console.log('[state]', JSON.stringify(state));
  });

  session.on('error', (err) => {
    clearTimeout(timer);
    done(1, `会话错误: ${err.message}`);
  });

  session.on('message', (message) => {
    if (message.type === 'system' && message.subtype === 'init') {
      console.log('[init] session=', message.session_id, 'model=', message.model);
    }
    if (message.type === 'assistant') {
      const texts = (message.message?.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (texts) console.log('[assistant]', texts);
    }
    if (message.type === 'result') {
      clearTimeout(timer);
      console.log('[result]', message.subtype, `${message.duration_ms}ms`, `$${message.total_cost_usd ?? 0}`);
      done(message.subtype === 'success' ? 0 : 1, '回合结束');
    }
  });

  await session.start({ cwd: process.cwd(), model: 'default', permissionMode: 'default' });
  session.send('只回复两个字：正常。不要使用任何工具。');
}

main().catch((err) => {
  console.error('[e2e] 启动失败:', err);
  process.exit(1);
});
