'use strict';

/**
 * 输入框草稿：按会话 key 保存文字和附件，带 LRU 与内存上限。
 * 附件只复制数组，元素对象共享，图片的 base64 字符串不会因为保存草稿而翻倍。
 */

function draftBytes(draft) {
  if (!draft) return 0;
  let bytes = (draft.text || '').length * 2;
  for (const attachment of draft.attachments || []) {
    bytes +=
      attachment?.data?.length ||
      attachment?.url?.length ||
      Number(attachment?.size) ||
      0;
  }
  return bytes;
}

function createDraftStore({ maxEntries = 8, maxBytes = 32 * 1024 * 1024 } = {}) {
  const entries = new Map();

  const totalBytes = () => {
    let total = 0;
    for (const draft of entries.values()) total += draftBytes(draft);
    return total;
  };

  const evict = () => {
    while (entries.size > maxEntries || totalBytes() > maxBytes) {
      // 刚写入的那条始终保留，避免单个大草稿把自己淘汰
      if (entries.size <= 1) break;
      entries.delete(entries.keys().next().value);
    }
  };

  return {
    get(key) {
      if (!entries.has(key)) return null;
      const draft = entries.get(key);
      // 重新插入，刷新 LRU 顺序
      entries.delete(key);
      entries.set(key, draft);
      return draft;
    },
    set(key, draft) {
      entries.delete(key);
      entries.set(key, {
        text: draft?.text || '',
        attachments: Array.isArray(draft?.attachments) ? draft.attachments.slice() : [],
        start: draft?.start ?? 0,
        end: draft?.end ?? 0,
      });
      evict();
    },
    delete(key) {
      entries.delete(key);
    },
    get size() {
      return entries.size;
    },
    get bytes() {
      return totalBytes();
    },
  };
}

module.exports = { createDraftStore };
