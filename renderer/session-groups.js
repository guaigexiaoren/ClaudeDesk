'use strict';

/**
 * 把会话按工作目录分组，并过滤掉回收站里的会话。
 *
 * @param {Array} sessions    listSessions 返回的会话摘要
 * @param {Array} trash       回收站记录，元素至少包含 sessionId
 * @param {string} currentDir 当前工作目录；即使没有会话也要显示这个分组
 * @returns {Array<{dir:string,name:string,latest:number,sessions:Array}>}
 */
function buildSessionGroups(sessions, trash, currentDir) {
  const trashed = new Set((trash || []).map((item) => item.sessionId));
  const groups = new Map();

  const ensure = (dir) => {
    if (!groups.has(dir)) groups.set(dir, { dir, sessions: [], latest: 0 });
    return groups.get(dir);
  };

  for (const session of sessions || []) {
    if (trashed.has(session.sessionId)) continue;
    const dir = session.cwd || '(未知目录)';
    const group = ensure(dir);
    group.sessions.push(session);
    group.latest = Math.max(group.latest, session.lastModified || 0);
  }

  if (currentDir) ensure(currentDir);

  return [...groups.values()]
    .map((group) => ({
      ...group,
      sessions: group.sessions.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0)),
      name: group.dir.split(/[\\/]/).filter(Boolean).pop() || group.dir,
    }))
    .sort((a, b) => b.latest - a.latest);
}

module.exports = { buildSessionGroups };
