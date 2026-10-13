'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('nativeExample', {
  onLog: (callback) => subscribe('example:log', callback),
  onState: (callback) => subscribe('example:state', callback),
  onClearLogs: (callback) => subscribe('example:clear-logs', callback),
  sendRaw: () => ipcRenderer.invoke('example:send-raw'),
  sendBroadcast: () => ipcRenderer.invoke('example:send-broadcast'),
  sendMethod: () => ipcRenderer.invoke('example:send-method'),
  clearLogs: () => ipcRenderer.invoke('example:clear-logs'),
});
