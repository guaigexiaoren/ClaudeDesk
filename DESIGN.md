# ClaudeDesk 设计文档

> 版本：v1.0 草案 ｜ 日期：2026-11-04 ｜ 作者：YYMY + Claude

## 1. 这是什么

ClaudeDesk 是一个跑在 Windows 上的 Claude Code 桌面客户端：左侧会话列表、中间对话流、底部输入框，能力由 `@anthropic-ai/claude-agent-sdk` 提供——也就是和终端里的 Claude Code 同一套引擎（能读写文件、跑命令、调用工具、加载 CLAUDE.md 和 MCP），只是换成了图形界面。

## 2. 为什么要做

1. 终端里的 Claude Code 在这台机器上会被 `conhost.exe` 的栈溢出崩溃连带杀掉（System 日志 Event ID 26，2026-11-04 出现 4 次）。Electron 版不经过 conhost，从根上绕开。
2. 用户不想要终端界面，希望有类似 Codex 桌面版的体验。
3. 终端里 `Ctrl+C`、窗口关闭、滚动回看都很别扭；GUI 能做会话列表、权限弹窗、diff 高亮这些终端做不好的事。

## 3. 功能范围

### v1 要做

| 模块 | 内容 |
| --- | --- |
| 会话 | 新建会话、按工作目录分组的会话列表、恢复历史、回收站（软删除可恢复） |
| 对话 | 流式输出、Markdown 渲染、代码高亮、思考块折叠、工具调用卡片、工具结果折叠 |
| 权限 | 工具执行前弹窗：允许 / 本次会话总是允许 / 拒绝 |
| 提问 | AskUserQuestion 多选问答（支持多选与「其他」自由输入） |
| 计划 | Plan 模式计划审批：批准并执行 / 拒绝继续修改 |
| 命令 | 斜杠命令面板（会话启动时通过 SDK `initializationResult()` 获取） |
| 控制 | 停止当前回合、切换模型、切换权限模式 |
| 工作区 | 选择工作目录、在资源管理器中打开 |
| 设置 | 权限模式、工作目录、主题色、字体大小，持久化到 userData |
| 状态 | 顶部显示当前目录、会话标题、回合耗时与花费 |

### v1 不做（留到以后）

- 多窗口 / 多会话并行
- 图片拖拽输入、文件 @ 引用
- MCP 服务器管理界面
- 会话分支（fork）、撤销文件改动（rewind）
- 自动更新

## 4. 架构

```
┌───────────────────────────── Renderer（Chromium）─────────────────────────────┐
│  index.html + app.js + styles.css                                            │
│  只负责画界面：消息列表、输入框、设置面板、权限弹窗                              │
│  通过 window.desk.*（preload 暴露的 IPC 封装）与主进程通信，不碰 Node 能力       │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │ IPC（contextBridge，contextIsolation: true）
┌───────────────────────────────────┴──────────────────────────────────────────┐
│  Main（Node.js）                                                              │
│  main.js          —— 创建窗口、注册 IPC、转发事件                               │
│  session.js       —— 封装 Agent SDK 的 query()，管理消息队列 / 中断 / 权限回调    │
│  store.js         —— 读写 userData/settings.json                              │
│  @anthropic-ai/claude-agent-sdk → 拉起 claude 子进程（stream-json 协议）        │
└──────────────────────────────────────────────────────────────────────────────┘
```

关键点：

- **流式输入模式**：调用 `query({ prompt: asyncIterable })`，主进程维持一个消息队列。用户每发一条消息就 push 进队列，同一个 claude 进程持续处理多轮，支持中途打断。
- **不用终端**：SDK 直接以子进程 + stdin/stdout JSON 通信，没有 PTY，`conhost` 完全不参与。
- **MCP**：由 Claude Code 自己按 `~/.claude.json` 的 user 作用域配置加载，应用不重复管理；工具调用同样走权限弹窗。
- **渲染进程零 Node 权限**：`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`，只拿 preload 白名单接口。

## 5. 目录结构

