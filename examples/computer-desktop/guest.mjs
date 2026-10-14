import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, rmdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

function helperEnv(root, container = false) {
  const env = {
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'C',
    TMPDIR: root,
  };
  if (container) {
    // Forward only configuration that local_only must explicitly refuse or verify.
    for (const key of [
      'DOCKER_CONTEXT',
      'DOCKER_CONFIG',
      'DOCKER_CERT_PATH',
      'DOCKER_TLS_VERIFY',
      'BUILDKIT_HOST',
      'BUILDX_BUILDER',
      'BUILDX_CONFIG',
      'DOCKER_HOST',
    ]) {
      if (Object.hasOwn(process.env, key)) {
        env[key] = process.env[key];
      }
    }
  }
  return env;
}

async function containerCommand(root, operation, id, input, timeout = 30_000, limit = 65_536, signal = null) {
  signal?.throwIfAborted();
  const args = [
    '-I',
    '-S',
    fileURLToPath(new URL('container_runtime.py', import.meta.url)),
    operation,
    '--runtime-dir',
    root,
  ];
  if (id) {
    args.push('--id', id);
  }
  args.push('--timeout', String(timeout / 1000), '--limit', String(limit));
  // The helper checks the local daemon and reconciles the persisted owner before every command.
  const result = promisify(execFile)('python3', args, {
    // Startup owns its deadline so it can reconcile a created container before exiting.
    timeout: operation === 'start' ? 0 : timeout + 30_000,
    maxBuffer: limit,
    env: helperEnv(root, true),
  });
  const cancelStartup = () => result.child.kill('SIGUSR1');
  signal?.addEventListener('abort', cancelStartup, { once: true });
  result.child.stdin.end(input);
  try {
    const { stdout } = await result;
    // If the helper completed before it observed Stop, remove the ID it proved
    // rather than dropping that receipt because the caller is now cancelled.
    if (operation === 'start' && signal?.aborted) {
      await containerCommand(root, 'remove', stdout.trim());
      signal.throwIfAborted();
    }
    return stdout.trim();
  } catch (error) {
    // An unsuccessful startup may retain a recovery record. Its cleanup error
    // must not be replaced with a signal that implies no guest remains.
    if (operation !== 'start') {
      signal?.throwIfAborted();
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancelStartup);
  }
}

