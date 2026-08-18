import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repositoryRoot = process.cwd();
const apiKey = 'sk-synthetic-cloudflare-lifecycle-private-83d4';
const stagedContents = Buffer.from(`OPENAI_API_KEY='${apiKey}'`);
const originalContents = Buffer.from([
  0x4f, 0x50, 0x45, 0x4e, 0x41, 0x49, 0x3d, 0x6f, 0x6c, 0x64, 0x0a, 0xff, 0x00, 0x80,
]);
const otherProjects = [
  'node-ts-cjs',
  'node-ts-cjs-web',
  'node-ts-cjs-auto',
  'node-ts4.5-jest28',
  'node-ts-esm',
  'node-ts-esm-web',
  'node-ts-esm-auto',
  'node-js',
  'ts-browser-webpack',
  'browser-direct-import',
  'vercel-edge',
  'bun',
  'deno',
];

interface Fixture {
  directory: string;
  worker: string;
  vars: string;
  observations: string;
  attempts: string;
  bin: string;
}

interface Observation {
  command: string;
  exists: boolean;
  mode?: number;
  contents?: string;
}

interface CredentialState {
  name: string;
  contents: Buffer | undefined;
  mode: number;
}

const credentialStates: CredentialState[] = [
  { name: 'without an existing credential file', contents: undefined, mode: 0o600 },
  { name: 'with an existing binary credential file', contents: originalContents, mode: 0o644 },
];

function withFixture(run: (fixture: Fixture) => void) {
  const directory = mkdtempSync(path.join(tmpdir(), 'openai-node-cloudflare-lifecycle-'));
  const worker = path.join(directory, 'ecosystem-tests', 'cloudflare-worker');
  const bin = path.join(directory, 'bin');
  const fixture: Fixture = {
    directory,
    worker,
    vars: path.join(worker, '.dev.vars'),
    observations: path.join(directory, 'observations.jsonl'),
    attempts: path.join(directory, 'attempts'),
    bin,
  };

  try {
    mkdirSync(worker, { recursive: true });
    mkdirSync(bin);
    writeFileSync(path.join(directory, 'package.json'), '{}\n');
    writeFileSync(path.join(worker, 'package.json'), '{}\n');

    const fakeNpm = [
      `#!${process.execPath}`,
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const command = process.argv.slice(2).join(' ');",
      "const vars = path.join(process.cwd(), '.dev.vars');",
      'const observation = { command, exists: fs.existsSync(vars) };',
      'if (observation.exists) {',
      '  const metadata = fs.statSync(vars);',
      '  observation.mode = metadata.mode & 0o777;',
      '  if (metadata.isFile()) observation.contents = fs.readFileSync(vars).toString("base64");',
      '}',
      'fs.appendFileSync(process.env.CLOUDFLARE_OBSERVATIONS, JSON.stringify(observation) + "\\n", { mode: 0o600 });',
      "const failure = process.env.CLOUDFLARE_FAILURE || '';",
      "if (failure === 'install' && command === 'install -D openai') process.exit(21);",
      "if (failure === 'tsc' && command === 'run tsc') process.exit(22);",
      "if (command === 'run test:ci') {",
      '  const attempt = Number(fs.existsSync(process.env.CLOUDFLARE_ATTEMPTS) ? fs.readFileSync(process.env.CLOUDFLARE_ATTEMPTS, "utf8") : 0) + 1;',
      '  fs.writeFileSync(process.env.CLOUDFLARE_ATTEMPTS, String(attempt), { mode: 0o600 });',
      "  if (failure === 'replace-during-truncate') {",
      "    fs.writeFileSync(process.env.CLOUDFLARE_REPLACE_READY, 'ready');",
      '  }',
      "  if (failure === 'replace-file' || failure === 'replace-symlink') {",
      "    fs.renameSync(vars, vars + '.original');",
      "    if (failure === 'replace-file') {",
      '      fs.writeFileSync(vars, "independently replaced credentials\\n", { mode: 0o640 });',
      '    } else {',
      '      fs.symlinkSync(process.env.CLOUDFLARE_REPLACEMENT_TARGET, vars);',
      '    }',
      '  }',
      "  if (failure === 'signal-int' || failure === 'signal-term') {",
      "    process.kill(process.ppid, failure === 'signal-int' ? 'SIGINT' : 'SIGTERM');",
      '    setTimeout(() => process.exit(0), 250);',
      '    return;',
      '  }',
      "  if (failure === 'live' || (failure === 'live-once' && attempt === 1)) process.exit(23);",
      "  if (failure === 'unlink') fs.chmodSync(process.cwd(), 0o500);",
      '}',
      "if (failure === 'deploy' && command === 'run deploy') process.exit(24);",
    ].join('\n');

    writeFileSync(path.join(bin, 'npm'), fakeNpm, { mode: 0o755 });
    run(fixture);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function setExistingCredentials(fixture: Fixture, state: CredentialState) {
  if (state.contents !== undefined) {
    writeFileSync(fixture.vars, state.contents);
    chmodSync(fixture.vars, state.mode);
  }
}

function runCloudflare(
  fixture: Fixture,
  flags: string[],
  environment: Partial<NodeJS.ProcessEnv> = {},
  noCleanup = true,
  timeout = 10_000,
) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(repositoryRoot, 'node_modules/ts-node/dist/bin.js'),
      '-r',
      path.join(repositoryRoot, 'node_modules/tsconfig-paths/register.js'),
      path.join(repositoryRoot, 'ecosystem-tests/cli.ts'),
      'cloudflare-worker',
      '--fromNpm=openai',
      '--skipPack',
      ...(noCleanup ? ['--noCleanup'] : []),
      ...flags,
    ],
    {
      cwd: fixture.directory,
      encoding: 'utf-8',
      env: {
        ...process.env,
        CI: 'false',
        PATH: fixture.bin,
        OPENAI_API_KEY: apiKey,
        CLOUDFLARE_OBSERVATIONS: fixture.observations,
        CLOUDFLARE_ATTEMPTS: fixture.attempts,
        DISABLE_V8_COMPILE_CACHE: '1',
        TS_NODE_PROJECT: path.join(repositoryRoot, 'tsconfig.json'),
        TS_NODE_TRANSPILE_ONLY: 'true',
        ...environment,
      },
      timeout,
    },
  );

  expect(result.stdout).not.toContain(apiKey);
  expect(result.stderr).not.toContain(apiKey);
  return result;
}

