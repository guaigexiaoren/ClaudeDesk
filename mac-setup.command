#!/bin/bash

# ClaudeDesk macOS 一键准备脚本
# 用法：cd 到项目目录后执行 bash mac-setup.command

set -u

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR" || exit 1

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
die() { printf '\033[1;31m%s\033[0m\n' "$*"; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "这个脚本只能在 macOS 上运行。"
SW_MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
if [[ "${SW_MAJOR:-0}" -lt 13 ]]; then
  warn "提示：Claude Code 官方安装器建议 macOS 13 或更高，当前是 $(sw_vers -productVersion)。"
fi

cat <<'EOF'
这个脚本会依次做：
  1. 安装 Homebrew（如果还没有）
  2. 用 Homebrew 安装 Node.js LTS（打包 ClaudeDesk 需要）
  3. 安装 Claude Code 命令行版（claude 命令）
  4. 安装 ClaudeDesk 依赖并打包 macOS 应用

全程可能需要 5-15 分钟；安装 Homebrew 时会要求输入 Mac 密码。
EOF
read -r -p "继续？(y/N) " answer
if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
  echo "已取消。"
  exit 0
fi

# 1. Homebrew
if command -v brew >/dev/null 2>&1; then
  log "Homebrew 已安装"
else
  log "安装 Homebrew（会提示输入密码）"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
    || die "Homebrew 安装失败。请检查网络后重试。"
fi

if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -x /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi
command -v brew >/dev/null 2>&1 || die "没有找到 brew，请重新打开终端后再运行本脚本。"

# 2. Node / npm
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  log "Node 已安装：$(node -v)"
else
  log "安装 Node.js LTS"
  brew install node || die "Node.js 安装失败。"
fi

# 3. Claude Code 命令行版
if command -v claude >/dev/null 2>&1; then
  log "Claude Code 已安装：$(claude --version 2>/dev/null || true)"
else
  log "安装 Claude Code 命令行版"
  curl -fsSL https://claude.ai/install.sh | bash \
    || die "Claude Code 安装失败。请检查网络后重试。"
  if [[ -d "$HOME/.local/bin" ]]; then
    export PATH="$HOME/.local/bin:$PATH"
    if ! grep -qs 'HOME/.local/bin' "$HOME/.zshrc" 2>/dev/null; then
      printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.zshrc"
    fi
  fi
fi

if command -v claude >/dev/null 2>&1; then
  log "Claude Code 命令：$(command -v claude)"
else
  warn "claude 还没有进入当前终端 PATH；关闭终端重开后运行 claude 即可。"
fi

# 4. ClaudeDesk 依赖与 macOS 打包
log "安装 ClaudeDesk 依赖（首次会下载 Electron 和 Claude CLI，比较久）"
if ! npm install; then
  warn "直接安装失败，改用国内 Electron 镜像重试"
  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install \
    || die "依赖安装失败。请检查网络后重试。"
fi

log "打包 macOS 应用"
if ! npm run dist:mac; then
  warn "直接打包失败，改用国内 Electron 镜像重试"
  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run dist:mac \
    || die "打包失败。请把上面的错误发给我。"
fi

log "完成"
echo
echo "安装包在：$REPO_DIR/release"
ls -lh "$REPO_DIR/release"/*.dmg "$REPO_DIR/release"/*.zip 2>/dev/null || true
echo
echo "第一次使用前，先在终端运行一次 claude，按提示登录（或配置你的中转代理），"
echo "然后打开 dmg，把 ClaudeDesk 拖到「应用程序」。"
open "$REPO_DIR/release" 2>/dev/null || true
