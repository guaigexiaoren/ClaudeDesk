'use strict';

/**
 * Claude Code 的全局用户记忆文件：~/.claude/CLAUDE.md。
 * 直接读写这个固定文件，不接受外部传入的路径。
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_GLOBAL_RULES_LENGTH = 200_000;

function claudeMdPath(home) {
  return path.join(home, '.claude', 'CLAUDE.md');
}

function readClaudeMd(home) {
  const file = claudeMdPath(home);
  try {
    return { content: fs.readFileSync(file, 'utf8'), exists: true, path: file };
  } catch {
    return { content: '', exists: false, path: file };
  }
}

function writeClaudeMd(home, content) {
  if (typeof content !== 'string') throw new Error('内容格式不对');
  if (content.length > MAX_GLOBAL_RULES_LENGTH) {
    throw new Error('内容太长（最多 200KB）');
  }

  const file = claudeMdPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  let backup = null;
  try {
    const old = fs.readFileSync(file, 'utf8');
    backup = `${file}.bak`;
    fs.writeFileSync(backup, old, 'utf8');
  } catch {
    backup = null;
  }

  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 已 rename 或本来就不存在 */
    }
  }

  return { path: file, backup, savedAt: Date.now() };
}

module.exports = {
  MAX_GLOBAL_RULES_LENGTH,
  claudeMdPath,
  readClaudeMd,
  writeClaudeMd,
};
