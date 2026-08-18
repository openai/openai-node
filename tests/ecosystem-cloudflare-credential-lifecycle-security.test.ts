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
