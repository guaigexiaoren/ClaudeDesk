'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const info = {
  version: pkg.version,
  commit: git(['rev-parse', 'HEAD']),
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  dirty: Boolean(git(['status', '--porcelain'])),
  builtAt: new Date().toISOString(),
};

fs.writeFileSync(
  path.join(root, 'electron', 'build-info.json'),
  `${JSON.stringify(info, null, 2)}\n`,
  'utf8'
);

console.log(
  `[build-info] ${info.version} ${info.commit.slice(0, 7) || 'unknown'}${info.dirty ? ' dirty' : ''}`
);
