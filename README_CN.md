# Webnat

[![Electron](https://img.shields.io/badge/Electron-22.0.2%20tested-47848F.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[English](./README.md)

面向 Electron 的轻量级 WebContents-Native 通信库，支持主进程与 `WebContents` 中页面之间的多种通信模式。

## 特性

- **Electron 支持** - 在 Electron 22.0.2（macOS arm64）上验证；页面侧运行在默认沙箱中
- **iframe 支持** - iframe 的消息经主框架转发（由 Web SDK 完成）
- **三种通信模式** - 双向原始消息、广播消息和方法调用（RPC）
- **超时与取消** - 内置超时控制，并通过标准 `AbortSignal` 取消
- **类型安全** - 严格模式 TypeScript 编写

## 安装

本包为私有包，从仓库安装并固定 tag：

```bash
npm install git+ssh://git@github.com/auhgnayuo/webnat-electron.git#v2.0.1
```

`electron` 是可选的 peer 依赖（`>=22.0.0`）；主入口只使用它的类型。

## 相关项目

Webnat 需要 Web 端实现配合，同时支持其他 Native 平台：

| 平台 | 仓库 |
|------|------|
| Web (JavaScript/TypeScript) | [webnat-web](https://github.com/auhgnayuo/webnat-web) |
| iOS / macOS (Swift) | [webnat-darwin](https://github.com/auhgnayuo/webnat-darwin) |
| Android (Kotlin) | [webnat-android](https://github.com/auhgnayuo/webnat-android) |
| HarmonyOS (ArkTS) | [webnat-ohos](https://github.com/auhgnayuo/webnat-ohos) |

## 2.0.1 数据约定与迁移

2.0.1 开始区分字段缺失与显式 JSON null。已发布的 2.0.0 合同 v1 保持不变。

业务参数、方法结果及通知只支持 JSON 兼容数据：`null`、`string`、`boolean`、有限 `number`、
普通字符串键对象和数组，可递归嵌套。`Param` 支持只读数组，并允许对象属性 / 数组元素中的 `undefined`。
顶层 `undefined` 表示字段缺失，显式 `null` 保留；对象中的 `undefined` 属性递归省略，数组中的 `undefined` / 空位转为 `null`。
方法 handler 不返回结果时，远程调用 resolve 为 `undefined`。

拒绝 NaN / Infinity、Date、Map、Set、类实例、函数、BigInt、循环引用、
Symbol 键、访问器及对象隐藏字段。不调用 toJSON / toString 兜底，也不会将非法值改写为 null / 空对象。
JSON 对象请使用普通记录而不是 Map；自定义对象需要显式转换，数组中的空位置请显式填 null。

```typescript
import type { Param } from 'webnat';
const param: Param = { nickname: null, items: [1, null, 3] };
```

发送 / 接收分别通过独立的 `toJsonValue` / `fromJsonValue` 工具进行验证与复制。
JSON 数字仍遵循 JavaScript number 的精度限制，精确的大整数应在业务协议中使用字符串。

公开业务 API 不再使用 any 参数，连接 attributes 只接受普通对象；null、数组或基本类型的连接参数使用空属性对象。
非法 method 参数以 SERIALIZATION_FAILED(-1012) 失败，非法 handler 结果回复该错误；raw / broadcast 仍通过 trySend 静默失败，
但不会发送被隐式改写的数据。非法接收数据拒绝整条消息。
发送脚本先 JSON.parse 再 receive，确保 __proto__ 等合法数据键不被当成 JavaScript 原型设置。
错误的 toJson() 已返回普通记录，不需要改名。

### 真实 Web SDK 互通测试

先在相邻的 webnat-web 仓库执行 `npm run build`，然后在本仓库执行 `npm run test:interop`。
可用 WEBNAT_WEB_SDK_BUNDLE 指定 Web SDK 的 dist/index.js。测试使用真实 Electron / Chromium、preload、IPC 和主框架 / iframe，
数据目录临时隔离，不需要手动注册 preload。npm test 仍包含独立于 Web SDK 的真实 Electron 集成测试和类型检查。

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

### 4. 发送失败与 handler 错误

- 发送失败会让等待它的调用方知道：参数无法序列化时，`method` 立即以 `SERIALIZATION_FAILED` 失败；`WebContents` 已销毁或连接已关闭时以 `CLOSED` 失败。`executeJavaScript` 报错（例如页面里已经没有 Web SDK）时，调用以该错误失败。`raw`、`broadcast` 仍是发出即忘。
- method handler 失败（抛出异常或 reject）时，对端会收到错误回复 `{ code, message }`（没有 code 的错误为 -1），不会因 handler 的 bug 一直等到超时。结果无法序列化时，回复 `SERIALIZATION_FAILED`。

### 5. 页面崩溃与销毁

页面正常卸载时，Web SDK 会发送 CLOSE，Webnat 随之结束该连接。渲染进程崩溃或 `WebContents` 被销毁时页面没有机会发送，所以 `Webnat.of` 会监听 `render-process-gone` 和 `destroyed`，自动调用 `webnat.onRenderProcessGone()`，无需任何接入代码。（其他平台由宿主把自己的回调转给同名方法：Android `onRenderProcessGone`、Darwin `webViewWebContentProcessDidTerminate`、OHOS `onRenderExited`。）Webnat 会自行结束该页面的所有连接：待完成的 `method` 调用以 `CLOSED` 失败，正在执行的 method handler 收到取消。不会向页面发送任何消息，Webnat 仍可继续使用，页面重新加载后会照常建立新连接。

## 工作原理

- **Web → Native**：`window.__native_webnat__.postMessage(string)`（由 `Webnat.of` 注册的 preload 暴露，只转发字符串，从不暴露 `ipcRenderer`）→ `ipcRenderer.send('__native_webnat__.postMessage')` → `Webnat.of` 安装在 `webContents.ipc` 上的监听。
- **Native → Web**：`webContents.executeJavaScript('window.__web_webnat__.receive(...)')`。

## 注意事项

- **桥按 session 注册一次，且不会移除。** Electron 的 preload 挂在 session 上而不是 `WebContents` 上，所以同一个 session 上第一次 `Webnat.of` 注册它，之后的（按文件路径查到已有）不会再加；Electron 35+ 使用 `registerPreloadScript`，旧版使用 `setPreloads`；它随 session 一直存在，就像其他平台的桥随 WebView 一直存在。桥只暴露给顶层框架，即使你开启了 `nodeIntegrationInSubFrames` 也一样。如果你已经自己注册过 `webnat/preload`，也没关系：不会注册两次。
- **UA 标记只覆盖主框架与同源 iframe。** `Webnat.of` 使用 `webContents.setUserAgent`；跨站 iframe 拿不到 `Webnat/`，其中的 Web SDK 不会启用。需要时可用 `app.userAgentFallback`。
- **`method` 调用请设置 `timeout`。** 调用会在页面回复、超时或被取消、或其连接结束（页面卸载、渲染进程崩溃、`WebContents` 销毁）时结束。页面仍然存活却一直不回复时，没有超时的调用会一直挂起。
- **abort 监听器里抛出的异常**会以 `uncaughtException` 到达 Node（原生 `AbortSignal` 语义）。给 handler 的 `signal` 添加监听器时请自行 `try/catch`。

## 示例程序

`example/` 是独立的 Electron 示例应用：在同一个宿主窗口中用 Electron `BrowserView` 内嵌现有的 `webnat-web/example`，并提供 Native 控制区和通信日志。

默认要求 `webnat-web` 仓库与本仓库并列。先安装 Web 示例依赖，再单独安装并运行 Electron 示例：

```bash
cd ../webnat-web/example && npm install
cd ../../webnat-electron/example && npm install && npm start
```

如果 webnat-web 示例在其他位置，可设置 `WEBNAT_WEB_EXAMPLE_DIR=/path/to/webnat-web/example`。如果已有运行中的或已部署的 Web 示例，可设置 `WEBNAT_WEB_EXAMPLE_URL`（例如 `http://127.0.0.1:5173/`）；此时 runner 不会再启动 Vite。

## 开发

```bash
npm install
npm run build        # tsup：dist/（cjs + esm + d.ts）与 dist/preload/index.cjs
npm run typecheck
npm test             # build + 单测 + 真实 Electron 22.0.2 集成测试
```

没有 Electron 二进制的机器可设 `WEBNAT_SKIP_ELECTRON=1` 跳过集成测试。

## 许可证

本项目基于 MIT 许可证。

## 共享回归契约

五端自动消费同一份版本化报文 / 错误解析样例。说明见 `contracts/README.md`；测试门禁、SDK runner 和真机边界见 `contracts/CI.md`。

## 发布

本次统一为 2.0.1 / v2.0.1。请同步升级 Web SDK 与 Native 桥；手动发布命令与迁移说明见 `RELEASING.md`。
