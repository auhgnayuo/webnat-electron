# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.2] - 2026-10-12

### Changed

- **The package is now named `webnat`** (it was `webnat-electron` in 1.3.0 and 1.3.1), like the OHOS, Android, Darwin and Web packages: `import { Webnat } from 'webnat'`, bridge script `webnat/preload`. The platform suffix is kept in the repository name only. This is a breaking change for anyone who installed `webnat-electron`; the old tags `1.3.0` and `1.3.1` are left as they were.
- **The tests no longer depend on the Web SDK**, which is what forced the old name (the Web SDK is also called `webnat`, and both cannot live in one `node_modules`). Like the other platforms, the unit tests run against protocol messages and a fake `WebContents`; the end-to-end run against the real Web SDK is done by hand with the demo host. The test run in a real Electron process shrinks to the two checks that need no SDK: the bridge reaches the top frame only, and `Webnat.of` registers it once per session. The iframe-relay, frame-race, WebContents-isolation and navigation checks that used the real SDK in 1.3.0/1.3.1 are gone from automation.

## [1.3.1] - 2026-10-12

### Changed

- **`Webnat.of` now registers the page-side bridge by itself**, like `Webnat.of` does on the other platforms (`registerJavaScriptProxy` on OHOS, `addJavascriptInterface` on Android). In 1.3.0 the integrator had to register `webnat-electron/preload` on the session; now nobody does. Electron attaches preloads to a session rather than to a `WebContents`, so the bridge is registered once per session (looked up by file path, so a host that still registers it itself gets no duplicate) and, as on the other platforms, never removed. `Webnat.of` registers it first, so a missing bridge script fails before anything is attached to the `WebContents`.
- The CommonJS build shims `import.meta.url`, which `Webnat.of` uses to find the bridge script through the package's own `exports`.

## [1.3.0] - 2026-10-12

First release. The version is aligned with `webnat-ohos` 1.3.0, the unified version across platforms.

### Added

- **Electron implementation** of the Native side, moved here from the `miniprogram-electron` container where it was developed. It is ported module by module from `webnat-ohos` (`Webnat`, `Connection`, `Message`, raw / broadcast / method calls, `BroadcastMethodCall`, `JavaScriptAliveKeeper`, `WebnatError`) and speaks the same wire protocol, so it works with the unchanged `webnat-web` 1.2.0 Web SDK (verified against the real SDK in Electron 44.7.0).
- **`webnat-electron/preload`**: the page-side half of the transport — a single self-contained CommonJS file that exposes `window.__native_webnat__.postMessage` to the **top frame only**. (In 1.3.0 the integrator registered it on the session; since 1.3.1 `Webnat.of` does.)

### Differences from `webnat-ohos`

- Cancellation uses Node's native `AbortController` / `AbortSignal`; `abortController.ets` is not ported. `webnat-ohos` 1.3.0 aligned its own `AbortSignal` with the Node / Web API (`addEventListener('abort', …)`, `reason`, `onabort`, `throwIfAborted()`), and the call sites here were already written against that standard API. The `signal` handed to an `onMethod` handler is a real `AbortSignal`, so it can be passed straight to `fetch` and `timers/promises`. One behavioral difference remains: an exception thrown by an abort listener reaches Node as an `uncaughtException`, whereas the OHOS implementation swallows listener errors.
- `registerJavaScriptProxy` is replaced by the preload plus an IPC channel (`__native_webnat__.postMessage`); `runJavaScript` by `webContents.executeJavaScript`.
