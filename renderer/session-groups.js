'use strict';

/**
 * 把会话按工作目录分组，并过滤掉回收站里的会话。
 *
 * @param {Array} sessions    listSessions 返回的会话摘要
 * @param {Array} trash       回收站记录，元素至少包含 sessionId
 * @param {string} currentDir 当前工作目录；即使没有会话也要显示这个分组
 * @param {{pinned?: string[], query?: string}} options
 *        置顶的会话单列一组放在最上面；query 按标题/目录过滤
 * @returns {Array<{dir:string,name:string,latest:number,sessions:Array,pinned?:boolean}>}
 */
function buildSessionGroups(sessions, trash, currentDir, options = {}) {
  const trashed = new Set((trash || []).map((item) => item.sessionId));
  const pinned = new Set(options.pinned || []);
  const query = (options.query || '').trim().toLowerCase();
  const groups = new Map();
  const pinnedSessions = [];
  // 按创建时间排序，会话创建后位置就固定下来，不会因为发消息而跳到最上面
  const orderTime = (session) => session.createdAt || session.lastModified || 0;

  const ensure = (dir) => {
    if (!groups.has(dir)) groups.set(dir, { dir, sessions: [], latest: 0 });
    return groups.get(dir);
  };

  const matches = (session) => {
    if (!query) return true;
    return [session.title, session.cwd].some((value) =>
      String(value || '').toLowerCase().includes(query)
    );
  };

  for (const session of sessions || []) {
    if (trashed.has(session.sessionId) || !matches(session)) continue;
    if (pinned.has(session.sessionId)) {
      pinnedSessions.push(session);
      continue;
    }
    const dir = session.cwd || '(未知目录)';
    const group = ensure(dir);
    group.sessions.push(session);
    group.latest = Math.max(group.latest, orderTime(session));
  }

  if (currentDir && !query) ensure(currentDir);

  const normal = [...groups.values()]
    .map((group) => ({
      ...group,
      sessions: group.sessions.sort((a, b) => orderTime(b) - orderTime(a)),
      name: group.dir.split(/[\\/]/).filter(Boolean).pop() || group.dir,
    }))
    .sort((a, b) => b.latest - a.latest);

  if (pinnedSessions.length === 0) return normal;

  pinnedSessions.sort((a, b) => orderTime(b) - orderTime(a));
  return [
    {
      dir: '',
      name: '置顶',
      latest: pinnedSessions[0].lastModified || 0,
      sessions: pinnedSessions,
      pinned: true,
    },
    ...normal,
  ];
}

module.exports = { buildSessionGroups };
