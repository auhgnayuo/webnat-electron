# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-10-12

First release. The version is aligned with `webnat-ohos` 1.3.0, the unified version across platforms.

### Added

- **Electron implementation** of the Native side, moved here from the `miniprogram-electron` container where it was developed. It is ported module by module from `webnat-ohos` (`Webnat`, `Connection`, `Message`, raw / broadcast / method calls, `BroadcastMethodCall`, `JavaScriptAliveKeeper`, `WebnatError`) and speaks the same wire protocol, so it works with the unchanged `webnat-web` 1.2.0 Web SDK (verified against the real SDK in Electron 44.7.0).
- **`webnat-electron/preload`**: the page-side half of the transport — a single self-contained CommonJS file that exposes `window.__native_webnat__.postMessage` to the **top frame only**. Register it on the session that hosts the `WebContents`.

### Differences from `webnat-ohos`

- Cancellation uses Node's native `AbortController` / `AbortSignal`; `abortController.ets` is not ported. `webnat-ohos` 1.3.0 aligned its own `AbortSignal` with the Node / Web API (`addEventListener('abort', …)`, `reason`, `onabort`, `throwIfAborted()`), and the call sites here were already written against that standard API. The `signal` handed to an `onMethod` handler is a real `AbortSignal`, so it can be passed straight to `fetch` and `timers/promises`. One behavioral difference remains: an exception thrown by an abort listener reaches Node as an `uncaughtException`, whereas the OHOS implementation swallows listener errors.
- `registerJavaScriptProxy` is replaced by the preload plus an IPC channel (`__native_webnat__.postMessage`); `runJavaScript` by `webContents.executeJavaScript`.
