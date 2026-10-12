# Webnat

[![Electron](https://img.shields.io/badge/Electron-44.7.0%20tested-47848F.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[中文文档](./README_CN.md)

A lightweight WebContents-Native bridge library for Electron. Supports multiple communication modes between the main process and the pages loaded in a `WebContents`.

## Features

- **Electron Support** - Tested on Electron 44.7.0 (macOS arm64); the page side runs in the default sandbox
- **iframe Support** - Messages of iframes are forwarded through the top frame (done by the Web SDK)
- **Three Communication Modes** - Bidirectional raw messages, broadcast messages, and method calls (RPC)
- **Timeout & Cancellation** - Built-in timeout control and cancellation through the standard `AbortSignal`
- **Type Safety** - Written in strict TypeScript

## Installation

This package is private. Install it from the repository and pin a tag:

```bash
npm install git+ssh://git@code.comein.cn/mobile/private/electron/webnat.git#<tag>
```

`electron` is an optional peer dependency (`>=44.0.0`); the main entry only uses its types.

## Related Projects

Webnat requires a Web-side implementation and also supports other Native platforms:

| Platform | Repository |
|----------|------------|
| Web (JavaScript/TypeScript) | [webnat-web](https://github.com/auhgnayuo/webnat-web) |
| iOS / macOS (Swift) | [webnat-darwin](https://github.com/auhgnayuo/webnat-darwin) |
| Android (Kotlin) | [webnat-android](https://github.com/auhgnayuo/webnat-android) |
| HarmonyOS (ArkTS) | [webnat-ohos](https://github.com/auhgnayuo/webnat-ohos) |

## Usage

### 1. Initialization

```typescript
import { BrowserWindow } from 'electron';
import { Webnat } from 'webnat-electron';

const win = new BrowserWindow();
const webnat = Webnat.of(win.webContents); // one instance per WebContents
await win.loadURL(url);                    // call `Webnat.of` first: the page only sees what was set up before it loads
```

`Webnat.of` does all the setup, like on the other platforms: it writes `Webnat/{version}` into the UA, listens for the page's messages, and registers the page-side bridge (a preload script) on the WebContents' session. You never register anything yourself, and you never configure `webPreferences.preload`; keep `sandbox` and `contextIsolation` on.

### 2. Wait for Web-side Connection

Connections are initiated by the **Web side (JavaScript)**. The Native side automatically receives and manages connections.

```typescript
const connections = webnat.getConnections();
console.log('Active connections:', connections.size);

const connection = Array.from(connections.values())[0];
if (connection) {
  console.log('Connection found:', connection.id);
  console.log('Attributes:', connection.attributes ?? {});
}
```

### 3. Send and Receive Messages

```typescript
// Send raw message
webnat.raw('Hello from Native!', connection);

// Listen for raw messages
webnat.onRaw((raw, connection) => {
  console.log('From', connection.id, ':', raw);
});

// Broadcast (to every connection when `connection` is omitted)
webnat.broadcast('userLoggedIn', { userId: 123 }, connection);

// Listen for broadcasts
webnat.onBroadcast('userLoggedIn', (param, connection) => {
  console.log('Broadcast from', connection.id, ':', param ?? 'nil');
});

// Call a Web-side method
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

// Register a method for the Web side to call
// (import { setTimeout as delay } from 'node:timers/promises')
webnat.onMethod('getUserInfo', async (param, signal, notify, connection) => {
  notify({ progress: 50 });

  // `signal` is a real AbortSignal: pass it to fetch, timers/promises, ...
  await delay(1000, undefined, { signal });

  return { userId: param?.userId ?? 0, name: 'User' };
});
```

Cancel a call with a standard `AbortController`:

```typescript
const controller = new AbortController();
const pending = webnat.method({ method: 'slowTask' }, { signal: controller.signal, timeout: 30_000 }, connection);
controller.abort(); // rejects with a WebnatError (code CANCELLED) and tells the peer to stop
```

Without a `connection`, `method` calls every connection and the first meaningful response wins; "unimplemented" and "closed" replies only eliminate a candidate.

## How It Works

- **Web → Native**: `window.__native_webnat__.postMessage(string)` (exposed by the preload that `Webnat.of` registers; it forwards strings and nothing else and never exposes `ipcRenderer`) → `ipcRenderer.send('__native_webnat__.postMessage')` → the `webContents.ipc` listener installed by `Webnat.of`.
- **Native → Web**: `webContents.executeJavaScript('window.__web_webnat__.receive(...)')`.

## Notes

- **The bridge is registered per session, once, and never removed.** Electron attaches preloads to a session, not to a `WebContents`, so the first `Webnat.of` on a session registers it and later ones (found by file path) add nothing; it stays for the life of the session, as the other platforms' bridges stay for the life of the WebView. It exposes the bridge to the top frame only, even when you enable `nodeIntegrationInSubFrames`. If you already registered `webnat-electron/preload` yourself, that is fine too: it is not registered twice.
- **The UA token covers the main frame and same-origin iframes only.** `Webnat.of` uses `webContents.setUserAgent`; a cross-site iframe does not get `Webnat/` and the Web SDK stays disabled there. `app.userAgentFallback` is the lever if you need it.
- **`onMethod` handlers must be `async`** (or return a Promise). A synchronous throw does not produce a reply, so the peer waits until its timeout.
- **Set a `timeout` on `method` calls.** There is no cleanup API: when a `WebContents` is destroyed everything attached to it dies with it, and a call without a timeout stays pending forever.
- **An exception thrown by an abort listener** reaches Node as an `uncaughtException` (native `AbortSignal` semantics). Wrap listeners you add to a handler's `signal` in `try/catch`.

## Development

```bash
npm install
npm run build        # tsup: dist/ (cjs + esm + d.ts) and dist/preload/index.cjs
npm run typecheck
npm test             # build + unit tests + a real Electron 44.7.0 integration run
```

Set `WEBNAT_SKIP_ELECTRON=1` to skip the Electron integration test on a machine without the Electron binary.

## License

This project is licensed under the MIT License.
