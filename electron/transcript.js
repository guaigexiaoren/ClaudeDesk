'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CACHE = 3;

const messageCache = new Map();

function findSessionTranscript(home, sessionId) {
  if (!SESSION_ID_RE.test(String(sessionId || ''))) return null;
  const projects = path.join(home, '.claude', 'projects');
  let entries = [];
  try {
    entries = fs.readdirSync(projects, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(projects, entry.name, `${sessionId}.jsonl`);
    try {
      const stat = fs.statSync(file);
      if (stat.isFile()) candidates.push({ file, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {
      /* 不是这个项目目录 */
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] || null;
}

function isDisplayable(entry) {
  if (!entry || (entry.type !== 'user' && entry.type !== 'assistant')) return false;
  if (entry.isSidechain) return false;
  if (entry.isMeta) return false;
  if (entry.isVisibleInTranscriptOnly && !entry.isCompactSummary) return false;
  return Boolean(entry.message);
}

function toSessionMessage(entry) {
  return {
    type: entry.type,
    uuid: entry.uuid,
    session_id: entry.sessionId || entry.session_id || '',
    parent_tool_use_id: entry.parent_tool_use_id || null,
    parent_agent_id: entry.agentId || entry.agent_id || null,
    timestamp: entry.timestamp,
    message: entry.message,
    isCompactSummary: Boolean(entry.isCompactSummary),
    is_meta: Boolean(entry.isMeta),
    ...(entry.origin ? { origin: entry.origin } : {}),
  };
}

function parseEntries(raw) {
  const list = [];
  const map = new Map();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      list.push(entry);
      if (entry && typeof entry.uuid === 'string') map.set(entry.uuid, entry);
    } catch {
      /* 跳过坏行 */
    }
  }
  return { list, map };
}

function buildPreCompactMessagesFromRaw(raw) {
  const { list, map } = parseEntries(raw);
  let boundary = null;
  for (const entry of list) {
    if (entry?.type === 'system' && entry.subtype === 'compact_boundary') boundary = entry;
  }
  if (!boundary || !boundary.logicalParentUuid) return [];

  const picked = [];
  const seen = new Set();
  let current = boundary.logicalParentUuid;
  while (current && map.has(current) && !seen.has(current)) {
    seen.add(current);
    const entry = map.get(current);
    if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
      // 跨过更早的一次压缩，继续往前接
      current = entry.logicalParentUuid;
      continue;
    }
    if (isDisplayable(entry)) picked.push(toSessionMessage(entry));
    current = entry.parentUuid;
  }
  picked.reverse();
  return picked;
}

function loadMessages(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return [];
  }
  const key = `${file}:${stat.mtimeMs}:${stat.size}`;
  if (messageCache.has(key)) {
    const cached = messageCache.get(key);
    messageCache.delete(key);
    messageCache.set(key, cached);
    return cached;
  }

  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const messages = buildPreCompactMessagesFromRaw(raw);
  messageCache.set(key, messages);
  while (messageCache.size > MAX_CACHE) {
    messageCache.delete(messageCache.keys().next().value);
  }
  return messages;
}

/**
 * 从原始 transcript 读取压缩前历史。offset=0 返回最近一页，
 * 之后 offset 递增会返回更早的页；消息在每页内保持旧→新顺序。
 */
function readPreCompactPage(file, { limit = 100, offset = 0 } = {}) {
  const messages = loadMessages(file);
  const total = messages.length;
  const size = Math.min(Math.max(1, Number(limit) || 100), 200);
  const startOffset = Math.max(0, Number(offset) || 0);
  const end = Math.max(0, total - startOffset);
  const start = Math.max(0, end - size);
  const page = messages.slice(start, end);
  return {
    messages: page,
    total,
    hasMore: start > 0,
    nextOffset: startOffset + page.length,
  };
}

module.exports = {
  findSessionTranscript,
  buildPreCompactMessagesFromRaw,
  readPreCompactPage,
};
