'use strict';

const { contextBridge, ipcRenderer } = require('electron');

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
  showInFolder: (target) => ipcRenderer.invoke('shell:show-in-folder', target),

  // 会话
  listSessions: (options) => ipcRenderer.invoke('session:list', options),
  getHistory: (options) => ipcRenderer.invoke('session:history', options),
  deleteSession: (options) => ipcRenderer.invoke('session:delete', options),
  listMcp: () => ipcRenderer.invoke('mcp:list'),
  startSession: (options) => ipcRenderer.invoke('session:start', options),
  resumeSession: (options) => ipcRenderer.invoke('session:resume', options),
  send: (text) => ipcRenderer.invoke('session:send', { text }),
  interrupt: () => ipcRenderer.invoke('session:interrupt'),
  setModel: (model) => ipcRenderer.invoke('session:set-model', { model }),
  setPermissionMode: (mode) => ipcRenderer.invoke('session:set-permission-mode', { mode }),
  closeSession: () => ipcRenderer.invoke('session:close'),
  respondPermission: (id, decision) => ipcRenderer.invoke('permission:respond', { id, decision }),
  respondQuestion: (id, payload) => ipcRenderer.invoke('question:respond', { id, ...payload }),
  respondPlan: (id, decision, editedPlan) => ipcRenderer.invoke('plan:respond', { id, decision, editedPlan }),

  // 事件
  onEvent: subscribe('session:event'),
  onState: subscribe('session:state'),
  onPermission: subscribe('session:permission'),
  onQuestion: subscribe('session:question'),
  onPlan: subscribe('session:plan'),
  onCommands: subscribe('session:commands'),
  onError: subscribe('session:error'),
  onNewSession: subscribe('menu:new-session'),
  onPickDirectory: subscribe('menu:pick-directory'),
});
