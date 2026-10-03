import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const frontend = join(root, 'frontend');
const backend = join(root, 'backend');
const windows = process.platform === 'win32';

function isVersionAtLeast(actual, minimum) {
  const actualParts = actual.split('.').map(Number);
  const minimumParts = minimum.split('.').map(Number);
  for (let index = 0; index < minimumParts.length; index++) {
    const actualPart = actualParts[index] ?? 0;
    const minimumPart = minimumParts[index];
    if (actualPart !== minimumPart) {
      return actualPart > minimumPart;
    }
  }
  return true;
}

function npmArgs(args) {
  const cli = process.env.npm_execpath;
  if (!cli) {
    throw new Error('Run this command through npm, for example: npm run doctor');
  }
  return [cli, ...args];
}

function readCommandOutput(command, args, missingMessage) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error(missingMessage);
  }
  return result.stdout.trim();
}

async function doctor() {
  const minimumNode = JSON.parse(
    await readFile(join(frontend, 'package.json'), 'utf8'),
  ).engines.node.slice(2);
  if (!isVersionAtLeast(process.versions.node, minimumNode)) {
    throw new Error(
      `Node.js ${minimumNode}+ required; found ${process.versions.node}. Install from https://nodejs.org/en/download and reopen your terminal.`,
    );
  }
  const minimumGo = (await readFile(join(backend, 'go.mod'), 'utf8')).match(/^go (\S+)/m)[1];
  const goVersionOutput = readCommandOutput(
    'go',
    ['version'],
    'Go is missing from PATH. Install from https://go.dev/dl/ and reopen your terminal.',
  );
  const goVersion = goVersionOutput.match(/go(\d+\.\d+(?:\.\d+)?)/)?.[1];
  if (!goVersion || !isVersionAtLeast(goVersion, minimumGo)) {
    throw new Error(
      `Go ${minimumGo}+ required; found ${goVersionOutput}. Install from https://go.dev/dl/`,
    );
  }
  const npmVersion = readCommandOutput(
    process.execPath,
    npmArgs(['--version']),
    'npm is unavailable. Reinstall Node.js with npm included.',
  );
  console.log(`Ready: Node ${process.versions.node}, npm ${npmVersion}, ${goVersionOutput}`);
}

function runCommand(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const isNpmCommand = command === process.execPath;
    const displayedCommand = isNpmCommand ? 'npm' : command;
    const displayedArgs = isNpmCommand ? args.slice(1) : args;
    console.log(`> ${displayedCommand} ${displayedArgs.join(' ')}`);
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed (${signal ?? code}): ${args.join(' ')}`));
      }
    });
  });
}

function runFrontendNpm(...args) {
  return runCommand(process.execPath, npmArgs(args), frontend);
}

async function verify() {
  await runFrontendNpm('run', 'format:check');
  await mkdir(join(backend, 'coverage'), { recursive: true });
  await runCommand(
    'go',
    ['test', './...', '-count=1', '-covermode=atomic', '-coverprofile=coverage/coverage.out'],
    backend,
  );
  await runCommand('go', ['tool', 'cover', '-func=coverage/coverage.out'], backend);
  await runCommand(
    'go',
    ['tool', 'cover', '-html=coverage/coverage.out', '-o', 'coverage/coverage.html'],
    backend,
  );
  await runCommand('go', ['vet', './...'], backend);
  await runCommand('go', ['build', './...'], backend);
  await runFrontendNpm('test');
  await runFrontendNpm('run', 'test:coverage');
  await runFrontendNpm('run', 'typecheck');
  await runFrontendNpm('run', 'build');
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(new Error(`Port ${port} is busy. Stop the service using it before npm run dev.`)),
    );
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

function waitForChildExit(child) {
  return new Promise((resolve) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    const deadline = setTimeout(() => {
      try {
        process.kill(windows ? child.pid : -child.pid, 'SIGKILL');
      } catch {
        // The child may have exited before the deadline fired.
      }
    }, 5000);

    child.once('exit', () => {
      clearTimeout(deadline);
      resolve();
    });
  });
}

async function dev() {
  await Promise.all([checkPort(8080), checkPort(5173)]);
  const directory = await mkdtemp(join(tmpdir(), 'sezzle-calculator-'));
  const binary = join(directory, windows ? 'server.exe' : 'server');
  const children = [];
  let stopping = false;
  let shutdownPromise;

  function requestShutdown() {
    if (!shutdownPromise) {
      stopping = true;
      shutdownPromise = stopChildren();
    }
    return shutdownPromise;
  }

  async function stopChildren() {
    for (const child of children) {
      if (!child.pid || child.exitCode !== null) {
        continue;
      }
      // Windows stops these direct children; POSIX stops their dedicated process groups.
      // Never target an unrelated process just because it owns a port.
      if (windows) {
        child.kill();
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch (error) {
          if (error.code !== 'ESRCH') {
            throw error;
          }
        }
      }
    }
    await Promise.all(children.map(waitForChildExit));
  }

  try {
    await runCommand('go', ['build', '-o', binary, './cmd/server'], backend);
    await new Promise((resolve, reject) => {
      function finishDevelopment(error) {
        requestShutdown().then(() => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }, reject);
      }
      process.once('SIGINT', () => finishDevelopment());
      process.once('SIGTERM', () => finishDevelopment());
      function startChild(command, args, cwd, env) {
        const child = spawn(command, args, {
          cwd,
          env,
          stdio: ['ignore', 'inherit', 'inherit'],
          windowsHide: true,
          detached: !windows,
        });
        children.push(child);
        child.once('error', finishDevelopment);
        child.once('exit', (code, signal) => {
          if (!stopping) {
            finishDevelopment(new Error(`Development service stopped (${signal ?? code}).`));
          }
        });
      }

      startChild(binary, [], backend, {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '8080',
        ALLOWED_ORIGIN: '',
      });
      startChild(process.execPath, [join(frontend, 'node_modules/vite/bin/vite.js')], frontend, {
        ...process.env,
        VITE_API_BASE_URL: '',
      });
      console.log(
        'Open http://127.0.0.1:5173. API: http://127.0.0.1:8080. Press Ctrl+C to stop both.',
      );
    });
  } finally {
    await requestShutdown();
    await unlink(binary).catch((error) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
    await rmdir(directory);
  }
}

try {
  const command = process.argv[2];
  if (!['doctor', 'setup', 'dev', 'verify'].includes(command)) {
    throw new Error('Use npm run doctor, setup, dev, or verify.');
  }
  await doctor();
  if (command === 'setup') {
    await runFrontendNpm('ci');
  }
  if (command === 'verify') {
    await verify();
  }
  if (command === 'dev') {
    await dev();
  }
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
}
