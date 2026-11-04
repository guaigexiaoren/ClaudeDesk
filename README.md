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

- **对话**：流式输出、Markdown 渲染、代码高亮、思考过程折叠
- **工具**：工具调用卡片、入参/输出展开查看、执行状态
- **权限**：每次询问 / 本次会话总是允许 / 拒绝，执行前弹窗确认
- **提问**：Claude 需要确认时弹出多选问答，支持多选和「其他」自由输入
- **计划**：Plan 模式下先出计划，弹窗确认后才会动手；也可拒绝让它继续修改
- **命令**：输入 `/` 唤起斜杠命令面板
- **会话**：左侧历史列表按工作目录分组、一键恢复、移到回收站（可恢复或彻底删除）；右键目录可把该目录下的会话整体移入回收站
- **控制**：停止生成、四种权限模式
- **界面**：暗色主题、六种主题色（背景会跟着主题色微调）、字号可调、中文菜单
- **MCP**：自动加载全局配置的 MCP 服务器，设置面板可查看服务器与连接状态

## 目录结构

```
electron/         主进程
  main.js         窗口、菜单、IPC
  session.js      Agent SDK 会话封装
  store.js        设置持久化
  preload.cjs     渲染进程桥接
renderer/         界面（esbuild 打包成 bundle.js）
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
npm run dist       # 生成 release/ClaudeDesk.exe（便携版）
npm run pack       # 只生成目录，不压缩
```

## 常见问题

**Electron 下载失败**：npm 的 postinstall 可能被墙。用镜像手动装：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
```

**修改界面后没生效**：`npm start` 前会自动执行 `npm run build:renderer`，单独构建用这条命令。

**会话记录在哪**：`C:\Users\<你>\.claude\projects\`，和终端版 Claude Code 共用，两端可以互相恢复。