```
ClaudeDesk/
├─ package.json
├─ DESIGN.md              ← 本文档
├─ electron/
│  ├─ main.js             ← 主进程入口（窗口、IPC）
│  ├─ preload.cjs         ← 渲染进程桥接
│  ├─ session.js          ← 会话封装（SDK 调用、事件流转）
│  ├─ store.js            ← 设置持久化
│  └─ menu.js             ← 应用菜单（中文）
├─ renderer/
│  ├─ index.html
│  ├─ styles.css          ← 暗色主题
│  ├─ app.js              ← 界面逻辑（ESM 源码）
│  ├─ bundle.js           ← esbuild 产物（含 marked / DOMPurify / highlight.js）
│  └─ bundle.css          ← esbuild 产物（代码高亮主题）
├─ tests/                 ← 单元测试（node --test）
├─ tools/                 ← 端到端冒烟脚本
└─ build/                 ← 图标等打包资源
```

## 6. IPC 协议

### 渲染 → 主（invoke，有返回值）

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `app:get-state` | — | 设置 + 默认目录 + 版本 |
| `app:save-settings` | 部分设置对象 | 合并后的设置 |
| `dialog:pick-directory` | — | 选中的路径或 null |
| `session:list` | `{ dir? }` | 会话摘要列表 |
| `session:history` | `{ sessionId, dir }` | 历史消息数组 |
| `session:start` | `{ cwd, model, permissionMode }` | `{ ok, sessionId }` |
| `session:resume` | `{ sessionId, cwd, model, permissionMode }` | `{ ok, sessionId }` |
| `session:send` | `{ text }` | `{ ok }` |
| `session:interrupt` | — | `{ ok }` |
| `session:set-model` | `{ model }` | `{ ok }` |
| `session:set-permission-mode` | `{ mode }` | `{ ok }` |
| `session:close` | — | `{ ok }` |
| `permission:respond` | `{ id, decision }` | `{ ok }` |
| `shell:show-in-folder` | `{ path }` | `{ ok }` |

`decision` 取值：`allow` ｜ `allow-session` ｜ `deny`。

### 主 → 渲染（事件，单向推送）

| 事件 | 负载 | 用途 |
| --- | --- | --- |
| `session:event` | SDK 原始消息（裁剪过的） | 流式文本、工具调用、结果 |
| `session:state` | `{ status: 'idle'\|'running'\|'starting'\|'closed', sessionId?, model?, cwd? }` | 状态灯、按钮可用性 |
| `session:permission` | `{ id, toolName, input, title?, displayName?, suggestions? }` | 弹出权限卡片 |
| `session:error` | `{ message }` | 错误条 |

## 7. 会话生命周期

```
新建会话
  └─ session:start → session.js 创建消息队列 + query()
       └─ 收到 system/init（带 session_id、model、cwd）→ 通知界面
用户发消息
  └─ session:send → 推入队列 → SDK 产出 assistant 消息（流式）
       └─ 有工具调用 → canUseTool 回调 → 推 session:permission 给界面
            └─ 用户点按钮 → permission:respond → 回调 resolve
  └─ result 消息 → 回合结束，刷新耗时/花费
恢复会话
  └─ session:resume → query({ options: { resume: sessionId } })
中断
  └─ session:interrupt → query.interrupt()（进程保留，可继续下一轮）
退出
  └─ query.close() + 终止子进程
```

## 8. 权限模型

- 主进程给 `query()` 传 `permissionMode` 与 `canUseTool`。
- `canUseTool` 是个 Promise：主进程把请求转发给界面并挂起，用户选择后 resolve：
  - `allow` → `{ behavior: 'allow' }`
  - `allow-session` → `{ behavior: 'allow', updatedPermissions: suggestions }`（SDK 会把规则写进本次会话）
  - `deny` → `{ behavior: 'deny', message: '用户拒绝了此操作' }`
- 权限模式下拉：`default`（每次问）、`acceptEdits`（自动接受编辑）、`plan`（只读规划）、`bypassPermissions`（全部放行，需二次确认）。
- 注意：`bypassPermissions` 必须同时传 `allowDangerouslySkipPermissions: true`，界面上要做红色警示。

`AskUserQuestion` 和 `ExitPlanMode` 不走普通权限弹窗，`session.js` 在 `canUseTool` 里按工具名分流：

- `AskUserQuestion` → 发 `question` 事件；界面收集答案后按「问题原文 → 选项 label」回填 `updatedInput.answers`（多选用逗号连接），跳过时用 `updatedInput.response`。
- `ExitPlanMode` → 发 `plan` 事件；批准时回填 `updatedInput.plan` 让 Claude 开始执行，拒绝时返回 deny 让 Claude 继续修改计划。

