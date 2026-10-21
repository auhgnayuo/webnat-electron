# Webnat

[![Electron](https://img.shields.io/badge/Electron-22.0.2%20tested-47848F.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[中文文档](./README_CN.md)

A lightweight WebContents-Native bridge library for Electron. Supports multiple communication modes between the main process and the pages loaded in a `WebContents`.

## Features

- **Electron Support** - Tested on Electron 22.0.2 (macOS arm64); the page side runs in the default sandbox
- **iframe Support** - Messages of iframes are forwarded through the top frame (done by the Web SDK)
- **Three Communication Modes** - Bidirectional raw messages, broadcast messages, and method calls (RPC)
- **Timeout & Cancellation** - Built-in timeout control and cancellation through the standard `AbortSignal`
- **Type Safety** - Written in strict TypeScript

## Installation

This package is private. Install it from the repository and pin a tag:

```bash
npm install git+ssh://git@github.com/auhgnayuo/webnat-electron.git#v2.0.0
```

`electron` is an optional peer dependency (`>=22.0.0`); the main entry only uses its types.

## Related Projects

Webnat requires a Web-side implementation and also supports other Native platforms:

| Platform | Repository |
|----------|------------|
| Web (JavaScript/TypeScript) | [webnat-web](https://github.com/auhgnayuo/webnat-web) |
| iOS / macOS (Swift) | [webnat-darwin](https://github.com/auhgnayuo/webnat-darwin) |
| Android (Kotlin) | [webnat-android](https://github.com/auhgnayuo/webnat-android) |
| HarmonyOS (ArkTS) | [webnat-ohos](https://github.com/auhgnayuo/webnat-ohos) |

## 2.0.0 Data Contract and Migration

Business parameters, results, and notifications accept only null, strings, booleans, finite numbers,
plain string-keyed records, and arrays, recursively. The public `Param` type no longer includes nested
undefined and supports readonly arrays. Missing top-level values become null; top-level null fields
are omitted on the wire, while nested null keys / array positions are preserved.
Handlers may return no result; the remote method resolves to null.

NaN / Infinity, Date, Map, Set, class instances, functions, BigInt, cycles, nested undefined, array holes,
symbol keys, accessors, and hidden record fields are rejected. There is no toJSON / toString fallback,
field deletion, or implicit conversion to null / empty objects. Use plain records instead of Map,
convert custom objects explicitly, and fill nullable array positions with null.

```typescript
import type { Param } from 'webnat';
const param: Param = { nickname: null, items: [1, null, 3] };
```

Separate toJsonValue / fromJsonValue helpers validate and copy outgoing / incoming values.
JavaScript number precision limits still apply; represent exact large integers as protocol strings.

Business APIs use Param instead of any. Connection attributes accept plain objects only; scalar, array, or null
connection parameters use an empty attributes object. Invalid method parameters reject with SERIALIZATION_FAILED(-1012),
invalid handler results produce that error reply, and raw / broadcast remain best-effort via trySend without transmitting
implicitly rewritten values. Invalid incoming messages are rejected as a whole.
Scripts parse JSON text before receive, so __proto__ remains an ordinary data key rather than a JavaScript prototype setter.
Error toJson() already returns a plain record and keeps its name.

### Real Web SDK interop tests

Build the adjacent webnat-web checkout using `npm run build`, then run `npm run test:interop` here. Override
WEBNAT_WEB_SDK_BUNDLE to point to the Web SDK dist/index.js. Tests use real Electron / Chromium, preload, IPC, main frames,
and iframes with an isolated temporary profile. npm test still includes standalone real Electron integration and type checks.

## Usage

### 1. Initialization

```typescript
import { BrowserWindow } from 'electron';
import { Webnat } from 'webnat';

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

### 4. Send failures and handler errors

- A failed send is visible to the caller that waits for it: `method` rejects at once with `SERIALIZATION_FAILED` when the parameter cannot be serialized, and with `CLOSED` when the `WebContents` is destroyed or the connection is closed. An error from `executeJavaScript` (for example the page has no Web SDK any more) rejects the call with that error. `raw` and `broadcast` stay fire-and-forget.
- A method handler that fails (throws, or rejects) is answered with an error reply `{ code, message }` (code -1 for an error without one), so the caller never waits for its timeout because of a handler bug. A result that cannot be serialized is answered with `SERIALIZATION_FAILED`.

### 5. Page crash and teardown

When a page unloads normally, the Web SDK sends CLOSE and Webnat ends that connection. A crashed render process or a destroyed `WebContents` never gets to send it, so `Webnat.of` listens for `render-process-gone` and `destroyed` and calls `webnat.onRenderProcessGone()` for you; there is nothing to wire up. (On the other platforms the host forwards its own hook to the method named after it: Android `onRenderProcessGone`, Darwin `webViewWebContentProcessDidTerminate`, OHOS `onRenderExited`.) Webnat then ends the page's connections itself: pending `method` calls reject with `CLOSED` and running method handlers are aborted. Nothing is sent to the page, and Webnat stays usable, so a reloaded page opens new connections as usual.

## How It Works

- **Web → Native**: `window.__native_webnat__.postMessage(string)` (exposed by the preload that `Webnat.of` registers; it forwards strings and nothing else and never exposes `ipcRenderer`) → `ipcRenderer.send('__native_webnat__.postMessage')` → the `webContents.ipc` listener installed by `Webnat.of`.
- **Native → Web**: `webContents.executeJavaScript('window.__web_webnat__.receive(...)')`.

## Notes

- **The bridge is registered per session, once, and never removed.** Electron attaches preloads to a session, not to a `WebContents`, so the first `Webnat.of` on a session registers it and later ones (found by file path) add nothing; Electron 35+ uses `registerPreloadScript`, while older versions use `setPreloads`; it stays for the life of the session, as the other platforms' bridges stay for the life of the WebView. It exposes the bridge to the top frame only, even when you enable `nodeIntegrationInSubFrames`. If you already registered `webnat/preload` yourself, that is fine too: it is not registered twice.
- **The UA token covers the main frame and same-origin iframes only.** `Webnat.of` uses `webContents.setUserAgent`; a cross-site iframe does not get `Webnat/` and the Web SDK stays disabled there. `app.userAgentFallback` is the lever if you need it.
- **Set a `timeout` on `method` calls.** A call ends when the page answers, when it times out or is aborted, or when its connection ends (the page unloaded, the renderer crashed, the `WebContents` was destroyed). A call without a timeout on a page that stays alive but never answers stays pending forever.
- **An exception thrown by an abort listener** reaches Node as an `uncaughtException` (native `AbortSignal` semantics). Wrap listeners you add to a handler's `signal` in `try/catch`.

## Example App

`example/` is a small, separate Electron app. It embeds the existing `webnat-web/example` in an Electron `BrowserView` and places the Native controls and message log in the same host window.

The runner expects the `webnat-web` repository next to this one. Install the Web example once, then the Electron example installs and builds its own dependencies independently:

```bash
cd ../webnat-web/example && npm install
cd ../../webnat-electron/example && npm install && npm start
```

To use another local checkout, set `WEBNAT_WEB_EXAMPLE_DIR=/path/to/webnat-web/example`. To load an already running or deployed web example instead, set `WEBNAT_WEB_EXAMPLE_URL` (for example `http://127.0.0.1:5173/`); the runner will not start Vite in that case.

## Development

```bash
npm install
npm run build        # tsup: dist/ (cjs + esm + d.ts) and dist/preload/index.cjs
npm run typecheck
npm test             # build + unit tests + a real Electron 22.0.2 integration run
```

Set `WEBNAT_SKIP_ELECTRON=1` to skip the Electron integration test on a machine without the Electron binary.

## License

This project is licensed under the MIT License.

## Shared regression contracts

See `contracts/README.md` for versioned golden fixtures and `contracts/CI.md` for test gates and runner setup.

## Release

Manual release instructions and migration notes: `RELEASING.md`. Upgrade the Web SDK and native bridge together to 2.0.0.
