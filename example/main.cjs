'use strict';

const path = require('node:path');
const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron');
const { Webnat } = require('../dist/index.cjs');

const webUrl = process.argv[2] || 'http://127.0.0.1:5173/';
const sampleParam = {
  message: 'Hello from Electron',
  unicode: '你好 Electron 👋',
  items: [1, 2, 3],
};
const PANEL_HEIGHT = 360;

let window;
let webView;
let webnat;
let stateTimer;
let panelHandlersRegistered = false;
const logs = [];

function publishState() {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send('example:state', {
    connected: Boolean(webnat && webnat.getConnections().size > 0),
    connections: webnat ? webnat.getConnections().size : 0,
    webUrl,
  });
}

function log(type, message, data) {
  const entry = {
    time: new Date().toLocaleTimeString(),
    type,
    message,
    data: data === undefined ? null : data,
  };
  logs.push(entry);
  if (logs.length > 300) logs.shift();

  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send('example:log', entry);
  }
}

function getConnection() {
  if (!webnat) throw new Error('Webnat 尚未初始化');
  const connection = webnat.getConnections().values().next().value;
  if (!connection) throw new Error('还没有 Web 端连接；请先等待 webnat-web 示例加载完成');
  return connection;
}

function updateWebViewBounds() {
  if (!window || !webView || window.isDestroyed()) return;
  const { width, height } = window.getContentBounds();
  webView.setBounds({
    x: 0,
    y: PANEL_HEIGHT,
    width,
    height: Math.max(0, height - PANEL_HEIGHT),
  });
}

function waitWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason || new Error('操作已取消'));
      return;
    }
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason || new Error('操作已取消'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function registerPanelHandlers() {
  if (panelHandlersRegistered) return;
  panelHandlersRegistered = true;

  ipcMain.handle('example:send-raw', () => {
    const connection = getConnection();
    webnat.raw(sampleParam, connection);
    log('sent', `发送 Native Raw（${connection.id}）`, sampleParam);
  });
  ipcMain.handle('example:send-broadcast', () => {
    const connection = getConnection();
    webnat.broadcast('test-broadcast', sampleParam, connection);
    log('sent', `发送 Native Broadcast: test-broadcast（${connection.id}）`, sampleParam);
  });
  ipcMain.handle('example:send-method', async () => {
    const connection = getConnection();
    log('sent', `调用 Web Method: test-method（${connection.id}）`, sampleParam);
    try {
      const result = await webnat.method(
        { method: 'test-method', param: sampleParam },
        {
          timeout: 10_000,
          onNotification: (notification) => log('received', '收到 Web Method 通知', notification),
        },
        connection,
      );
      log('received', 'Web Method 返回结果', result);
    } catch (error) {
      log('error', `Web Method 调用失败：${error.message || error}`, null);
      throw error;
    }
  });
  ipcMain.handle('example:clear-logs', () => {
    logs.length = 0;
    if (window && !window.isDestroyed()) window.webContents.send('example:clear-logs');
  });
}

function createWindow() {
  // The native control panel and the embedded WebContents use separate sessions so Webnat's session preload
  // is only attached to the webnat-web page.
  window = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 760,
    minHeight: 600,
    title: 'Webnat Electron Example',
    webPreferences: {
      session: session.fromPartition(`webnat-example-shell-${process.pid}`),
      preload: path.join(__dirname, 'panel-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  webView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.setBrowserView(webView);
  updateWebViewBounds();
  window.on('resize', updateWebViewBounds);
  window.on('closed', () => {
    window = null;
    webView = null;
  });

  // Initialize before loading the Web app: this adds the UA token and installs the page-side bridge.
  webnat = Webnat.of(webView.webContents);
  webnat.onRaw((raw, connection) => {
    log('received', `收到 Web Raw（${connection.id}）`, raw);
  });
  webnat.onBroadcast('test-broadcast', (param, connection) => {
    log('received', `收到 Web Broadcast: test-broadcast（${connection.id}）`, param);
  });
  webnat.onMethod('test-method', async (param, signal, notify, connection) => {
    log('received', `收到 Web Method: test-method（${connection.id}）`, param);
    notify({ progress: 50, message: 'Electron 处理中…' });
    await waitWithAbort(500, signal);
    return { success: true, result: 'Electron Method 调用成功', receivedParam: param };
  });
  webView.webContents.on('did-fail-load', (_event, code, description, url) => {
    if (url === webUrl || url.startsWith(webUrl)) {
      log('error', `Web 页面加载失败 (${code}): ${description}`);
    }
  });

  window.webContents.once('did-finish-load', () => {
    for (const entry of logs) window.webContents.send('example:log', entry);
    publishState();
  });
  window.loadFile(path.join(__dirname, 'panel.html'));
  webView.webContents.loadURL(webUrl).catch((error) => {
    log('error', `无法打开 Web 示例：${error.message}`);
  });
  registerPanelHandlers();
}

app.whenReady().then(() => {
  app.setName('Webnat Electron Example');
  createWindow();
  stateTimer = setInterval(publishState, 500);
});

app.on('before-quit', () => {
  if (stateTimer) clearInterval(stateTimer);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!window) createWindow();
});
