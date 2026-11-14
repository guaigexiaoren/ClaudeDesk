'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseSkillFrontmatter,
  findSkillDir,
  installSkillFromDir,
  listSkills,
  removeSkill,
  sanitizeSkillName,
} = require('../electron/skills');

function tempDir(prefix = 'claudedesk-skill-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('解析 SKILL.md 的 frontmatter', () => {
  assert.deepEqual(
    parseSkillFrontmatter('---\nname: my-skill\ndescription: "做一个东西"\n---\n正文'),
    { name: 'my-skill', description: '做一个东西' }
  );
  assert.deepEqual(parseSkillFrontmatter('没有 frontmatter'), { name: '', description: '' });
});

test('技能名称只允许安全字符且拒绝路径穿越', () => {
  assert.equal(sanitizeSkillName('my-skill_1'), 'my-skill_1');
  assert.throws(() => sanitizeSkillName('../evil'), /不合法/);
  assert.throws(() => sanitizeSkillName('..'), /不合法/);
  assert.throws(() => sanitizeSkillName(''), /不合法/);
});

test('在仓库子目录中找到 SKILL.md，安装后可列出并删除', () => {
  const home = tempDir('claudedesk-home-');
  const repo = tempDir('claudedesk-repo-');
  try {
    const skillDir = path.join(repo, 'skills', 'hello');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: hello-skill\ndescription: 打招呼\n---\n说你好',
      'utf8'
    );
    fs.writeFileSync(path.join(skillDir, 'helper.txt'), 'x', 'utf8');

    assert.equal(findSkillDir(repo), skillDir);
    assert.throws(() => findSkillDir(repo, '..'), /子目录/);

    const installed = installSkillFromDir(home, repo, 'skills/hello');
    assert.equal(installed.name, 'hello-skill');
    assert.equal(fs.existsSync(path.join(installed.path, 'helper.txt')), true);

    const list = listSkills(home);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'hello-skill');
    assert.equal(list[0].description, '打招呼');

    assert.throws(() => installSkillFromDir(home, repo), /已存在/);
    removeSkill(home, 'hello-skill');
    assert.equal(listSkills(home).length, 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('没有 SKILL.md 时拒绝安装', () => {
  const home = tempDir();
  const repo = tempDir();
  try {
    assert.throws(() => installSkillFromDir(home, repo), /没有找到/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('仓库有多个技能时要求填写子目录', () => {
  const repo = tempDir();
  try {
    for (const name of ['a', 'b']) {
      const dir = path.join(repo, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n`, 'utf8');
    }
    assert.throws(() => findSkillDir(repo), /多个技能/);
    assert.equal(findSkillDir(repo, 'b'), path.join(repo, 'b'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
