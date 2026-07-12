import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const host = '127.0.0.1';

async function waitForServer(server, baseUrl, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`${label} exited before becoming ready (${server.exitCode}).`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await delay(250);
  }
  throw new Error(`${label} did not become ready within 20 seconds.`);
}

async function stopServer(server) {
  if (server.exitCode === null) {
    server.kill();
    await Promise.race([once(server, 'exit'), delay(5_000)]);
  }
}

async function runSuite({ label, port, serverArguments, testFile }) {
  const baseUrl = `http://${host}:${port}`;
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...serverArguments], {
    stdio: 'ignore',
    windowsHide: true,
  });

  try {
    await waitForServer(server, baseUrl, label);
    const runner = spawn(
      process.execPath,
      ['node_modules/@playwright/test/cli.js', 'test', testFile],
      {
        env: {
          ...process.env,
          PLAYWRIGHT_BASE_URL: baseUrl,
          PLAYWRIGHT_EXTERNAL_SERVER: '1',
        },
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    const [code] = await once(runner, 'exit');
    return typeof code === 'number' ? code : 1;
  } finally {
    await stopServer(server);
  }
}

const suites = [
  {
    label: 'Vite production preview',
    port: '4173',
    serverArguments: ['preview', '--host', host, '--port', '4173'],
    testFile: 'tests/e2e/shell.spec.ts',
  },
  {
    label: 'Vite development server',
    port: '5173',
    serverArguments: ['--host', host, '--port', '5173', '--strictPort'],
    testFile: 'tests/e2e/development-shell.spec.ts',
  },
];

let exitCode = 0;
for (const suite of suites) {
  exitCode = await runSuite(suite);
  if (exitCode !== 0) break;
}

process.exitCode = exitCode;
