# ClaudeDesk

基于 Claude Agent SDK 的 Windows 桌面工作台——不用终端，也能用 Claude Code 的全部能力（读写文件、运行命令、搜索代码、MCP）。

![状态](https://img.shields.io/badge/Electron-45-2b2e3a) ![状态](https://img.shields.io/badge/Claude_Agent_SDK-0.3-2b2e3a)

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 运行
npm start
```

首次使用前，先在终端里运行一次 `claude` 完成登录——ClaudeDesk 复用本机 `~/.claude` 里的凭证，自身不保存 API Key。

## 功能

- **对话**：流式输出、Markdown 渲染、代码高亮、思考过程折叠；生成过程中可以继续输入，消息会插入当前任务（当前工具结束后生效，气泡上带「插入」标签）
- **工具**：工具调用卡片、入参/输出展开查看、执行状态
- **权限**：每次询问 / 本次会话总是允许 / 拒绝，执行前弹窗确认
- **提问**：Claude 需要确认时弹出多选问答，支持多选和「其他」自由输入
- **计划**：Plan 模式下先出计划，弹窗确认后才会动手；拒绝时可以填写修改意见让它按你的要求重做
- **命令**：输入 `/` 唤起斜杠命令面板
- **会话**：左侧历史列表按工作目录分组、一键恢复、移到回收站（可恢复或彻底删除）；右键目录可把该目录下的会话整体移入回收站；支持搜索、置顶、重命名、导出 Markdown、批量移入回收站；新建会话结束后自动刷新列表和标题
- **查找**：`Ctrl+F` 在当前对话内查找，`Enter` 下一个、`Shift+Enter` 上一个、`Esc` 关闭
- **托盘与快速提问**：关闭主窗口时隐藏到托盘（托盘菜单可退出）；`Ctrl+Alt+Space` 唤出快速提问窗口，输入后回车切回主窗口发送
- **终端**：顶部「终端」按钮打开真正的终端（node-pty + xterm.js），支持 vim 等交互程序、`Ctrl+Shift+C/V` 复制粘贴、重启和清空；默认使用 PowerShell，工作目录跟随当前会话
- **会话分支/回滚**：用户消息悬停可「分叉」出新会话或「回滚文件」到该消息时的状态（文件回滚需要当前会话运行期间产生的检查点）
- **控制**：停止生成、四种权限模式
- **界面**：暗色主题、六种主题色（背景会跟着主题色微调）、字号可调、中文菜单
- **MCP**：自动加载全局配置的 MCP 服务器，设置面板可查看服务器与连接状态

## 目录结构

```
electron/         主进程
  main.js         窗口、菜单、IPC、托盘与快速窗口
  session.js      Agent SDK 会话封装
  terminal.js     终端（node-pty）
  store.js        设置持久化
  preload.cjs     渲染进程桥接
renderer/         界面（esbuild 打包成 bundle.js，quick.html 为快速窗口）
DESIGN.md         设计文档
```

## MCP 服务器

已在本机全局（user 作用域）配置四个常用 MCP，ClaudeDesk 启动会话时会自动加载：

| 名称 | 用途 |
| --- | --- |
| chrome-devtools | 控制 Chrome：打开网页、点击、填表、看控制台 |
| playwright | 浏览器自动化与端到端测试 |
| context7 | 查询第三方库的最新文档 |
| sequential-thinking | 结构化分步推理 |

管理命令：`claude mcp list`（查看）、`claude mcp add -s user <名称> -- <命令>`（新增）。

## 打包

```bash
npm run dist       # Windows：release/ClaudeDesk.exe（便携版）
npm run dist:mac   # macOS：release/ClaudeDesk-1.0.0-arm64.dmg
npm run pack       # 只生成目录，不压缩
```

注意：Windows 安装包只能在 Windows 上打，macOS 安装包只能在 Mac 上打，同一份代码两边各打一次。

**终端与原生模块**：终端使用 `node-pty`，它自带 N-API 预编译二进制。打包配置里设置了 `npmRebuild: false`，避免 electron-builder 触发 node-gyp 重新编译（没有安装 Visual Studio 的机器会直接打包失败）。

### 在 Mac 上使用

如果新电脑上还没有 Node/npm，可以直接运行仓库里的准备脚本；它会安装 Homebrew、Node.js、Claude Code 命令行版，并打包 ClaudeDesk：

```bash
git clone https://github.com/guaigexiaoren/ClaudeDesk.git
cd ClaudeDesk
bash mac-setup.command
```

完成后安装包在 `release/`：

- Apple Silicon：`ClaudeDesk-1.0.0-arm64.dmg`
- Intel：`ClaudeDesk-1.0.0-x64.dmg`

也可以手动执行：

```bash
npm install        # 会自动装上 darwin 的 Claude 引擎
npm start          # 开发运行
npm run dist:mac   # 生成 dmg + zip
```

首次打开未签名的应用会被 Gatekeeper 拦截：右键应用选「打开」，或执行 `xattr -cr /Applications/ClaudeDesk.app`。

## 两台电脑之间共享什么

| 内容 | 能否共享 | 做法 |
| --- | --- | --- |
| 项目代码 | 可以 | Git 仓库，两边 clone / pull |
| 全局指令、技能 | 可以 | 手动复制 `~/.claude/CLAUDE.md` 和 `~/.claude/skills/` |
| 登录状态 | 不可以 | 两台机器各自登录一次 Claude |
| 对话历史 | 不建议 | 记录按绝对路径存在 `~/.claude/projects/`，跨系统路径不同，同步后会话会指向不存在的目录 |
| 应用设置 | 可以 | 复制各自的 settings.json（Windows 在 `%APPDATA%\ClaudeDesk`，Mac 在 `~/Library/Application Support/ClaudeDesk`） |

## 常见问题

**Electron 下载失败**：npm 的 postinstall 可能被墙。用镜像手动装：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
```

**修改界面后没生效**：`npm start` 前会自动执行 `npm run build:renderer`，单独构建用这条命令。

**会话记录在哪**：`C:\Users\<你>\.claude\projects\`，和终端版 Claude Code 共用，两端可以互相恢复。
