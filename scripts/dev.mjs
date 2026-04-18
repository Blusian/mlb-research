import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const apiPort = process.env.MLB_API_PORT ?? '4000';
const apiCheckUrl =
  process.env.MLB_API_CHECK_URL
  ?? `http://127.0.0.1:${apiPort}/health`;

const children = [];
let shuttingDown = false;

const terminateChild = (child) => {
  if (!child.pid) {
    return;
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  child.kill('SIGTERM');
};

const shutdown = (exitCode = 0) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    terminateChild(child);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 150);
};

const startProcess = (name, args) => {
  const child = spawn(npmCommand, args, {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });

  children.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (signal) {
      shutdown(0);
      return;
    }

    if ((code ?? 0) !== 0) {
      console.error(`[dev] ${name} exited with code ${code ?? 1}.`);
      shutdown(code ?? 1);
    }
  });

  return child;
};

const apiIsRunning = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(apiCheckUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return false;
    }

    const payload = await response.json().catch(() => null);
    return Boolean(payload && typeof payload === 'object' && payload.status === 'ok');
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (await apiIsRunning()) {
  console.log(`[dev] API already responding on port ${apiPort}. Starting frontend only.`);
  startProcess('frontend', ['run', 'dev', '--workspace', '@mlb-analyzer/frontend']);
} else {
  console.log(`[dev] API not detected on port ${apiPort}. Starting API and frontend.`);
  startProcess('api', ['run', 'dev:api']);
  startProcess('frontend', ['run', 'dev', '--workspace', '@mlb-analyzer/frontend']);
}
