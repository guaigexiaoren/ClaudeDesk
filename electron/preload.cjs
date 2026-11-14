'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel) {
  return (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('desk', {
  // 应用
  getState: () => ipcRenderer.invoke('app:get-state'),
  saveSettings: (patch) => ipcRenderer.invoke('app:save-settings', patch),
  pickDirectory: () => ipcRenderer.invoke('dialog:pick-directory'),
  pickAttachments: () => ipcRenderer.invoke('dialog:pick-attachments'),
  describeFile: (path) => ipcRenderer.invoke('file:describe', { path }),
  pathForFile: (file) => webUtils.getPathForFile(file),
  showInFolder: (target) => ipcRenderer.invoke('shell:show-in-folder', target),
  saveText: (options) => ipcRenderer.invoke('dialog:save-text', options),

  // 快速窗口
  quickSubmit: (text) => ipcRenderer.invoke('quick:submit', { text }),
  hideQuick: () => ipcRenderer.invoke('quick:hide'),

  // 会话
  listSessions: (options) => ipcRenderer.invoke('session:list', options),
  getHistory: (options) => ipcRenderer.invoke('session:history', options),
  getPreCompactHistory: (options) => ipcRenderer.invoke('session:history-precompact', options),
  deleteSession: (options) => ipcRenderer.invoke('session:delete', options),
  forkSession: (options) => ipcRenderer.invoke('session:fork', options),
  rewindFiles: (options) => ipcRenderer.invoke('session:rewind', options),
  listMcp: () => ipcRenderer.invoke('mcp:list'),
  addMcp: (payload) => ipcRenderer.invoke('mcp:add', payload),
  removeMcp: (name) => ipcRenderer.invoke('mcp:remove', { name }),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  addSkill: (payload) => ipcRenderer.invoke('skills:add', payload),
  removeSkill: (name) => ipcRenderer.invoke('skills:remove', { name }),
  getLastTurn: (sessionId) => ipcRenderer.invoke('usage:last-turn', { sessionId }),
  envStatus: () => ipcRenderer.invoke('env:status'),
  envAction: (actionId) => ipcRenderer.invoke('env:action', { actionId }),
  getGlobalRules: () => ipcRenderer.invoke('global-rules:get'),
  saveGlobalRules: (content) => ipcRenderer.invoke('global-rules:save', { content }),
  listProviders: () => ipcRenderer.invoke('provider:list'),
  saveProvider: (payload) => ipcRenderer.invoke('provider:save', payload),
  removeProvider: (id) => ipcRenderer.invoke('provider:remove', { id }),
  activateProvider: (id) => ipcRenderer.invoke('provider:activate', { id }),
  pricingStatus: () => ipcRenderer.invoke('pricing:status'),
  syncPricing: () => ipcRenderer.invoke('pricing:sync'),
  usageStats: (options) =>
    ipcRenderer.invoke(
      'usage:stats',
      typeof options === 'string' ? { range: options } : options
    ),
  startSession: (options) => ipcRenderer.invoke('session:start', options),
  resumeSession: (options) => ipcRenderer.invoke('session:resume', options),
  send: (text, options = {}) => ipcRenderer.invoke('session:send', { text, ...options }),
  interrupt: (options = {}) => ipcRenderer.invoke('session:interrupt', options),
  setModel: (options = {}) => ipcRenderer.invoke('session:set-model', options),
  setPermissionMode: (options = {}) => ipcRenderer.invoke('session:set-permission-mode', options),
  closeSession: (options = {}) => ipcRenderer.invoke('session:close', options),
  focusSession: (options = {}) => ipcRenderer.invoke('session:focus', options),
  respondPermission: (payload = {}) => ipcRenderer.invoke('permission:respond', payload),
  respondQuestion: (payload = {}) => ipcRenderer.invoke('question:respond', payload),
  respondPlan: (payload = {}) => ipcRenderer.invoke('plan:respond', payload),

  // 事件
  onEvent: subscribe('session:event'),
  onState: subscribe('session:state'),
  onPermission: subscribe('session:permission'),
  onQuestion: subscribe('session:question'),
  onPlan: subscribe('session:plan'),
  onCommands: subscribe('session:commands'),
  onError: subscribe('session:error'),
  onStderr: subscribe('session:stderr'),
  onSessionReleased: subscribe('session:released'),
  onNewSession: subscribe('menu:new-session'),
  onPickDirectory: subscribe('menu:pick-directory'),
  onMenuExport: subscribe('menu:export'),
  onMenuFind: subscribe('menu:find'),
  onQuickFocus: subscribe('quick:focus'),
  onQuickSend: subscribe('quick:send'),
});
