import { contextBridge, ipcRenderer } from 'electron';

// Sandboxed preloads can only require('electron'): keep this file self-contained, no relative imports.
// Page-side half of the transport; counterpart of OHOS registerJavaScriptProxy('__native_webnat__', ['postMessage']).
// The integrator registers it on the session that hosts the WebContents:
//   session.registerPreloadScript({ type: 'frame', filePath: require.resolve('webnat-electron/preload') })
// isMainFrame keeps the bridge off iframes (they relay through the top frame) even when the host enables nodeIntegrationInSubFrames.
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('__native_webnat__', {
    postMessage(message: string): void {
      // The page is untrusted: forward strings only.
      if (typeof message !== 'string') return;
      ipcRenderer.send('__native_webnat__.postMessage', message);
    },
  });
}
