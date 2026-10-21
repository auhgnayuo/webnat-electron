# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-10-21

This is a coordinated **major / breaking release** across Web, Electron, Darwin, Android and OHOS. Upgrade both sides of the bridge together; migration and manual publishing instructions are in `RELEASING.md`. Contract fixtures v1 are frozen for this release.

### Shared contract / regression gates

- Added versioned golden message, rejection and error fixtures shared by all five implementations, digest verification and a cross-repository drift/interop gate.
- Unified error aliases, code 0, signed 32-bit / whole-string parsing and empty/null message behavior. Web errors now inherit Error.
- PR test workflows now execute tests rather than build-only checks. OHOS SDK execution requires an approved isolated self-hosted runner; device tests remain distinct from local tests.

### Changed (Breaking)

- Public Param data uses only JSON-compatible null, strings, booleans, finite numbers, plain records, and arrays. Nested undefined, holes, class instances, Date / Map / Set / BigInt, functions, cycles, symbol keys, accessors, and hidden fields are rejected rather than rewritten. Missing top-level values normalize to null; null fields are omitted only at the top level.
- Extracted standalone toJsonValue / fromJsonValue helpers. Canonical Message dictionaries recursively validate business payloads, and incoming invalid data rejects the whole message.

### Tests

- Added runtime JSON contract matrices, compile-time positive / negative public API checks, and transport / RPC regressions. Added a real Electron + built Web SDK interop suite covering both main frames and iframes.

### Fixed

- Connection attributes now accept objects only. Raw / broadcast / method input callbacks normalize missing values to null.
- Renderer scripts use JSON.parse on quoted JSON text rather than evaluating object literals, preserving __proto__ data keys without prototype mutation.

## [1.4.0] - 2026-10-13

### Added

- **`onRenderProcessGone()`**: tells Webnat that the render process behind the `WebContents` has exited (crash, or the `WebContents` is destroyed); Webnat then ends the page's connections itself. Same semantics on Android, Darwin, OHOS and Electron. The method is named after each platform's own hook: `webViewWebContentProcessDidTerminate` on Darwin, `onRenderProcessGone` on Android and Electron, `onRenderExited` on OHOS. `Webnat.of` calls it by itself when the `WebContents` emits `render-process-gone` or `destroyed`, so an Electron host does nothing.

### Fixed

- A method handler that throws synchronously now makes the caller receive an error reply instead of waiting for its timeout. A plain (non-Promise) return value is taken as the result.
- A failed send is no longer swallowed: `method` rejects at once with `SERIALIZATION_FAILED` when the parameter cannot be serialized and with `CLOSED` when the `WebContents` is destroyed, and an `executeJavaScript` error rejects the call with that error.
- A method result that cannot be serialized is answered with a `SERIALIZATION_FAILED` error reply instead of being dropped.
- A call without a timeout no longer stays pending after the renderer crashed or the `WebContents` was destroyed: the connection ends, the call rejects with `CLOSED` and the alive-keeper timer stops.

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
