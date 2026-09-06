import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
  // Exercise preload paths containing spaces regardless of the system temporary directory.
  const directory = mkdtempSync(path.join(tmpdir(), 'openai-node-cloudflare lifecycle-'));
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
      "if (failure === 'interrupt-before-lease' && command === process.env.CLOUDFLARE_INTERRUPT_COMMAND) {",
      '  process.kill(process.ppid, process.env.CLOUDFLARE_INTERRUPT_SIGNAL);',
      '  setTimeout(() => process.exit(0), 20);',
      '  return;',
      '}',
      "if (failure === 'install' && command === 'install -D openai') process.exit(21);",
      "if (failure === 'tsc' && command === 'run tsc') process.exit(22);",
      "if (command === 'run test:ci') {",
      '  const attempt = Number(fs.existsSync(process.env.CLOUDFLARE_ATTEMPTS) ? fs.readFileSync(process.env.CLOUDFLARE_ATTEMPTS, "utf8") : 0) + 1;',
      '  fs.writeFileSync(process.env.CLOUDFLARE_ATTEMPTS, String(attempt), { mode: 0o600 });',
      "  if (failure === 'interrupt-retry-delay' && attempt === 1) {",
      "    const notifier = require('node:child_process').spawn(",
      '      process.execPath,',
      "      ['-e', 'setTimeout(() => process.kill(Number(process.argv[1]), process.argv[2]), 40)', String(process.ppid), process.env.CLOUDFLARE_INTERRUPT_SIGNAL],",
      "      { detached: true, stdio: 'ignore', env: { ...process.env, NODE_OPTIONS: '' } },",
      '    );',
      '    notifier.unref();',
      '    process.exit(23);',
      '  }',
      "  if (failure === 'interrupt-before-lease' || failure === 'interrupt-retry-delay') {",
      '    setTimeout(() => process.exit(0), 1000);',
      '    return;',
      '  }',
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
      "  if (failure === 'capture-original' || failure === 'edit-original') {",
      '    const held = process.env.CLOUDFLARE_HELD_LINK;',
      "    if (failure === 'capture-original') {",
      '      fs.writeFileSync(process.env.CLOUDFLARE_HELD_CAPTURE, fs.readFileSync(held), { mode: 0o600 });',
      '    } else {',
      '      fs.writeFileSync(held, "original concurrently edited\\n");',
      '      fs.chmodSync(held, 0o640);',
      '    }',
      '  }',
      "  if (failure === 'edit-staged') fs.writeFileSync(vars, 'concurrent visible edit\\n');",
      "  if (failure === 'append-staged') fs.appendFileSync(vars, '\\nconcurrent appended edit\\n');",
      "  if (failure === 'append-staged-duplicate') fs.appendFileSync(vars, '\\nconcurrent appended edit\\n' + process.env.OPENAI_API_KEY + '\\n');",
      "  if (failure === 'chmod-staged') fs.chmodSync(vars, 0o640);",
      "  if (failure === 'oversize-staged') fs.writeFileSync(vars, Buffer.alloc(64 * 1024 + 1, 0x6f));",
      "  if (failure === 'deny-path-validation') fs.writeFileSync(process.env.CLOUDFLARE_DENIAL_READY, 'ready');",
      "  if (failure === 'signal-int' || failure === 'signal-term' || failure === 'signal-hup') {",
      "    const signal = failure === 'signal-int' ? 'SIGINT' : failure === 'signal-term' ? 'SIGTERM' : 'SIGHUP';",
      '    process.kill(process.ppid, signal);',
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

