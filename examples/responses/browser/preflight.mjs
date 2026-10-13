// No imports from the SDK or Playwright until the prerequisite is checked.
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const { values } = parseArgs({
  options: {
    environment: { type: 'string', default: 'browser' },
    'runtime-dir': { type: 'string' },
  },
});
const { environment } = values;
if (!['browser', 'desktop-vm', 'desktop-container'].includes(environment)) {
  throw new Error('Choose --environment browser, desktop-vm or desktop-container.');
}
const checks = [];
function check(name, ready, fix) {
  checks.push({ name, ready, ...(ready ? {} : { fix }) });
}
async function executable(file) {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
async function onPath(name) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    // Check local executables only; never run a downloaded installer.
    // oxlint-disable-next-line no-await-in-loop
    if (dir && (await executable(path.join(dir, name)))) {
      return true;
    }
  }
  return false;
}
const supportedRuntime = Number(process.versions.node.split('.')[0]) >= 22;
check('Node runtime', supportedRuntime, 'Use Node.js 22 or later.');
if (!supportedRuntime) {
  console.log(JSON.stringify({ environment, ready: false, checks }, null, 2));
  process.exit(1);
}
if (
  environment !== 'browser' &&
  values['runtime-dir'] !== undefined &&
  !path.isAbsolute(values['runtime-dir'])
) {
  check('Runtime directory', false, 'Use an absolute --runtime-dir path.');
  console.log(JSON.stringify({ environment, ready: false, checks }, null, 2));
  process.exit(1);
}
try {
  const module = await import(
    environment === 'browser' ? 'openai/helpers/browser' : 'openai/helpers/computer'
  );
  check(
    'SDK helper',
    typeof module[environment === 'browser' ? 'BrowserToolset' : 'ComputerToolset'] === 'function',
    'Install or update the released openai package in this examples directory: npm install --no-save openai@latest',
  );
} catch {
  check(
    'SDK helper',
    false,
    'Install or update the released openai package: npm install --no-save openai@latest',
  );
}
if (environment !== 'browser') {
  const fix = 'Run: npm install --no-save openai@latest pngjs@7.0.0';
  try {
    const desktopRequire = createRequire(new URL('../../computer-desktop/desktop.mjs', import.meta.url));
    const { PNG } = desktopRequire('pngjs');
    check('pngjs package', typeof PNG?.sync?.read === 'function', fix);
  } catch {
    check('pngjs package', false, fix);
  }
}
if (environment === 'browser') {
  try {
    const { chromium } = await import('playwright');
    check('Playwright package', true);
    if (checks.find(({ name }) => name === 'SDK helper').ready) {
      const { exampleBrowserChannel } = await import('./driver.mjs');
      try {
        const channel = exampleBrowserChannel();
        if (channel === 'chrome') {
          check('Chrome channel selected; installation and sandbox will be checked at launch', true);
        } else {
          check(
            'Chromium',
            await executable(chromium.executablePath()),
            'Run: npx playwright install chromium',
          );
        }
      } catch (error) {
        check('Browser channel', false, error.message);
      }
    }
  } catch {
    check('Playwright package', false, 'Run: npm install --no-save openai@latest playwright@1.63.0');
  }
} else if (environment === 'desktop-vm') {
  check(
    'Apple silicon host',
    process.platform === 'darwin' && process.arch === 'arm64',
    'Use an Apple silicon Mac, or choose desktop-container on local Linux.',
  );
  const names = values['runtime-dir'] ? ['python3'] : ['python3', 'vfkit', 'xorriso'];
  const available = await Promise.all(names.map(onPath));
  for (const [index, name] of names.entries()) {
    check(
      name,
      available[index],
      `Install the trusted ${name} prerequisite in computer-desktop/guest/README.md.`,
    );
  }
  if (values['runtime-dir']) {
    const root = values['runtime-dir'];
    try {
      await promisify(execFile)(
        'python3',
        [
          '-E',
          '-S',
          fileURLToPath(new URL('../../computer-desktop/guest/setup.py', import.meta.url)),
          '--runtime-dir',
          root,
          '--verify-only',
        ],
        { timeout: 30_000, maxBuffer: 16_384 },
      );
      check('Completed guest runtime', true);
    } catch {
      check(
        'Completed guest runtime',
        false,
        'Build a matching guest with computer-desktop/guest/setup.py, or choose its completed runtime directory.',
      );
    }
  }
} else {
  check('python3', await onPath('python3'), 'Install Python 3.10 or later for the local desktop runtime.');
  try {
    await promisify(execFile)(
      'python3',
      [
        '-E',
        '-S',
        fileURLToPath(new URL('../../computer-desktop/container_runtime.py', import.meta.url)),
        'preflight',
        ...(values['runtime-dir'] ? ['--runtime-dir', values['runtime-dir']] : []),
      ],
      { timeout: 30_000, maxBuffer: 16_384 },
    );
    check('Local Docker runtime', true);
  } catch {
    check(
      'Local Docker runtime',
      false,
      'Run python3 computer-desktop/container_runtime.py preflight to check the local Docker setup. Add --runtime-dir to check an existing runtime.',
    );
  }
}
const ready = checks.every((item) => item.ready);
console.log(JSON.stringify({ environment, ready, checks }, null, 2));
if (!ready) {
  process.exitCode = 1;
}