function observations(fixture: Fixture): Observation[] {
  if (!existsSync(fixture.observations)) {
    return [];
  }

  return readFileSync(fixture.observations, 'utf-8')
    .trim()
    .split('\n')
    .map((record) => JSON.parse(record) as Observation);
}

function expectOriginal(observation: Observation, state: CredentialState) {
  expect(observation.exists).toBe(state.contents !== undefined);
  if (state.contents !== undefined) {
    expect(observation.contents).toBe(state.contents.toString('base64'));
    expect(observation.mode).toBe(state.mode);
  }
}

function expectRestored(fixture: Fixture, state: CredentialState) {
  if (state.contents === undefined) {
    expect(existsSync(fixture.vars)).toBe(false);
    return;
  }

  expect(readFileSync(fixture.vars)).toEqual(state.contents);
  expect(statSync(fixture.vars).mode % 0o1000).toBe(state.mode);
}

function expectScopedObservations(records: Observation[], state: CredentialState) {
  for (const observation of records) {
    if (observation.command === 'run test:ci') {
      expect(observation.exists).toBe(true);
      expect(observation.mode).toBe(0o600);
      expect(observation.contents).toBe(stagedContents.toString('base64'));
    } else {
      expectOriginal(observation, state);
    }
  }
}

describe('Cloudflare ecosystem credential lifecycle', () => {
  test.each(credentialStates)('does not stage ambient credentials in non-live mode $name', (state) => {
    withFixture((fixture) => {
      setExistingCredentials(fixture, state);

      const result = runCloudflare(fixture, []);
      const records = observations(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(records.map(({ command }) => command)).toEqual(['install -D openai', 'run tsc']);
      expectScopedObservations(records, state);
      expectRestored(fixture, state);
    });
  });

  test.each(credentialStates)('does not stage ambient credentials in deploy-only mode $name', (state) => {
    withFixture((fixture) => {
      setExistingCredentials(fixture, state);

      const result = runCloudflare(fixture, ['--deploy']);
      const records = observations(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(records.map(({ command }) => command)).toEqual(['install -D openai', 'run tsc', 'run deploy']);
      expectScopedObservations(records, state);
      expectRestored(fixture, state);
    });
  });

  test.each(credentialStates)('limits owner-only credentials to the live command $name', (state) => {
    withFixture((fixture) => {
      setExistingCredentials(fixture, state);

      const result = runCloudflare(fixture, ['--live']);
      const records = observations(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(records.map(({ command }) => command)).toEqual(['install -D openai', 'run tsc', 'run test:ci']);
      expectScopedObservations(records, state);
      expectRestored(fixture, state);
    });
  });

  test.each(credentialStates)('restores credentials after a failing live command $name', (state) => {
    withFixture((fixture) => {
      setExistingCredentials(fixture, state);

      const result = runCloudflare(fixture, ['--live'], { CLOUDFLARE_FAILURE: 'live' });
      const records = observations(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(records.map(({ command }) => command)).toEqual(['install -D openai', 'run tsc', 'run test:ci']);
      expectScopedObservations(records, state);
      expectRestored(fixture, state);
    });
  });

  test('erases staged credentials even when the private file cannot be removed', () => {
    withFixture((fixture) => {
      try {
        const result = runCloudflare(fixture, ['--live'], { CLOUDFLARE_FAILURE: 'unlink' });
        const records = observations(fixture);

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(records.map(({ command }) => command)).toEqual([
          'install -D openai',
          'run tsc',
          'run test:ci',
        ]);
        expect(readFileSync(fixture.vars)).toEqual(Buffer.alloc(0));
        expect(statSync(fixture.vars).mode % 0o1000).toBe(0o600);
      } finally {
        chmodSync(fixture.worker, 0o755);
      }
    });
  });

  test.each(
    credentialStates.flatMap((state) =>
      (['SIGINT', 'SIGTERM'] as const).flatMap((signal) =>
        [true, false].map((noCleanup) => ({ state, signal, noCleanup })),
      ),
    ),
  )('restores staged credentials after $signal with noCleanup=$noCleanup', ({ state, signal, noCleanup }) => {
    withFixture((fixture) => {
      setExistingCredentials(fixture, state);
      const flags = ['--live', ...(noCleanup ? [] : otherProjects.map((project) => `--skip=${project}`))];

      const result = runCloudflare(
        fixture,
        flags,
        { CLOUDFLARE_FAILURE: signal === 'SIGINT' ? 'signal-int' : 'signal-term' },
        noCleanup,
      );

      expect(result.error).toBeUndefined();
      expect(result.status === 0 && result.signal === null).toBe(false);
      expectRestored(fixture, state);
      if (noCleanup) {
        expect(result.signal).toBe(signal);
      }
    });
  });

  test.each(
    credentialStates.flatMap((state) =>
      (['replace-file', 'replace-symlink'] as const).map((replacement) => ({ state, replacement })),
    ),
  )(
    'preserves an independent $replacement without exposing the original staged inode',
    ({ state, replacement }) => {
      withFixture((fixture) => {
        setExistingCredentials(fixture, state);
        const target = path.join(fixture.directory, 'independent-replacement-target');
        const replacementContents = 'independent symlink target\\n';
        writeFileSync(target, replacementContents, { mode: 0o640 });

        const result = runCloudflare(fixture, ['--live'], {
          CLOUDFLARE_FAILURE: replacement,
          CLOUDFLARE_REPLACEMENT_TARGET: target,
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        if (replacement === 'replace-symlink') {
          expect(lstatSync(fixture.vars).isSymbolicLink()).toBe(true);
          expect(readFileSync(target, 'utf-8')).toBe(replacementContents);
        } else {
          expect(readFileSync(fixture.vars, 'utf-8')).toBe('independently replaced credentials\n');
        }

        const detached = `${fixture.vars}.original`;
        expect(readFileSync(detached)).toEqual(state.contents ?? Buffer.alloc(0));
        if (state.contents !== undefined) {
          expect(statSync(detached).mode % 0o1000).toBe(state.mode);
        }
        expect(readFileSync(detached).includes(apiKey)).toBe(false);
      });
    },
  );

  test.each(credentialStates)(
    'preserves a replacement installed while the original credential inode is being truncated $name',
    (state) => {
      withFixture((fixture) => {
        setExistingCredentials(fixture, state);
        const marker = path.join(fixture.directory, 'replacement-ready');
        const preload = path.join(fixture.directory, 'replace-during-truncate.cjs');
        writeFileSync(
          preload,
          [
            "const fs = require('node:fs');",
            "const promises = require('node:fs/promises');",
            "const path = require('node:path');",
            'const originalOpen = promises.open;',
            'let replaced = false;',
            'promises.open = async (...args) => {',
            '  const file = await originalOpen(...args);',
            "  if (args[0] === '.dev.vars') {",
            '    const originalTruncate = file.truncate.bind(file);',
            '    file.truncate = async (...truncateArgs) => {',
            '      const result = await originalTruncate(...truncateArgs);',
            '      if (!replaced && fs.existsSync(process.env.CLOUDFLARE_REPLACE_READY)) {',
            '        replaced = true;',
            "        const vars = path.join(process.cwd(), '.dev.vars');",
            "        fs.renameSync(vars, vars + '.race-original');",
            '        fs.writeFileSync(vars, "independent replacement", { mode: 0o640 });',
            '      }',
            '      return result;',
            '    };',
            '  }',
            '  return file;',
            '};',
          ].join('\n'),
        );

        const result = runCloudflare(fixture, ['--live'], {
          CLOUDFLARE_FAILURE: 'replace-during-truncate',
          CLOUDFLARE_REPLACE_READY: marker,
          NODE_OPTIONS: `--require ${preload}`,
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(readFileSync(fixture.vars, 'utf-8')).toBe('independent replacement');
        expect(readFileSync(`${fixture.vars}.race-original`)).toEqual(state.contents ?? Buffer.alloc(0));
        expect(readFileSync(fixture.vars)).not.toContain(apiKey);
      });
    },
  );

  test.each(
    (['open', 'stat', 'lstat'] as const).flatMap((phase) =>
      credentialStates.flatMap((state) =>
        [
          { signal: 'SIGINT' as const, noCleanup: true },
          { signal: 'SIGTERM' as const, noCleanup: false },
        ].map(({ signal, noCleanup }) => ({ phase, state, signal, noCleanup, name: state.name })),
      ),
    ),
  )(
    'restores $name after $signal interrupts pending $phase with noCleanup=$noCleanup',
    ({ phase, state, signal, noCleanup }) => {
      withFixture((fixture) => {
        setExistingCredentials(fixture, state);
        const preload = path.join(fixture.directory, 'interrupt-during-acquisition.cjs');
        writeFileSync(
          preload,
          [
            "const promises = require('node:fs/promises');",
            'const originalOpen = promises.open;',
            'const originalLstat = promises.lstat;',
            'let interrupted = false;',
            'async function interrupt() {',
            '  if (interrupted) return;',
            '  interrupted = true;',
            '  process.kill(process.pid, process.env.CLOUDFLARE_ACQUISITION_SIGNAL);',
            '  await new Promise((resolve) => setTimeout(resolve, 30));',
            '}',
            'promises.open = async (...args) => {',
            '  const file = await originalOpen(...args);',
            "  if (args[0] === '.dev.vars') {",
            '    const originalStat = file.stat.bind(file);',
            '    file.stat = async (...statArgs) => {',
            '      const result = await originalStat(...statArgs);',
            "      if (process.env.CLOUDFLARE_ACQUISITION_PHASE === 'stat') await interrupt();",
            '      return result;',
            '    };',
            "    if (process.env.CLOUDFLARE_ACQUISITION_PHASE === 'open') await interrupt();",
            '  }',
            '  return file;',
            '};',
            'promises.lstat = async (...args) => {',
            '  const result = await originalLstat(...args);',
            "  if (args[0] === '.dev.vars' && process.env.CLOUDFLARE_ACQUISITION_PHASE === 'lstat') {",
            '    await interrupt();',
            '  }',
            '  return result;',
            '};',
          ].join('\n'),
        );
        const flags = ['--live', ...(noCleanup ? [] : otherProjects.map((project) => `--skip=${project}`))];

        const result = runCloudflare(
          fixture,
          flags,
          {
            CLOUDFLARE_ACQUISITION_PHASE: phase,
            CLOUDFLARE_ACQUISITION_SIGNAL: signal,
            NODE_OPTIONS: `--require ${preload}`,
          },
          noCleanup,
        );

        expect(result.error).toBeUndefined();
        expect(result.status === 0 && result.signal === null).toBe(false);
        expectRestored(fixture, state);
        if (noCleanup) {
          expect(result.signal).toBe(signal);
        }
      });
    },
  );

  test.each(
    (['SIGINT', 'SIGTERM'] as const).flatMap((signal) =>
      [true, false].map((noCleanup) => ({ signal, noCleanup })),
    ),
  )(
    'serializes $signal cleanup with in-flight staging when noCleanup=$noCleanup',
    ({ signal, noCleanup }) => {
      withFixture((fixture) => {
        const state = credentialStates[1] as CredentialState;
        setExistingCredentials(fixture, state);
        const preload = path.join(fixture.directory, 'interrupt-during-staging.cjs');
        writeFileSync(
          preload,
          [
            "const promises = require('node:fs/promises');",
            'const originalOpen = promises.open;',
            'let interrupted = false;',
            'promises.open = async (...args) => {',
            '  const file = await originalOpen(...args);',
            "  if (args[0] === '.dev.vars') {",
            '    const originalChmod = file.chmod.bind(file);',
            '    file.chmod = async (...chmodArgs) => {',
            '      if (!interrupted && chmodArgs[0] === 0o600) {',
            '        interrupted = true;',
            '        process.kill(process.pid, process.env.CLOUDFLARE_STAGING_SIGNAL);',
            '        await new Promise((resolve) => setTimeout(resolve, 25));',
            '      }',
            '      return originalChmod(...chmodArgs);',
            '    };',
            '    const originalClose = file.close.bind(file);',
            '    file.close = async (...closeArgs) => {',
            '      await new Promise((resolve) => setTimeout(resolve, 100));',
            '      return originalClose(...closeArgs);',
            '    };',
            '  }',
            '  return file;',
            '};',
          ].join('\n'),
        );
        const flags = ['--live', ...(noCleanup ? [] : otherProjects.map((project) => `--skip=${project}`))];

        const result = runCloudflare(
          fixture,
          flags,
          { CLOUDFLARE_STAGING_SIGNAL: signal, NODE_OPTIONS: `--require ${preload}` },
          noCleanup,
        );

        expect(result.error).toBeUndefined();
        expect(result.status === 0 && result.signal === null).toBe(false);
        expectRestored(fixture, state);
        if (noCleanup) {
          expect(result.signal).toBe(signal);
        }
      });
    },
  );

  test.each([
    { name: 'oversized', sparse: false },
    { name: 'sparse', sparse: true },
  ])('rejects an existing $name credential snapshot before staging a key', ({ sparse }) => {
    withFixture((fixture) => {
      writeFileSync(fixture.vars, sparse ? Buffer.alloc(0) : Buffer.alloc(64 * 1024 + 1, 0x61), {
        mode: 0o640,
      });
      if (sparse) {
        truncateSync(fixture.vars, 64 * 1024 + 1);
      }

      const result = runCloudflare(fixture, ['--live']);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('64 KiB');
      expect(statSync(fixture.vars).size).toBe(64 * 1024 + 1);
      expect(observations(fixture).map(({ command }) => command)).toEqual(['install -D openai', 'run tsc']);
    });
  });

  test('bounds snapshots if an existing credential file grows after its descriptor stat', () => {
    withFixture((fixture) => {
      writeFileSync(fixture.vars, originalContents, { mode: 0o640 });
      const preload = path.join(fixture.directory, 'grow-after-stat.cjs');
      writeFileSync(
        preload,
        [
          "const fs = require('node:fs/promises');",
          'const originalOpen = fs.open;',
          'let grown = false;',
          'fs.open = async (...args) => {',
          '  const file = await originalOpen(...args);',
          "  if (args[0] === '.dev.vars' && !grown) {",
          '    const originalStat = file.stat.bind(file);',
          '    file.stat = async (...statArgs) => {',
          '      const metadata = await originalStat(...statArgs);',
          '      if (!grown) {',
          '        grown = true;',
          '        const contents = Buffer.alloc(64 * 1024 + 1, 0x67);',
          '        await file.write(contents, 0, contents.length, metadata.size);',
          '      }',
          '      return metadata;',
          '    };',
          '  }',
          '  return file;',
          '};',
        ].join('\n'),
      );

      const result = runCloudflare(fixture, ['--live'], { NODE_OPTIONS: `--require ${preload}` });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('64 KiB');
      expect(statSync(fixture.vars).size).toBe(originalContents.length + 64 * 1024 + 1);
      expect(observations(fixture).map(({ command }) => command)).toEqual(['install -D openai', 'run tsc']);
    });
  });

  test.each(credentialStates)('restores credentials before retrying a failed live command $name', (state) => {
    withFixture((fixture) => {
      setExistingCredentials(fixture, state);

      const result = runCloudflare(fixture, ['--live', '--retry=1', '--retryDelay=0'], {
        CLOUDFLARE_FAILURE: 'live-once',
      });
      const records = observations(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(records.map(({ command }) => command)).toEqual([
        'install -D openai',
        'run tsc',
        'run test:ci',
        'install -D openai',
        'run tsc',
        'run test:ci',
      ]);
      expectScopedObservations(records, state);
      expectRestored(fixture, state);
    });
  });

  test.each(credentialStates)('restores credentials before a requested deployment $name', (state) => {
    withFixture((fixture) => {
      setExistingCredentials(fixture, state);

      const result = runCloudflare(fixture, ['--live', '--deploy']);
      const records = observations(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(records.map(({ command }) => command)).toEqual([
        'install -D openai',
        'run tsc',
        'run test:ci',
        'run deploy',
      ]);
      expectScopedObservations(records, state);
      expectRestored(fixture, state);
    });
  });

  test.each(credentialStates)('never stages credentials when TypeScript checking fails $name', (state) => {
    withFixture((fixture) => {
      setExistingCredentials(fixture, state);

      const result = runCloudflare(fixture, ['--live'], { CLOUDFLARE_FAILURE: 'tsc' });
      const records = observations(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(records.map(({ command }) => command)).toEqual(['install -D openai', 'run tsc']);
      expectScopedObservations(records, state);
      expectRestored(fixture, state);
    });
  });

  test('removes newly staged credentials when ordinary global cleanup is enabled', () => {
    withFixture((fixture) => {
      const flags = ['--live', ...otherProjects.map((project) => `--skip=${project}`)];
      const result = runCloudflare(fixture, flags, {}, false);
      const records = observations(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(records.map(({ command }) => command)).toEqual(['install -D openai', 'run tsc', 'run test:ci']);
      expectScopedObservations(records, credentialStates[0] as CredentialState);
      expect(existsSync(fixture.vars)).toBe(false);
    });
  });

  test.each(['--live', '--deploy'])('preserves keyless %s rejection before any commands', (option) => {
    withFixture((fixture) => {
      const result = runCloudflare(fixture, [option], { OPENAI_API_KEY: undefined });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(observations(fixture)).toEqual([]);
      expect(existsSync(fixture.vars)).toBe(false);
    });
  });

  test('rejects symlinked credential files without changing their targets', () => {
    withFixture((fixture) => {
      const target = path.join(fixture.directory, 'private-target');
      writeFileSync(target, originalContents, { mode: 0o640 });
      symlinkSync(target, fixture.vars);

      const result = runCloudflare(fixture, ['--live']);
      const records = observations(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(records.map(({ command }) => command)).toEqual(['install -D openai', 'run tsc']);
      expect(readFileSync(target)).toEqual(originalContents);
      expect(lstatSync(fixture.vars).isSymbolicLink()).toBe(true);
    });
  });

  test('rejects dangling credential symlinks without creating their targets', () => {
    withFixture((fixture) => {
      const target = path.join(fixture.directory, 'missing-target');
      symlinkSync(target, fixture.vars);

      const result = runCloudflare(fixture, ['--live']);
      const records = observations(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(records.map(({ command }) => command)).toEqual(['install -D openai', 'run tsc']);
      expect(existsSync(target)).toBe(false);
      expect(lstatSync(fixture.vars).isSymbolicLink()).toBe(true);
    });
  });

  test('rejects named pipes without blocking', () => {
    if (process.platform === 'win32') {
      return;
    }

    withFixture((fixture) => {
      const created = spawnSync('mkfifo', [fixture.vars], { encoding: 'utf-8' });
      expect(created.error).toBeUndefined();
      expect(created.status).toBe(0);

      const result = runCloudflare(fixture, ['--live']);
      const records = observations(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(records.map(({ command }) => command)).toEqual(['install -D openai', 'run tsc']);
      expect(statSync(fixture.vars).isFIFO()).toBe(true);
    });
  });

  test('rejects hard-linked credential files without exposing their shared targets', () => {
    withFixture((fixture) => {
      const target = path.join(fixture.directory, 'private-hardlink-target');
      writeFileSync(target, originalContents, { mode: 0o640 });
      linkSync(target, fixture.vars);

      const result = runCloudflare(fixture, ['--live']);
      const records = observations(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(records.map(({ command }) => command)).toEqual(['install -D openai', 'run tsc']);
      expect(readFileSync(target)).toEqual(originalContents);
      expect(readFileSync(fixture.vars)).toEqual(originalContents);
    });
  });

  test('rejects non-regular credential targets after non-secret preparation', () => {
    withFixture((fixture) => {
      mkdirSync(fixture.vars);

      const result = runCloudflare(fixture, ['--live']);
      const records = observations(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(records.map(({ command }) => command)).toEqual(['install -D openai', 'run tsc']);
      expect(statSync(fixture.vars).isDirectory()).toBe(true);
    });
  });
});