function holdOriginalCredentialDescriptor(fixture: Fixture): string {
  const preload = path.join(fixture.directory, 'hold-original-credential.cjs');
  const heldLink = path.join(fixture.directory, 'held-original-credential');
  writeFileSync(
    preload,
    [
      "const fs = require('node:fs');",
      "const promises = require('node:fs/promises');",
      `const heldLink = ${JSON.stringify(heldLink)};`,
      'const originalOpen = promises.open;',
      'const originalLink = promises.link;',
      'promises.open = async (...args) => {',
      '  const file = await originalOpen(...args);',
      "  if (args[0] === '.dev.vars' && !process.env.CLOUDFLARE_HELD_FD) {",
      "    process.env.CLOUDFLARE_HELD_FD = String(fs.openSync(args[0], 'r+'));",
      '  }',
      '  return file;',
      '};',
      'promises.link = async (...args) => {',
      '  const result = await originalLink(...args);',
      "  if (args[0] === '.dev.vars' && !process.env.CLOUDFLARE_HELD_LINK) {",
      '    fs.linkSync(args[0], heldLink);',
      '    process.env.CLOUDFLARE_HELD_LINK = heldLink;',
      '  }',
      '  return result;',
      '};',
    ].join('\n'),
  );
  return preload;
}

function expectNoCloudflareCredentialArtifacts(fixture: Fixture) {
  expect(readdirSync(fixture.worker).filter((name) => name.startsWith('.dev.vars.openai-'))).toEqual([]);
}