async function isContainer(root) {
  const receiptPath = path.join(root, 'setup.json');
  let receipt;
  try {
    receipt = await lstat(receiptPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  if (receipt) {
    // oxlint-disable-next-line no-bitwise
    if (!receipt.isFile() || receipt.uid !== process.getuid() || (receipt.mode & 0o777) !== 0o600) {
      throw new Error('Invalid runtime receipt.');
    }
    const value = JSON.parse(await readFile(receiptPath, 'utf-8'));
    if (!Object.hasOwn(value, 'backend')) {
      return false;
    }
    if (value.backend !== 'container') {
      throw new Error('Unknown tagged desktop backend.');
    }
    return true;
  }
  return false;
}

// oxlint-disable-next-line complexity -- Keep verifier reaping before VM launch in the same ownership boundary.
export async function start(runtimeDir, { signal } = {}) {
  signal?.throwIfAborted();
  if (typeof runtimeDir !== 'string' || !path.isAbsolute(runtimeDir)) {
    throw new Error('Pass the absolute private runtime directory in trusted launcher setup.');
  }
  const root = await realpath(runtimeDir);
  const [runtime, runs] = await Promise.all([lstat(root), lstat(path.join(root, 'runs'))]);
  for (const directory of [runtime, runs]) {
    // File modes are native POSIX bitmasks; require private owner-only directories.
    if (
      !directory.isDirectory() ||
      directory.uid !== process.getuid() ||
      // oxlint-disable-next-line no-bitwise
      (directory.mode & 0o777) !== 0o700
    ) {
      throw new Error('Runtime and runs must be owned private directories.');
    }
  }
  if (await isContainer(root)) {
    const id = await containerCommand(root, 'start', undefined, undefined, 30_000, 65_536, signal);
    return { backend: 'container', root, id, dir: path.join(root, 'runs', id) };
  }
  const id = randomBytes(6).toString('hex');
  const dir = path.join(root, 'runs', id);
  const socket = path.join(dir, 'a.sock');
  if (Buffer.byteLength(socket) >= 104 || /[% ,]/u.test(socket)) {
    throw new Error('Invalid owned socket path');
  }
  const verification = promisify(execFile)(
    'python3',
    [
      '-I',
      '-S',
      fileURLToPath(new URL('guest/setup.py', import.meta.url)),
      '--runtime-dir',
      root,
      '--verify-only',
    ],
    { timeout: 30_000, maxBuffer: 65_536, signal, env: helperEnv(root) },
  );
  // execFile can reject on abort before the verifier is reaped.
  // oxlint-disable-next-line promise/avoid-new -- Child close is the ownership boundary after execFile abort.
  const verifierClosed = new Promise((resolve) => {
    verification.child.once('close', resolve);
  });
  try {
    await verification;
  } catch (error) {
    const timeout = Symbol('deadline');
    if ((await Promise.race([verifierClosed, delay(5000, timeout, { ref: false })])) === timeout) {
      verification.child.kill('SIGKILL');
      if ((await Promise.race([verifierClosed, delay(5000, timeout, { ref: false })])) === timeout) {
        throw new Error('VM receipt verifier could not be reaped.', { cause: error });
      }
    }
    signal?.throwIfAborted();
    throw error;
  }
  signal?.throwIfAborted();
  await mkdir(dir, { mode: 0o700 });
  const st = await lstat(dir);
  // oxlint-disable-next-line no-bitwise
  if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o700) {
    throw new Error('Invalid run root');
  }
  const args = [
    '--cpus',
    '4',
    '--memory',
    '4096',
    '--restful-uri',
    'none://',
    '--bootloader',
    `efi,variable-store=${path.join(dir, 'efi.vars')},create`,
    '--device',
    `virtio-blk,path=${path.join(root, 'build/desktop.raw')},readonly,deviceId=bp22-root`,
    '--device',
    `virtio-vsock,port=4050,socketURL=${socket},connect`,
  ];
  const child = spawn(
    'python3',
    [
      '-I',
      '-S',
      fileURLToPath(new URL('guest/vm_owner.py', import.meta.url)),
      '--',
      path.join(root, 'bin/vfkit'),
      ...args,
    ],
    {
      cwd: dir,
      env: helperEnv(dir),
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const guest = { id, dir, socket, child, st, out: 0, err: 0, failure: null, gone: null };
  // A child process may emit error and then close; reap it on the close event in both cases.
  // oxlint-disable-next-line promise/avoid-new
  guest.gone = new Promise((resolve) => {
    child.once('error', () => {
      guest.failure = 'vfkit process failed';
    });
    child.once('close', (code, exitSignal) => resolve({ code, signal: exitSignal }));
  });
  for (const [pipe, name] of [
    [child.stdout, 'out'],
    [child.stderr, 'err'],
  ]) {
    pipe.on('data', (data) => {
      guest[name] += data.length;
      if (guest[name] > 65_536 && child.exitCode === null && child.signalCode === null) {
        guest.failure = 'bounded output exceeded';
        child.kill('SIGTERM');
      }
    });
  }
  return guest;
}

export function exchange(guest, input, timeout, limit, { signal } = {}) {
  signal?.throwIfAborted();
  if (guest.backend === 'container') {
    return containerCommand(guest.root, 'exchange', guest.id, input, timeout, limit, signal);
  }
  // Settle from bounded Unix socket events; an error or premature close must not return partial bytes.
  // oxlint-disable-next-line promise/avoid-new
  return new Promise((resolve, reject) => {
    if (guest.failure || guest.child.exitCode !== null || guest.child.signalCode !== null) {
      reject(new Error('Private guest has stopped.'));
      return;
    }
    const socket = createConnection({ path: guest.socket, allowHalfOpen: true });
    const stop = () => socket.destroy();
    signal?.addEventListener('abort', stop, { once: true });
    const chunks = [];
    let size = 0;
    let receivedEnd = false;
    const deadline = setTimeout(() => socket.destroy(new Error('Private desktop request expired.')), timeout);
    socket.on('connect', () => socket.end(input));
    socket.on('data', (data) => {
      size += data.length;
      if (size > limit) {
        socket.destroy(new Error('Private desktop reply exceeded limit.'));
      } else {
        chunks.push(data);
      }
    });
    socket.on('end', () => {
      receivedEnd = true;
      clearTimeout(deadline);
      resolve(Buffer.concat(chunks).toString('utf-8').trim());
      socket.destroy();
    });
    socket.on('error', () => {
      clearTimeout(deadline);
      reject(new Error('Private guest request failed.'));
    });
    socket.on('close', () => {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', stop);
      if (!receivedEnd) {
        reject(signal?.aborted ? signal.reason : new Error('Private guest response ended prematurely.'));
      }
    });
  });
}

export async function healthy(guest, { signal } = {}) {
  signal?.throwIfAborted();
  if (guest.backend === 'container') {
    return (
      (await containerCommand(guest.root, 'health', guest.id, undefined, 30_000, 65_536, signal)) === 'ready'
    );
  }
  return !guest.failure && guest.child.exitCode === null && guest.child.signalCode === null;
}

function sameRunRoot(current, original) {
  return (
    current.isDirectory() &&
    current.dev === original.dev &&
    current.ino === original.ino &&
    current.uid === process.getuid() &&
    // oxlint-disable-next-line no-bitwise -- POSIX mode check for the private run directory.
    (current.mode & 0o777) === 0o700
  );
}

export async function remove(guest) {
  if (guest.backend === 'container') {
    await containerCommand(guest.root, 'remove', guest.id);
    return;
  }
  if (guest.child.exitCode === null && guest.child.signalCode === null) {
    guest.child.kill('SIGTERM');
  }
  const timeout = Symbol('deadline');
  const result = await Promise.race([guest.gone, delay(5000, timeout, { ref: false })]);
  if (result === timeout) {
    guest.child.kill('SIGKILL');
    if ((await Promise.race([guest.gone, delay(5000, timeout, { ref: false })])) === timeout) {
      throw new Error('Private guest could not be reaped; owned run root retained.');
    }
  }
  if (!guest.cleanupRoot) {
    if (!sameRunRoot(await lstat(guest.dir), guest.st)) {
      throw new Error('Run root ownership changed');
    }
    // Persist the destination before an awaited rename or lstat can fail.
    guest.cleanupRoot = await mkdtemp(path.join(path.dirname(guest.dir), '.cleanup-'));
  }
  const moved = path.join(guest.cleanupRoot, 'run');
  let current;
  try {
    current = await lstat(moved);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    if (guest.dir === moved) {
      // The matched run was removed. Retry only its private parent's nonrecursive removal.
      await rmdir(guest.cleanupRoot);
      return;
    }
  }
  if (!current) {
    if (!sameRunRoot(await lstat(guest.dir), guest.st)) {
      throw new Error('Run root ownership changed');
    }
    await rename(guest.dir, moved);
    current = await lstat(moved);
  }
  if (!sameRunRoot(current, guest.st)) {
    // Do not delete or restore a replacement onto the public path.
    throw new Error('Run root ownership changed; cleanup incomplete in private .cleanup- directory.');
  }
  guest.dir = moved;
  // A replacement at the old public path is never the recursive removal target.
  await rm(moved, { recursive: true });
  await rmdir(guest.cleanupRoot);
}
