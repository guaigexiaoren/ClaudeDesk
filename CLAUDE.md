# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

ClaudeDesk 是 Claude Code 的桌面图形客户端：Electron 45 + esbuild + `@anthropic-ai/claude-agent-sdk`。界面负责会话列表、对话流、权限弹窗等，真正的执行仍由随包内置的 Claude Code CLI 完成。

- 复用本机 `~/.claude` 的登录、配置和 MCP；应用自身不管理账号、不保存 API Key。
- 支持多会话并行：会话由渲染进程生成 key，后端每个 key 一个 CLI 进程，事件按 key 路由；侧边栏每个会话有独立状态灯。
- 其他主要能力：图片附件（真实图片块）、文件附件（只记录绝对路径）、四种权限模式、计划审批、历史分页、上下文压缩提示、托盘与全局快速提问。
- 主要面向 Windows x64（绿色 zip / 便携 exe）；macOS 可在 Mac 上打包。

## 常用命令

```bash
npm install
npm start                  # 开发运行；prestart 会先执行 build:renderer
npm run build:renderer     # esbuild 构建 bundle.js / bundle.css / highlight.bundle.js
npm test                   # node --test，共 89 项单元测试
node --test tests/format.test.js                                     # 只跑一个测试文件
node --test --test-name-pattern="关键词" tests/session-groups.test.js  # 只跑匹配的用例
node tools/e2e-session.js  # 端到端冒烟：真实拉起 Claude（会消耗少量额度）
npm run pack               # 只生成 release/win-unpacked
npm run dist               # Windows：便携版 + 绿色 zip
npm run dist:zip           # 只出绿色 zip
npm run dist:portable      # 只出便携版 exe
npm run dist:mac           # macOS：dmg + zip（必须在 Mac 上执行）
```

打包时的仓库约束：

- GitHub 不可达时，可复用本地 Electron 缓存：`npx electron-builder --win zip -c.electronDist=<缓存里的 electron-v45*-win32-x64.zip>`。
- 不要改动 `npmRebuild: false`：当前没有需要重编译的原生模块，保留它可以避免 electron-builder 触发 node-gyp。
- 不要移除 `asarUnpack` 里的 `node_modules/@anthropic-ai/**/*`：SDK 的 `claude.exe` 在 asar 内无法执行。
- 当前 `node_modules` 只装了 win32-x64 的 CLI 平台包；在 Mac 上需要重新 `npm install` 才会装 darwin 包。

## 架构

### 主进程（`electron/`，CommonJS）

- `main.js`：窗口、托盘、快速提问窗口、菜单和全部 IPC。`sessions` Map 按 key 管理多个 `SessionManager`；所有推给渲染层的事件都带 key；空闲会话默认 30 分钟回收（`CLAUDE_DESK_IDLE_MS` 可调）。
- `session.js`：`MessageQueue` + `SessionManager`。用流式输入 `query({ prompt: asyncIterable })` 保持一个 CLI 子进程多轮对话；`canUseTool` 按工具名分流：普通工具走 permission，`AskUserQuestion` 走 question，`ExitPlanMode` 走 plan；`interrupt`、`close`、`_settlePending` 负责收尾，避免权限 Promise 悬挂。
- `preload.cjs`：`contextBridge` 暴露 `window.desk` 白名单接口和事件订阅，渲染层只能通过这些接口访问主进程。
- `store.js`：`app.getPath('userData')/settings.json` 的原子读写（临时文件 + rename）。

### 渲染层（`renderer/`，ESM 源码）

- `app.js` 是唯一 UI 源码，由 esbuild 打包成 `bundle.js` / `bundle.css`；`highlight-entry.js` 生成按需加载的懒加载包；`quick.html` + `quick.js` 是快速提问窗口；`session-groups.js`、`format.js` 是可直接测试的纯函数模块。
- 关键状态集中在 `app.js` 顶部的 `state`：`activeKey`、`keyToSession/sessionKeys`、`sessionStatus`、`commandsByKey/metaByKey/modeByKey`、`historyCache/historyView`、`pendingEvents`、`switchToken`。
- 事件流：主进程 `session:event/state/permission/question/plan/error` → preload 订阅 → `handleSessionEvent`。非当前会话只更新状态灯和后台活动计时，不渲染；当前会话才进入 `handleEvent`。
- 切换会话用 `switchToken` 丢弃过期结果；历史只保留最近 5 个会话的内存缓存，每次只渲染最近 50 条，顶部「加载更早」按需追加。

### 历史与上下文

- 主进程 `session:history` 调用 `getSessionMessages(sessionId, { includeSystemMessages: true })`，过滤 sidechain 消息，并把 `tool_result` 内容截到 8000 字再通过 IPC 回传。
- 渲染层识别 `system` 历史条目为压缩边界并显示提示；实时压缩通过 `system/status`（compacting）和 `system/compact_boundary` 显示进度与 token 变化。
- 历史文件由 Claude Code 写在 `~/.claude/projects/<编码后的目录>/*.jsonl`，应用只读；不要自己拼编码目录，交给 SDK 的 `listSessions`/`getSessionMessages`。

### 运行时与鉴权

- 打包时 `main.js` 的 `resolveClaudeExecutable()` 把 `pathToClaudeCodeExecutable` 指到 `resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude.exe`；开发时返回 null，由 SDK 从 `node_modules` 解析。
- 应用不处理登录：会话启动时传 `settingSources: ['user', 'project', 'local']` 并继承 `process.env`，由 CLI 自己读取 `~/.claude` 的凭证或环境变量（API Key、中转代理等）。换机器必须重新登录或配置同一通道。
- 新会话首次运行前，`~/.claude` 里需要有可用的登录/配置；否则错误会经 `session:error` 显示在界面的红色错误栏。

### 测试

`tests/` 使用 Node 内置 runner，覆盖纯逻辑：消息队列、权限/问答/计划的回填、会话分组、会话状态机、耗时格式。测试不启动 Electron；界面改动用 `npm start` 和 `tools/e2e-session.js` 验证。

## 仓库特有的注意事项

- `renderer/bundle.js`、`bundle.css`、`highlight.bundle.js` 是生成物且已 gitignore：不要手改，改源码后执行 `npm run build:renderer`。
- 渲染进程处于沙箱（`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`）。需要新能力时在 `preload.cjs` 增加白名单接口，不要在渲染层直接引 Node。
- 新增会话事件通道时，需同时更新 `preload.cjs` 的订阅、`main.js` 的发送端和 `app.js` 的处理器；事件必须带 key。
- UI 文案保持中文；颜色和字号走 `styles.css` 的 CSS 变量，不要写死颜色。
- `DESIGN.md` 是早期的 v1 设计草案，部分内容已过时（如多会话、zip 打包、权限模式）；与当前实现冲突时以代码和 `package.json` 为准。
