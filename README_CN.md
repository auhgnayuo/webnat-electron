# Webnat

[![Electron](https://img.shields.io/badge/Electron-44.7.0%20tested-47848F.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[English](./README.md)

面向 Electron 的轻量级 WebContents-Native 通信库，支持主进程与 `WebContents` 中页面之间的多种通信模式。

## 特性

- **Electron 支持** - 在 Electron 44.7.0（macOS arm64）上验证；页面侧运行在默认沙箱中
- **iframe 支持** - iframe 的消息经主框架转发（由 Web SDK 完成）
- **三种通信模式** - 双向原始消息、广播消息和方法调用（RPC）
- **超时与取消** - 内置超时控制，并通过标准 `AbortSignal` 取消
- **类型安全** - 严格模式 TypeScript 编写

## 安装

本包为私有包，从仓库安装并固定 tag：

```bash
npm install git+ssh://git@code.comein.cn/mobile/private/electron/webnat.git#<tag>
```

`electron` 是可选的 peer 依赖（`>=44.0.0`）；主入口只使用它的类型。

## 相关项目

Webnat 需要 Web 端实现配合，同时支持其他 Native 平台：

| 平台 | 仓库 |
|------|------|
| Web (JavaScript/TypeScript) | [webnat-web](https://github.com/auhgnayuo/webnat-web) |
| iOS / macOS (Swift) | [webnat-darwin](https://github.com/auhgnayuo/webnat-darwin) |
| Android (Kotlin) | [webnat-android](https://github.com/auhgnayuo/webnat-android) |
| HarmonyOS (ArkTS) | [webnat-ohos](https://github.com/auhgnayuo/webnat-ohos) |

## 使用

### 1. 初始化

```typescript
import { BrowserWindow } from 'electron';
import { Webnat } from 'webnat';

const win = new BrowserWindow();
const webnat = Webnat.of(win.webContents); // 每个 WebContents 一个实例
await win.loadURL(url);                    // 先调用 `Webnat.of`：页面只能看到它加载之前已经准备好的东西
```

`Webnat.of` 一次做完全部准备，和其他平台一样：把 `Webnat/{version}` 写进 UA、监听页面发来的消息、并把页面侧的桥（一个 preload 脚本）注册到该 WebContents 所在的 session 上。你不需要自己注册任何东西，也不要配置 `webPreferences.preload`；请保持 `sandbox` 与 `contextIsolation` 开启。

### 2. 等待 Web 端连接

连接由 **Web 端（JavaScript）** 发起，Native 端自动接收并管理。

```typescript
const connections = webnat.getConnections();
console.log('Active connections:', connections.size);

const connection = Array.from(connections.values())[0];
if (connection) {
  console.log('Connection found:', connection.id);
  console.log('Attributes:', connection.attributes ?? {});
}
```

### 3. 收发消息

```typescript
// 发送原始消息
webnat.raw('Hello from Native!', connection);

// 监听原始消息
webnat.onRaw((raw, connection) => {
  console.log('From', connection.id, ':', raw);
});

// 广播（省略 `connection` 则发给所有连接）
webnat.broadcast('userLoggedIn', { userId: 123 }, connection);

// 监听广播
webnat.onBroadcast('userLoggedIn', (param, connection) => {
  console.log('Broadcast from', connection.id, ':', param ?? 'nil');
});

// 调用 Web 端方法
try {
  const result = await webnat.method(
    { method: 'getUserInfo', param: { userId: 123 } },
    { timeout: 5000 },
    connection,
  );
  console.log('User info:', result ?? 'nil');
} catch (error) {
  console.error('Error:', error);
}

// 注册供 Web 端调用的方法
// (import { setTimeout as delay } from 'node:timers/promises')
webnat.onMethod('getUserInfo', async (param, signal, notify, connection) => {
  notify({ progress: 50 });

  // `signal` 是真正的 AbortSignal：可以直接传给 fetch、timers/promises 等
  await delay(1000, undefined, { signal });

  return { userId: param?.userId ?? 0, name: 'User' };
});
```

用标准 `AbortController` 取消调用：

```typescript
const controller = new AbortController();
const pending = webnat.method({ method: 'slowTask' }, { signal: controller.signal, timeout: 30_000 }, connection);
controller.abort(); // 以 WebnatError（code 为 CANCELLED）reject，并通知对端停止
```

不传 `connection` 时，`method` 会调用所有连接，第一个有意义的响应胜出；「未实现」与「已关闭」的回复只会淘汰对应候选。

## 工作原理

- **Web → Native**：`window.__native_webnat__.postMessage(string)`（由 `Webnat.of` 注册的 preload 暴露，只转发字符串，从不暴露 `ipcRenderer`）→ `ipcRenderer.send('__native_webnat__.postMessage')` → `Webnat.of` 安装在 `webContents.ipc` 上的监听。
- **Native → Web**：`webContents.executeJavaScript('window.__web_webnat__.receive(...)')`。

## 注意事项

- **桥按 session 注册一次，且不会移除。** Electron 的 preload 挂在 session 上而不是 `WebContents` 上，所以同一个 session 上第一次 `Webnat.of` 注册它，之后的（按文件路径查到已有）不会再加；它随 session 一直存在，就像其他平台的桥随 WebView 一直存在。桥只暴露给顶层框架，即使你开启了 `nodeIntegrationInSubFrames` 也一样。如果你已经自己注册过 `webnat/preload`，也没关系：不会注册两次。
- **UA 标记只覆盖主框架与同源 iframe。** `Webnat.of` 使用 `webContents.setUserAgent`；跨站 iframe 拿不到 `Webnat/`，其中的 Web SDK 不会启用。需要时可用 `app.userAgentFallback`。
- **`onMethod` 的 handler 必须是 `async`**（或返回 Promise）。同步抛错不会产生回复，对端会一直等到超时。
- **`method` 调用请设置 `timeout`。** 没有清理 API：`WebContents` 销毁后，挂在它上面的一切随之失效，没有超时的调用会一直挂起。
- **abort 监听器里抛出的异常**会以 `uncaughtException` 到达 Node（原生 `AbortSignal` 语义）。给 handler 的 `signal` 添加监听器时请自行 `try/catch`。

## 开发

```bash
npm install
npm run build        # tsup：dist/（cjs + esm + d.ts）与 dist/preload/index.cjs
npm run typecheck
npm test             # build + 单测 + 真实 Electron 44.7.0 集成测试
```

没有 Electron 二进制的机器可设 `WEBNAT_SKIP_ELECTRON=1` 跳过集成测试。

## 许可证

本项目基于 MIT 许可证。
