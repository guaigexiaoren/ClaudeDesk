'use strict';

// macOS 从 Finder/程序坞启动的 GUI 应用 PATH 很短，找不到 Homebrew 安装的工具
const DARWIN_EXTRA_PATHS = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'];

function withDarwinPath(env, platform = process.platform) {
  if (platform !== 'darwin') return env;
  const current = String(env.PATH || '')
    .split(':')
    .filter(Boolean);
  const merged = [...new Set([...DARWIN_EXTRA_PATHS, ...current])];
  return { ...env, PATH: merged.join(':') };
}

module.exports = { withDarwinPath };
