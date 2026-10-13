import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultWebExample = path.resolve(root, '../webnat-web/example');
const webExampleDir = process.env.WEBNAT_WEB_EXAMPLE_DIR || defaultWebExample;
const webUrl = process.env.WEBNAT_WEB_EXAMPLE_URL || 'http://127.0.0.1:5173/';
const externalWebUrl = Boolean(process.env.WEBNAT_WEB_EXAMPLE_URL);
const require = createRequire(import.meta.url);
const electronPath = require('electron');

let webServer;
let appProcess;
let shuttingDown = false;

function stop(child) {
  if (child && child.exitCode === null && !child.killed) child.kill('SIGTERM');
}

async function waitForServer(url, child, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`webnat-web example server exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      // The Vite server is still starting.
    }
    await delay(300);
  }
  throw new Error(`Timed out waiting for the web example at ${url}`);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stop(appProcess);
  stop(webServer);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  if (!externalWebUrl) {
    const webPackage = path.join(webExampleDir, 'package.json');
    try {
      await access(webPackage);
    } catch {
      throw new Error(`找不到 webnat-web 示例：${webExampleDir}\n请把 webnat-web 仓库放在 webnat-electron 同级目录，或设置 WEBNAT_WEB_EXAMPLE_DIR。`);
    }

    webServer = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
      cwd: webExampleDir,
      stdio: 'inherit',
      env: process.env,
    });
    await waitForServer(webUrl, webServer);
  } else {
    await waitForServer(webUrl, null, 30_000);
  }

  appProcess = spawn(electronPath, [path.join(root, 'example/main.cjs'), webUrl], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });

  const exitCode = await new Promise((resolve, reject) => {
    appProcess.once('error', reject);
    appProcess.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  shutdown();
  process.exitCode = exitCode;
} catch (error) {
  console.error(error.message || error);
  shutdown();
  process.exitCode = 1;
}
