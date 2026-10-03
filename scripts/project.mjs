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

function atLeast(actual, minimum) {
  const a = actual.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < b.length; i++) {
    if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) > b[i];
  }
  return true;
}

function npmArgs(args) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('Run this command through npm, for example: npm run doctor');
  return [cli, ...args];
}

function capture(command, args, missing) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(missing);
  return result.stdout.trim();
}

async function doctor() {
  const minimumNode = JSON.parse(await readFile(join(frontend, 'package.json'), 'utf8')).engines.node.slice(2);
  if (!atLeast(process.versions.node, minimumNode)) {
    throw new Error(`Node.js ${minimumNode}+ required; found ${process.versions.node}. Install from https://nodejs.org/en/download and reopen your terminal.`);
  }
  const minimumGo = (await readFile(join(backend, 'go.mod'), 'utf8')).match(/^go (\S+)/m)[1];
  const go = capture('go', ['version'], 'Go is missing from PATH. Install from https://go.dev/dl/ and reopen your terminal.');
  const goVersion = go.match(/go(\d+\.\d+(?:\.\d+)?)/)?.[1];
  if (!goVersion || !atLeast(goVersion, minimumGo)) {
    throw new Error(`Go ${minimumGo}+ required; found ${go}. Install from https://go.dev/dl/`);
  }
  const npm = capture(process.execPath, npmArgs(['--version']), 'npm is unavailable. Reinstall Node.js with npm included.');
  console.log(`Ready: Node ${process.versions.node}, npm ${npm}, ${go}`);
}

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    console.log(`> ${command === process.execPath ? 'npm' : command} ${command === process.execPath ? args.slice(1).join(' ') : args.join(' ')}`);
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${signal ?? code}): ${args.join(' ')}`));
    });
  });
}

const npm = (...args) => run(process.execPath, npmArgs(args), frontend);

async function verify() {
  await mkdir(join(backend, 'coverage'), { recursive: true });
  await run('go', ['test', './...', '-count=1', '-covermode=atomic', '-coverprofile=coverage/coverage.out'], backend);
  await run('go', ['tool', 'cover', '-func=coverage/coverage.out'], backend);
  await run('go', ['tool', 'cover', '-html=coverage/coverage.out', '-o', 'coverage/coverage.html'], backend);
  await run('go', ['vet', './...'], backend);
  await run('go', ['build', './...'], backend);
  await npm('test');
  await npm('run', 'test:coverage');
  await npm('run', 'typecheck');
  await npm('run', 'build');
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is busy. Stop the service using it before npm run dev.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function dev() {
  await Promise.all([checkPort(8080), checkPort(5173)]);
  const directory = await mkdtemp(join(tmpdir(), 'sezzle-calculator-'));
  const binary = join(directory, windows ? 'server.exe' : 'server');
  const children = [];
  let stopping = false;
  let stopped;

  function stop() {
    if (stopped) return stopped;
    stopping = true;
    stopped = stopChildren();
    return stopped;
  }

  async function stopChildren() {
    for (const child of children) {
      if (!child.pid || child.exitCode !== null) continue;
      // Target only the process trees created by this invocation, never a port owner.
      if (windows) {
        child.kill();
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    }
    await Promise.all(children.map(child => new Promise(resolve => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return resolve();
      const deadline = setTimeout(() => {
        try { process.kill(windows ? child.pid : -child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
      }, 5000);
      child.once('exit', () => { clearTimeout(deadline); resolve(); });
    })));
  }

  try {
    await run('go', ['build', '-o', binary, './cmd/server'], backend);
    await new Promise((resolve, reject) => {
      const finish = (error) => stop().then(() => error ? reject(error) : resolve(), reject);
      process.once('SIGINT', () => finish());
      process.once('SIGTERM', () => finish());
      const start = (command, args, cwd, env) => {
        const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, detached: !windows });
        children.push(child);
        child.once('error', finish);
        child.once('exit', (code, signal) => {
          if (!stopping) finish(new Error(`Development service stopped (${signal ?? code}).`));
        });
      };
      start(binary, [], backend, { ...process.env, HOST: '127.0.0.1', PORT: '8080', ALLOWED_ORIGIN: '' });
      start(process.execPath, [join(frontend, 'node_modules/vite/bin/vite.js')], frontend, { ...process.env, VITE_API_BASE_URL: '' });
      console.log('Open http://127.0.0.1:5173. API: http://127.0.0.1:8080. Press Ctrl+C to stop both.');
    });
  } finally {
    await stop();
    await unlink(binary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(directory);
  }
}

try {
  const command = process.argv[2];
  if (!['doctor', 'setup', 'dev', 'verify'].includes(command)) throw new Error('Use npm run doctor, setup, dev, or verify.');
  await doctor();
  if (command === 'setup') await npm('ci');
  if (command === 'verify') await verify();
  if (command === 'dev') await dev();
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
}
