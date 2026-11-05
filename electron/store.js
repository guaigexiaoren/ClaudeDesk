'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = {
  cwd: '',
  model: 'default',
  permissionMode: 'default',
  accent: 'claude',
  trash: [],
  fontSize: 14,
  lastSessionId: '',
  windowBounds: { width: 1320, height: 880 },
};

/**
 * 极简的 JSON 设置存储：整份读写，写坏了就回退到默认值。
 */
class Store {
  constructor(baseDir) {
    this.dir = baseDir;
    this.file = path.join(baseDir, 'settings.json');
    this.data = { ...DEFAULT_SETTINGS };
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this.data = { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {
      // 文件不存在或损坏：保持默认值
    }
  }

  get() {
    return { ...this.data };
  }

  merge(patch) {
    if (patch && typeof patch === 'object') {
      this.data = { ...this.data, ...patch };
      this._save();
    }
    return this.get();
  }

  _save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const temp = `${this.file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(temp, this.file);
    } catch (err) {
      console.error('[store] 保存设置失败:', err);
    }
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