## 9. 数据与持久化

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 应用设置 | `%APPDATA%\ClaudeDesk\settings.json` | 权限模式、上次目录、主题色、字号、回收站记录 |
| 会话记录 | `~/.claude/projects/<编码后的目录>/*.jsonl` | 由 Claude Code 自己写，本应用只读 |
| 会话列表 | 运行时调 SDK 的 `listSessions({ dir })` | 自动标题、最后修改时间都来自这里 |

好处：ClaudeDesk 和终端里的 `claude` 共用同一份会话记录，两边可以互相恢复。

## 10. 界面

- **配色**：深灰底，强调色可在设置里切换（6 种预设，默认 Claude 橙 #d97757）；背景、面板、边框用 `color-mix` 跟随强调色微调。
- **布局**：左侧栏 264px，按工作目录分组的会话列表 + 回收站；主区为对话流；底部输入框与发送按钮同一行。
- **消息**：
  - 用户消息：右对齐气泡
  - 助手消息：整宽 Markdown
  - 思考块：灰色折叠条「思考中… / 已思考」
  - 工具调用：卡片，标题是工具名 + 一句话摘要，可展开看入参 JSON
  - 工具结果：默认折叠，显示前 3 行
- **字体**：界面用 `Segoe UI`，代码用 `Cascadia Mono, Consolas`。
- **中文优先**：所有文案中文，日期用本地格式。

## 11. 运行与打包

```bash
npm install         # 安装依赖（含 electron 开发依赖）
npm start           # 开发运行（先自动 build:renderer）
npm test            # 单元测试
npm run pack        # 打包成目录（release/win-unpacked）
npm run dist        # 打包成单文件便携版（release/ClaudeDesk.exe）
```

渲染层用 esbuild 打包：`renderer/app.js` 里的 `import` 会被解析成单文件 `bundle.js`，样式（含代码高亮主题）输出到 `bundle.css`。改完界面必须重新构建，`npm start` 的 `prestart` 已经自动做了这件事。

打包注意：

- `asarUnpack` 必须包含 `@anthropic-ai/**`，否则 SDK 的 `claude.exe` 无法从 asar 里执行。
- `files` 需要包含 SDK 及其运行时依赖（`@anthropic-ai`、`@modelcontextprotocol`、`zod` 等）。
- 主进程启动时给 SDK 子进程注入 `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`（无终端也安全）。

## 12. 里程碑

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| M1 | 窗口骨架 + 路由 + 设置存储 | `npm start` 能开窗、能选目录、设置重开还在 |
| M2 | 会话与流式对话 | 发一句话能流式回来，停止按钮有效 |
| M3 | 工具卡片与权限弹窗 | 让 Claude 读文件会弹权限，允许后展示结果 |
| M4 | 历史会话 | 重启后能在左侧恢复昨天的会话 |
| M5 | 打包 | `npm run dist` 产出可双击的 exe |

## 13. 风险与已知限制

- **SDK 与 Electron 的 Node 版本差异**：Electron 内置 Node 可能比系统 Node 旧，SDK 要求 ≥18.14。若启动报错，用 `electron/main.js` 里的 `process.env.ELECTRON_RUN_AS_NODE` 场景排查。
- **中文路径**：Windows 下 `~/.claude/projects` 的目录名是编码过的，`listSessions({ dir })` 已处理，不要自己拼路径。
- **asar 内的二进制无法执行**：SDK 默认把 `claude.exe` 解析到 `app.asar` 内部路径，spawn 会失败。解决办法是 `asarUnpack: ["node_modules/@anthropic-ai/**"]`，并在打包环境下把 `options.pathToClaudeCodeExecutable` 显式指向 `resources/app.asar.unpacked/.../claude.exe`（`main.js` 的 `resolveClaudeExecutable()` 已处理）。
- **凭证**：沿用本机已登录的 Claude Code 凭证（`~/.claude`），首次使用需先在终端 `claude` 登录一次。应用内不存 API Key。
- **崩溃隔离**：claude 子进程崩溃不应带走主进程，`session.js` 里对所有异常做捕获并转成 `session:error`。
