'use strict';

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function parseVersion(value) {
  const cleaned = normalizeVersion(value);
  if (!cleaned) return [];
  return cleaned.split(/[.+-]/).map((part) => {
    const match = part.match(/^\d+/);
    return match ? Number(match[0]) : 0;
  });
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * 版本号升高，或远端分支出现了当前构建没有的提交，都视为有更新。
 * comparison 来自 GitHub compare API：ahead/diverged 且 ahead_by > 0 说明远端有新增提交。
 * 没有 comparison 时退回提交时间和构建时间比较。
 */
function evaluateUpdate({
  currentVersion = '',
  buildTime = '',
  buildCommit = '',
  remoteVersion = '',
  remoteCommit = null,
  comparison = null,
} = {}) {
  const versionNewer =
    Boolean(remoteVersion) && compareVersions(remoteVersion, currentVersion) > 0;
  const remoteSha = String(remoteCommit?.sha || '');
  const remoteTime = Date.parse(remoteCommit?.date || '');
  const builtAt = Date.parse(buildTime || '');
  let commitNewer = false;
  if (comparison && typeof comparison === 'object') {
    const aheadBy = Number(comparison.aheadBy) || 0;
    commitNewer =
      (comparison.status === 'ahead' || comparison.status === 'diverged') && aheadBy > 0;
  } else {
    commitNewer = Boolean(
      remoteSha &&
        Number.isFinite(remoteTime) &&
        Number.isFinite(builtAt) &&
        remoteTime > builtAt &&
        remoteSha !== String(buildCommit || '')
    );
  }

  return {
    hasUpdate: versionNewer || commitNewer,
    reason: versionNewer ? 'version' : commitNewer ? 'commit' : '',
    latestVersion: normalizeVersion(remoteVersion),
    latestCommit: remoteSha,
    latestDate: remoteCommit?.date || '',
    latestMessage: remoteCommit?.message || '',
  };
}

function pickNewestCommit(commits = []) {
  const valid = commits.filter(
    (item) => item && item.sha && Number.isFinite(Date.parse(item.date || ''))
  );
  if (valid.length === 0) return null;
  return valid.reduce((newest, item) =>
    Date.parse(item.date) > Date.parse(newest.date) ? item : newest
  );
}

module.exports = {
  normalizeVersion,
  parseVersion,
  compareVersions,
  evaluateUpdate,
  pickNewestCommit,
};
