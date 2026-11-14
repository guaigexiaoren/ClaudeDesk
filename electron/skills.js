'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SKILL_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

function sanitizeSkillName(name) {
  const value = String(name || '').trim();
  if (!SKILL_NAME_RE.test(value) || value === '.' || value === '..') {
    throw new Error('技能名称不合法');
  }
  return value;
}

function parseSkillFrontmatter(text) {
  const source = String(text || '');
  const result = { name: '', description: '' };
  if (!source.startsWith('---')) return result;
  const end = source.indexOf('\n---', 3);
  if (end < 0) return result;
  const block = source.slice(3, end);
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^(name|description)\s*:\s*(.*)$/i);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    if (match[1].toLowerCase() === 'name') result.name = value;
    else result.description = value;
  }
  return result;
}

function skillMeta(dir) {
  const file = path.join(dir, 'SKILL.md');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const front = parseSkillFrontmatter(text);
  return {
    name: front.name || path.basename(dir),
    description: front.description || '',
    path: dir,
  };
}

function skillsRoot(home) {
  return path.join(home, '.claude', 'skills');
}

function listSkills(home) {
  const root = skillsRoot(home);
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = skillMeta(path.join(root, entry.name));
    if (meta) skills.push(meta);
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** 在仓库里找 SKILL.md：优先 subpath，否则最多向下找 3 层。 */
function findSkillDir(root, subpath = '') {
  const resolvedRoot = path.resolve(root);
  const base = subpath ? path.resolve(resolvedRoot, subpath) : resolvedRoot;
  if (base !== resolvedRoot && !base.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('子目录不合法');
  }
  if (fs.existsSync(path.join(base, 'SKILL.md'))) return base;

  const found = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const child = path.join(dir, entry.name);
      if (fs.existsSync(path.join(child, 'SKILL.md'))) {
        found.push(child);
        continue;
      }
      walk(child, depth + 1);
    }
  };
  walk(base, 0);
  if (found.length === 0) return null;
  if (!subpath && found.length > 1) {
    throw new Error('仓库里有多个技能，请填写技能子目录');
  }
  return found[0];
}

/**
 * 把已经克隆到本地的仓库目录安装到 ~/.claude/skills。
 * 只复制文件，不执行仓库里的任何脚本。
 */
function installSkillFromDir(home, sourceRoot, subpath = '') {
  const skillDir = findSkillDir(sourceRoot, subpath);
  if (!skillDir) throw new Error('仓库里没有找到 SKILL.md');
  const meta = skillMeta(skillDir);
  const name = sanitizeSkillName(meta?.name || path.basename(skillDir));
  const target = path.join(skillsRoot(home), name);
  if (fs.existsSync(target)) throw new Error(`技能 ${name} 已存在`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(skillDir, target, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      return base !== '.git' && base !== 'node_modules';
    },
  });
  return { name, description: meta?.description || '', path: target };
}

function removeSkill(home, name) {
  const safe = sanitizeSkillName(name);
  const target = path.join(skillsRoot(home), safe);
  const root = path.resolve(skillsRoot(home));
  if (!path.resolve(target).startsWith(`${root}${path.sep}`)) {
    throw new Error('技能路径不合法');
  }
  if (!fs.existsSync(target)) throw new Error('技能不存在');
  fs.rmSync(target, { recursive: true, force: true });
  return { name: safe };
}

module.exports = {
  skillsRoot,
  sanitizeSkillName,
  parseSkillFrontmatter,
  listSkills,
  findSkillDir,
  installSkillFromDir,
  removeSkill,
};