function preloadNodeOptions(preload: string) {
  return `--require "${preload.split('\\').join('\\\\').split('"').join('\\"')}"`;
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
  expectNoCloudflareCredentialArtifacts(fixture);
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
      expect(records.map(({ command }) => command)).toEqual([
        'install -D openai',
        'run tsc',
        'run test:smoke',
      ]);
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
      expect(records.map(({ command }) => command)).toEqual([
        'install -D openai',
        'run tsc',
        'run test:smoke',
        'run deploy',
      ]);
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
      expect(records.map(({ command }) => command)).toEqual([
        'install -D openai',
        'run tsc',
        'run test:smoke',
        'run test:ci',
      ]);
      expectScopedObservations(records, state);
      expectRestored(fixture, state);
    });
  });

  test('never exposes a staged key through a pre-opened readable original inode', () => {
    withFixture((fixture) => {
      const state = credentialStates[1] as CredentialState;
      setExistingCredentials(fixture, state);
      const preload = holdOriginalCredentialDescriptor(fixture);
      const capture = path.join(fixture.directory, 'held-original-capture');

      const result = runCloudflare(fixture, ['--live'], {
        CLOUDFLARE_FAILURE: 'capture-original',
        CLOUDFLARE_HELD_CAPTURE: capture,
        NODE_OPTIONS: preloadNodeOptions(preload),
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(readFileSync(capture)).toEqual(originalContents);
      expect(readFileSync(capture).includes(apiKey)).toBe(false);
      expectRestored(fixture, state);
      expectNoCloudflareCredentialArtifacts(fixture);
    });
  });

  test('preserves concurrent edits and mode changes through the original held inode', () => {
    withFixture((fixture) => {
      const state = credentialStates[1] as CredentialState;
      setExistingCredentials(fixture, state);
      const preload = holdOriginalCredentialDescriptor(fixture);

      const result = runCloudflare(fixture, ['--live'], {
        CLOUDFLARE_FAILURE: 'edit-original',
        NODE_OPTIONS: preloadNodeOptions(preload),
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(readFileSync(fixture.vars, 'utf-8')).toBe('original concurrently edited\n');
      expect(statSync(fixture.vars).mode % 0o1000).toBe(0o640);
      expect(readFileSync(fixture.vars).includes(apiKey)).toBe(false);
      expectNoCloudflareCredentialArtifacts(fixture);
    });
  });

  test('does not retry a replaced credential path even when retries are enabled', () => {
    withFixture((fixture) => {
      const state = credentialStates[1] as CredentialState;
      setExistingCredentials(fixture, state);

      const result = runCloudflare(fixture, ['--live', '--retry=3', '--retryDelay=0'], {
        CLOUDFLARE_FAILURE: 'replace-file',
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(readFileSync(fixture.attempts, 'utf-8')).toBe('1');
      expect(readFileSync(fixture.vars, 'utf-8')).toBe('independently replaced credentials\n');
      expect(readFileSync(fixture.vars).includes(apiKey)).toBe(false);
      expectNoCloudflareCredentialArtifacts(fixture);
    });
  });

  test.each([
    { failure: 'edit-staged', contents: 'concurrent visible edit\n', mode: 0o600 },
    { failure: 'append-staged', contents: '\nconcurrent appended edit\n', mode: 0o600 },
    {
      failure: 'append-staged-duplicate',
      contents: '\nconcurrent appended edit\n[REDACTED]\n',
      mode: 0o600,
    },
    { failure: 'chmod-staged', contents: originalContents, mode: 0o640 },
  ])('preserves concurrent visible credential changes after $failure', ({ failure, contents, mode }) => {
    withFixture((fixture) => {
      const state = credentialStates[1] as CredentialState;
      setExistingCredentials(fixture, state);

      const result = runCloudflare(fixture, ['--live', '--retry=3', '--retryDelay=0'], {
        CLOUDFLARE_FAILURE: failure,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(readFileSync(fixture.attempts, 'utf-8')).toBe('1');
      expect(readFileSync(fixture.vars)).toEqual(
        typeof contents === 'string' ? Buffer.from(contents) : contents,
      );
      expect(statSync(fixture.vars).mode % 0o1000).toBe(mode);
      expect(readFileSync(fixture.vars).includes(apiKey)).toBe(false);
      expectNoCloudflareCredentialArtifacts(fixture);
    });
  });

  test.each(credentialStates)(
    'scrubs staged credentials and restores $name when pathname validation throws EACCES',
    (state) => {
      withFixture((fixture) => {
        setExistingCredentials(fixture, state);
        const marker = path.join(fixture.directory, 'path-validation-ready');
        const preload = path.join(fixture.directory, 'deny-path-validation.cjs');
        writeFileSync(
          preload,
          [
            "const fs = require('node:fs');",
            'const originalLstatSync = fs.lstatSync;',
            'let denied = false;',
            'fs.lstatSync = (candidate, options) => {',
            "  if (!denied && candidate === '.dev.vars' && fs.existsSync(process.env.CLOUDFLARE_DENIAL_READY)) {",
            '    denied = true;',
            '    const directory = process.cwd();',
            '    fs.chmodSync(directory, 0o600);',
            '    try {',
            '      return originalLstatSync(candidate, options);',
            '    } finally {',
            '      fs.chmodSync(directory, 0o755);',
            '    }',
            '  }',
            '  return originalLstatSync(candidate, options);',
            '};',
          ].join('\n'),
        );

        const result = runCloudflare(fixture, ['--live', '--retry=3', '--retryDelay=0'], {
          CLOUDFLARE_FAILURE: 'deny-path-validation',
          CLOUDFLARE_DENIAL_READY: marker,
          NODE_OPTIONS: preloadNodeOptions(preload),
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(readFileSync(fixture.attempts, 'utf-8')).toBe('1');
        expectRestored(fixture, state);
      });
    },
  );

  test.each(credentialStates)('restores $name after an oversized staged edit', (state) => {
    withFixture((fixture) => {
      setExistingCredentials(fixture, state);

      const result = runCloudflare(fixture, ['--live', '--retry=3', '--retryDelay=0'], {
        CLOUDFLARE_FAILURE: 'oversize-staged',
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(readFileSync(fixture.attempts, 'utf-8')).toBe('1');
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
      expect(records.map(({ command }) => command)).toEqual([
        'install -D openai',
        'run tsc',
        'run test:smoke',
        'run test:ci',
      ]);
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
          'run test:smoke',
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
    [
      {
        phase: 'install',
        command: 'install -D openai',
        signal: 'SIGINT' as const,
        failure: 'interrupt-before-lease',
        liveAttempts: 0,
      },
      {
        phase: 'tsc',
        command: 'run tsc',
        signal: 'SIGTERM' as const,
        failure: 'interrupt-before-lease',
        liveAttempts: 0,
      },
      {
        phase: 'retry delay',
        command: '',
        signal: 'SIGHUP' as const,
        failure: 'interrupt-retry-delay',
        liveAttempts: 1,
      },
    ].flatMap((interruption) =>
      credentialStates.map((state) => ({ ...interruption, state, name: state.name })),
    ),
  )('does not stage credentials after $signal interrupts $phase $name', (interruption) => {
    withFixture((fixture) => {
      setExistingCredentials(fixture, interruption.state);
      const preload = path.join(fixture.directory, 'delay-interrupted-global-cleanup.cjs');
      writeFileSync(
        preload,
        [
          "const promises = require('node:fs/promises');",
          'const originalRename = promises.rename;',
          'promises.rename = async (...args) => {',
          "  if (args[0].endsWith('/tmp/cloudflare-worker/package.json')) {",
          '    await new Promise((resolve) => setTimeout(resolve, 450));',
          '  }',
          '  return originalRename(...args);',
          '};',
        ].join('\n'),
      );

      const flags = [
        '--live',
        ...otherProjects.map((project) => `--skip=${project}`),
        ...(interruption.phase === 'retry delay' ? ['--retry=1', '--retryDelay=100'] : []),
      ];
      const result = runCloudflare(
        fixture,
        flags,
        {
          CLOUDFLARE_FAILURE: interruption.failure,
          CLOUDFLARE_INTERRUPT_COMMAND: interruption.command,
          CLOUDFLARE_INTERRUPT_SIGNAL: interruption.signal,
          NODE_OPTIONS: preloadNodeOptions(preload),
        },
        false,
      );

      expect(result.error).toBeUndefined();
      expect(result.status === 0 && result.signal === null).toBe(false);
      if (interruption.signal === 'SIGHUP') {
        expect(result.signal).toBe('SIGHUP');
      }
      expect(observations(fixture).filter(({ command }) => command === 'run test:ci')).toHaveLength(
        interruption.liveAttempts,
      );
      expectRestored(fixture, interruption.state);
    });
  });

  test.each(credentialStates.flatMap((state) => [true, false].map((noCleanup) => ({ state, noCleanup }))))(
    'restores original credentials before SIGHUP with noCleanup=$noCleanup',
    ({ state, noCleanup }) => {
      withFixture((fixture) => {
        setExistingCredentials(fixture, state);
        const flags = ['--live', ...(noCleanup ? [] : otherProjects.map((project) => `--skip=${project}`))];

        const result = runCloudflare(fixture, flags, { CLOUDFLARE_FAILURE: 'signal-hup' }, noCleanup);

        expect(result.error).toBeUndefined();
        expect(result.signal).toBe('SIGHUP');
        expectRestored(fixture, state);
      });
    },
  );

  test.each(['dev', 'ino'] as const)(
    'rejects replacements with rounded colliding high-bit $field identifiers',
    (field) => {
      withFixture((fixture) => {
        const preload = path.join(fixture.directory, 'colliding-bigint-identities.cjs');
        writeFileSync(
          preload,
          [
            "const fs = require('node:fs');",
            "const promises = require('node:fs/promises');",
            'const originalLstatSync = fs.lstatSync;',
            'const originalLstat = promises.lstat;',
            'const originalOpen = promises.open;',
            'function applyIdentity(metadata, options, replacement) {',
            '  const value = 9007199254740992n + BigInt(replacement);',
            '  const selected = process.env.CLOUDFLARE_IDENTITY_FIELD;',
            "  metadata.dev = selected === 'dev' ? (options?.bigint ? value : Number(value)) : options?.bigint ? 1n : 1;",
            "  metadata.ino = selected === 'ino' ? (options?.bigint ? value : Number(value)) : options?.bigint ? 1n : 1;",
            '  return metadata;',
            '}',
            'function isReplacement(candidate) {',
            "  return candidate === '.dev.vars' &&",
            "    fs.readFileSync(candidate, 'utf8') === 'independently replaced credentials\\n';",
            '}',
            'fs.lstatSync = (candidate, options) =>',
            '  applyIdentity(originalLstatSync(candidate, options), options, isReplacement(candidate));',
            'promises.lstat = async (candidate, options) =>',
            '  applyIdentity(await originalLstat(candidate, options), options, isReplacement(candidate));',
            'promises.open = async (...args) => {',
            '  const file = await originalOpen(...args);',
            "  if (args[0] === '.dev.vars') {",
            '    const originalStat = file.stat.bind(file);',
            '    file.stat = async (options) =>',
            '      applyIdentity(await originalStat(options), options, false);',
            '  }',
            '  return file;',
            '};',
          ].join('\n'),
        );

        const result = runCloudflare(fixture, ['--live', '--retry=3', '--retryDelay=0'], {
          CLOUDFLARE_FAILURE: 'replace-file',
          CLOUDFLARE_IDENTITY_FIELD: field,
          NODE_OPTIONS: preloadNodeOptions(preload),
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(readFileSync(fixture.attempts, 'utf-8')).toBe('1');
        expect(readFileSync(fixture.vars, 'utf-8')).toBe('independently replaced credentials\n');
        expect(readFileSync(`${fixture.vars}.original`)).toEqual(Buffer.alloc(0));
        expectNoCloudflareCredentialArtifacts(fixture);
      });
    },
  );

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
        expect(readFileSync(detached)).toEqual(Buffer.alloc(0));
        expect(statSync(detached).mode % 0o1000).toBe(0o600);
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
            "  if (args[0] === '.dev.vars' || args[0].startsWith('.dev.vars.openai-staging-')) {",
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
          NODE_OPTIONS: preloadNodeOptions(preload),
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(readFileSync(fixture.vars, 'utf-8')).toBe('independent replacement');
        expect(readFileSync(`${fixture.vars}.race-original`)).toEqual(Buffer.alloc(0));
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
            NODE_OPTIONS: preloadNodeOptions(preload),
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
            "  if (args[0] === '.dev.vars' || args[0].startsWith('.dev.vars.openai-staging-')) {",
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
          { CLOUDFLARE_STAGING_SIGNAL: signal, NODE_OPTIONS: preloadNodeOptions(preload) },
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
      expect(observations(fixture).map(({ command }) => command)).toEqual([
        'install -D openai',
        'run tsc',
        'run test:smoke',
      ]);
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
          '        await file.write(contents, 0, contents.length, Number(metadata.size));',
          '      }',
          '      return metadata;',
          '    };',
          '  }',
          '  return file;',
          '};',
        ].join('\n'),
      );

      const result = runCloudflare(fixture, ['--live'], { NODE_OPTIONS: preloadNodeOptions(preload) });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('64 KiB');
      expect(statSync(fixture.vars).size).toBe(originalContents.length + 64 * 1024 + 1);
      expect(observations(fixture).map(({ command }) => command)).toEqual([
        'install -D openai',
        'run tsc',
        'run test:smoke',
      ]);
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
        'run test:smoke',
        'run test:ci',
        'install -D openai',
        'run tsc',
        'run test:smoke',
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
        'run test:smoke',
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
      expect(records.map(({ command }) => command)).toEqual([
        'install -D openai',
        'run tsc',
        'run test:smoke',
        'run test:ci',
      ]);
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
      expect(records.map(({ command }) => command)).toEqual([
        'install -D openai',
        'run tsc',
        'run test:smoke',
      ]);
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
      expect(records.map(({ command }) => command)).toEqual([
        'install -D openai',
        'run tsc',
        'run test:smoke',
      ]);
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
      expect(records.map(({ command }) => command)).toEqual([
        'install -D openai',
        'run tsc',
        'run test:smoke',
      ]);
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
      expect(records.map(({ command }) => command)).toEqual([
        'install -D openai',
        'run tsc',
        'run test:smoke',
      ]);
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
      expect(records.map(({ command }) => command)).toEqual([
        'install -D openai',
        'run tsc',
        'run test:smoke',
      ]);
      expect(statSync(fixture.vars).isDirectory()).toBe(true);
    });
  });
});
