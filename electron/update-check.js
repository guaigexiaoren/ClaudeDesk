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
 * 版本号升高，或 main 上出现了构建时间之后的新提交，都视为有更新。
 * 版本号拿不到时仍可依靠提交时间和构建时间判断。
 */
function evaluateUpdate({
  currentVersion = '',
  buildTime = '',
  buildCommit = '',
  remoteVersion = '',
  remoteCommit = null,
} = {}) {
  const versionNewer =
    Boolean(remoteVersion) && compareVersions(remoteVersion, currentVersion) > 0;
  const remoteSha = String(remoteCommit?.sha || '');
  const remoteTime = Date.parse(remoteCommit?.date || '');
  const builtAt = Date.parse(buildTime || '');
  const commitNewer = Boolean(
    remoteSha &&
      Number.isFinite(remoteTime) &&
      Number.isFinite(builtAt) &&
      remoteTime > builtAt &&
      remoteSha !== String(buildCommit || '')
  );

  return {
    hasUpdate: versionNewer || commitNewer,
    reason: versionNewer ? 'version' : commitNewer ? 'commit' : '',
    latestVersion: normalizeVersion(remoteVersion),
    latestCommit: remoteSha,
    latestDate: remoteCommit?.date || '',
    latestMessage: remoteCommit?.message || '',
  };
}

module.exports = {
  normalizeVersion,
  parseVersion,
  compareVersions,
  evaluateUpdate,
};
