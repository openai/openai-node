import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

interface PublishEvent {
  command: string;
  args?: string[];
  token?: string;
  oidcUrl?: string;
  oidcToken?: string;
  config?: string;
  registry?: string;
}

function writeExecutable(filename: string, source: string): void {
  writeFileSync(filename, `${source}\n`);
  chmodSync(filename, 0o755);
}

describe('bin/publish-npm credential isolation', () => {
  let fixture: string;
  let originalConfig: string;
  let eventsPath: string;

  beforeEach(() => {
    fixture = mkdtempSync(path.join(tmpdir(), 'openai-publish-npm-'));
    originalConfig = path.join(fixture, 'home/.npmrc');
    eventsPath = path.join(fixture, 'events.jsonl');

    for (const directory of ['bin', 'dist', 'home', 'mock-bin', 'oidc/node_modules/.bin']) {
      mkdirSync(path.join(fixture, directory), { recursive: true });
    }

    copyFileSync(path.join(process.cwd(), 'bin/publish-npm'), path.join(fixture, 'bin/publish-npm'));
    writeFileSync(originalConfig, 'registry=https://registry.example.test/\n');
    writeFileSync(path.join(fixture, 'dist/package.json'), '{}\n');

    writeExecutable(
      path.join(fixture, 'bin/check-npm-version'),
      [
        '#!/usr/bin/env bash',
        'printf \'{"command":"version-check","token":"%s","oidcUrl":"%s","oidcToken":"%s"}\\n\' "$NPM_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL" "$ACTIONS_ID_TOKEN_REQUEST_TOKEN" >> "$PUBLISH_EVENTS"',
        'exit "$VERSION_STATUS"',
      ].join('\n'),
    );

    const npmMock = [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      'const [command, ...args] = process.argv.slice(2);',
      'const config = process.env.NPM_CONFIG_USERCONFIG;',
      "const name = command === 'config' ? command + ':' + args[0] : command;",
      'const event = { command: name, args, token: process.env.NPM_TOKEN, config,',
      '  oidcUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,',
      '  oidcToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,',
      '  registry: process.env.npm_config_registry };',
      "fs.appendFileSync(process.env.PUBLISH_EVENTS, JSON.stringify(event) + '\\n');",
      "if (command === 'view') {",
      "  process.stdout.write(JSON.stringify(process.env.LAST_VERSION ?? '1.0.0') + '\\n');",
      '}',
      'if (command === process.env.FAIL_PHASE) process.exit(17);',
    ].join('\n');
    writeExecutable(path.join(fixture, 'mock-bin/npm'), npmMock);
    writeExecutable(path.join(fixture, 'oidc/node_modules/.bin/npm'), npmMock);

    writeExecutable(
      path.join(fixture, 'mock-bin/pnpm'),
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const event = { command: "build", token: process.env.NPM_TOKEN, config: process.env.NPM_CONFIG_USERCONFIG,',
        '  oidcUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,',
        '  oidcToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN };',
        "fs.appendFileSync(process.env.PUBLISH_EVENTS, JSON.stringify(event) + '\\n');",
        'if (process.env.FAIL_PHASE === "build") process.exit(17);',
      ].join('\n'),
    );

    writeExecutable(
      path.join(fixture, 'mock-bin/jq'),
      [
        '#!/usr/bin/env node',
        "const field = process.argv.find((arg) => ['.name', '.version', '.'].includes(arg));",
        "const value = field === '.name' ? 'openai'",
        "  : field === '.version' ? process.env.PUBLISH_VERSION ?? '1.2.0'",
        "  : process.env.LAST_VERSION ?? '1.0.0';",
        'process.stdout.write(value);',
      ].join('\n'),
    );
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  function runPublisher(overrides: Record<string, string | undefined> = {}) {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: path.join(fixture, 'home'),
      PATH: [path.join(fixture, 'mock-bin'), process.env['PATH'] ?? ''].join(path.delimiter),
      GITHUB_ACTIONS: 'true',
      NPM_TOKEN: 'synthetic-ignored-legacy-token',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example.test/token',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic-oidc-grant',
      ORIGINAL_USERCONFIG: originalConfig,
      PUBLISH_EVENTS: eventsPath,
      VERSION_STATUS: '1',
      ...overrides,
    };
    delete environment['NPM_CONFIG_USERCONFIG'];
    delete environment['npm_config_userconfig'];

    const result = spawnSync('bash', ['bin/publish-npm'], {
      cwd: fixture,
      encoding: 'utf-8',
      env: environment,
    });
    const events = readFileSync(eventsPath, 'utf-8')
      .trim()
      .split('\n')
      .map((entry) => JSON.parse(entry) as PublishEvent);

    return { result, events };
  }

  test.each([
    { name: 'successful publication', failure: '', status: 0 },
    { name: 'failed publication', failure: 'publish', status: 17 },
    { name: 'failed build', failure: 'build', status: 17 },
    { name: 'failed pinned npm installation', failure: 'install', status: 17 },
  ])('isolates trusted-publishing credentials during $name', ({ failure, status }) => {
    const { result, events } = runPublisher({ FAIL_PHASE: failure });

    expect(result.status).toBe(status);
    const commands = ['version-check', 'build', 'install', 'view', 'publish'];
    const failedIndex = commands.indexOf(failure);
    expect(events.map((event) => event.command)).toEqual(
      failedIndex === -1 ? commands : commands.slice(0, failedIndex + 1),
    );
    expect(events.every((event) => !event.token && !event.config)).toBe(true);
    expect(readFileSync(originalConfig, 'utf-8')).toBe('registry=https://registry.example.test/\n');

    for (const event of events) {
      if (event.command === 'publish') {
        expect(event.oidcUrl).toBe('https://oidc.example.test/token');
        expect(event.oidcToken).toBe('synthetic-oidc-grant');
        expect(event.registry).toBe('https://registry.npmjs.org');
      } else {
        expect(event.oidcUrl).toBeFalsy();
        expect(event.oidcToken).toBeFalsy();
      }
    }
    expect(result.stdout).not.toContain('synthetic-ignored-legacy-token');
    expect(result.stderr).not.toContain('synthetic-ignored-legacy-token');
    expect(result.stdout).not.toContain('synthetic-oidc-grant');
    expect(result.stderr).not.toContain('synthetic-oidc-grant');
  });

  test.each([
    { name: 'outside GitHub Actions', overrides: { GITHUB_ACTIONS: 'false' } },
    { name: 'without the OIDC request URL', overrides: { ACTIONS_ID_TOKEN_REQUEST_URL: '' } },
    { name: 'without the OIDC request token', overrides: { ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' } },
    {
      name: 'with only an unsupported legacy token',
      overrides: { ACTIONS_ID_TOKEN_REQUEST_URL: '', ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' },
    },
  ])('rejects publishing $name before building', ({ overrides }) => {
    const { result, events } = runPublisher(overrides);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm publishing requires GitHub Actions OIDC with id-token: write');
    expect(events.map((event) => event.command)).toEqual(['version-check']);
    expect(events[0]?.token).toBeFalsy();
    expect(events[0]?.oidcUrl).toBeFalsy();
    expect(events[0]?.oidcToken).toBeFalsy();
    expect(readFileSync(originalConfig, 'utf-8')).toBe('registry=https://registry.example.test/\n');
  });

  test('preserves the already-published no-op without requiring credentials', () => {
    const { result, events } = runPublisher({
      VERSION_STATUS: '0',
      GITHUB_ACTIONS: 'false',
      ACTIONS_ID_TOKEN_REQUEST_URL: '',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: '',
    });
    expect(result.status).toBe(0);
    expect(events.map((event) => event.command)).toEqual(['version-check']);
  });

  test('propagates version-preflight failures before inspecting credentials', () => {
    const { result, events } = runPublisher({
      VERSION_STATUS: '17',
      GITHUB_ACTIONS: 'false',
      ACTIONS_ID_TOKEN_REQUEST_URL: '',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: '',
    });

    expect(result.status).toBe(17);
    expect(events.map((event) => event.command)).toEqual(['version-check']);
  });

  test.each([
    { name: 'stable version', version: '1.2.0', previous: '1.0.0', tag: 'latest' },
    { name: 'alpha after a stable release', version: '1.2.0-alpha.1', previous: '1.0.0', tag: 'alpha' },
    { name: 'beta after a stable release', version: '1.2.0-beta.1', previous: '1.0.0', tag: 'beta' },
    {
      name: 'prerelease without an earlier stable release',
      version: '1.2.0-alpha.1',
      previous: '1.0.0-beta.1',
      tag: 'latest',
    },
  ])('preserves the registry tag for a $name', ({ version, previous, tag }) => {
    const { result, events } = runPublisher({ PUBLISH_VERSION: version, LAST_VERSION: previous });

    expect(result.status).toBe(0);
    expect(events.find((event) => event.command === 'install')?.args).toEqual([
      '--prefix',
      'oidc/',
      'npm@11.6.2',
    ]);
    expect(events.find((event) => event.command === 'publish')?.args).toEqual(['--tag', tag]);
  });
});

test('clears OIDC grants before installing dependencies in the protected release workflow', () => {
  const workflow = readFileSync(path.join(process.cwd(), '.github/workflows/create-releases.yml'), 'utf-8');

  expect(workflow).toMatch(
    /- name: Install dependencies\s+run: \|\s+unset ACTIONS_ID_TOKEN_REQUEST_URL ACTIONS_ID_TOKEN_REQUEST_TOKEN\s+pnpm install --frozen-lockfile/u,
  );
});
