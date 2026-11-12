'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MAX_GLOBAL_RULES_LENGTH,
  claudeMdPath,
  readClaudeMd,
  writeClaudeMd,
} = require('../electron/global-rules');

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudedesk-rules-'));
}

test('读取不存在的全局规范文件时返回空内容', () => {
  const home = tempHome();
  try {
    const result = readClaudeMd(home);
    assert.equal(result.exists, false);
    assert.equal(result.content, '');
    assert.equal(result.path, claudeMdPath(home));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('保存后能读回，第二次保存会留备份', () => {
  const home = tempHome();
  try {
    const first = writeClaudeMd(home, '# 全局规范\n\n- 第一条\n');
    assert.equal(first.backup, null);
    assert.equal(readClaudeMd(home).content, '# 全局规范\n\n- 第一条\n');

    const second = writeClaudeMd(home, '# 全局规范\n\n- 第二条\n');
    assert.ok(second.backup);
    assert.equal(fs.readFileSync(second.backup, 'utf8'), '# 全局规范\n\n- 第一条\n');
    assert.equal(readClaudeMd(home).content, '# 全局规范\n\n- 第二条\n');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('拒绝非字符串和超长内容', () => {
  const home = tempHome();
  try {
    assert.throws(() => writeClaudeMd(home, null), /内容格式不对/);
    assert.throws(
      () => writeClaudeMd(home, 'x'.repeat(MAX_GLOBAL_RULES_LENGTH + 1)),
      /内容太长/
    );
    assert.equal(fs.existsSync(claudeMdPath(home)), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
