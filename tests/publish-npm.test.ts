import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
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
  token?: string;
  config?: string;
  mode?: number;
  contents?: string;
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
        'printf \'{"command":"version-check","token":"%s"}\\n\' "$NPM_TOKEN" >> "$PUBLISH_EVENTS"',
        'exit 1',
      ].join('\n'),
    );

    const npmMock = [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      'const [command, ...args] = process.argv.slice(2);',
      'const config = process.env.NPM_CONFIG_USERCONFIG;',
      "const name = command === 'config' ? command + ':' + args[0] : command;",
      'const event = { command: name, token: process.env.NPM_TOKEN, config };',
      "if (command === 'publish' && config) {",
      '  event.mode = fs.statSync(config).mode & 0o777;',
      "  event.contents = fs.readFileSync(config, 'utf8');",
      '}',
      "fs.appendFileSync(process.env.PUBLISH_EVENTS, JSON.stringify(event) + '\\n');",
      "if (command === 'config' && args[0] === 'get') process.stdout.write(process.env.ORIGINAL_USERCONFIG);",
      "if (command === 'config' && args[0] === 'set') {",
      "  fs.writeFileSync(process.env.ORIGINAL_USERCONFIG, args[1] + '=' + args[2] + '\\n');",
      '}',
      "if (command === 'view') process.stdout.write('\"1.0.0\"\\n');",
      "if (command === 'publish' && process.env.FAIL_PHASE === 'signal') process.kill(process.ppid, 'SIGTERM');",
      'if (command === process.env.FAIL_PHASE) process.exit(17);',
    ].join('\n');
    writeExecutable(path.join(fixture, 'mock-bin/npm'), npmMock);
    writeExecutable(path.join(fixture, 'oidc/node_modules/.bin/npm'), npmMock);

    writeExecutable(
      path.join(fixture, 'mock-bin/pnpm'),
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const event = { command: "build", token: process.env.NPM_TOKEN, config: process.env.NPM_CONFIG_USERCONFIG };',
        "fs.appendFileSync(process.env.PUBLISH_EVENTS, JSON.stringify(event) + '\\n');",
        'if (process.env.FAIL_PHASE === "build") process.exit(17);',
      ].join('\n'),
    );

    writeExecutable(
      path.join(fixture, 'mock-bin/jq'),
      [
        '#!/usr/bin/env node',
        "const field = process.argv.find((arg) => ['.name', '.version', '.'].includes(arg));",
        "process.stdout.write(field === '.name' ? 'openai' : field === '.version' ? '1.2.0' : '1.0.0');",
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
      NPM_TOKEN: 'synthetic-publish-token',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: '',
      ORIGINAL_USERCONFIG: originalConfig,
      PUBLISH_EVENTS: eventsPath,
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
    { name: 'termination signal', failure: 'signal', status: 143 },
  ])('isolates and removes temporary credentials after $name', ({ failure, status }) => {
    const { result, events } = runPublisher({ FAIL_PHASE: failure });

    expect(result.status).toBe(status);
    expect(events.map((event) => event.command)).toEqual([
      'version-check',
      'build',
      'install',
      'config:get',
      'view',
      'publish',
    ]);
    expect(events.every((event) => !event.token)).toBe(true);

    const publication = events.find((event) => event.command === 'publish');
    if (!publication?.config) {
      throw new Error('Mock publication did not receive a temporary npm configuration.');
    }
    expect(publication.config).not.toBe(originalConfig);
    expect(publication.mode).toBe(0o600);
    expect(publication.contents).toContain('registry=https://registry.example.test/');
    expect(publication.contents).toContain('//registry.npmjs.org/:_authToken=synthetic-publish-token');
    expect(existsSync(publication.config)).toBe(false);
    expect(readFileSync(originalConfig, 'utf-8')).toBe('registry=https://registry.example.test/\n');
    expect(result.stdout).not.toContain('synthetic-publish-token');
    expect(result.stderr).not.toContain('synthetic-publish-token');
  });

  test('preserves tokenless trusted publishing without creating registry credentials', () => {
    const { result, events } = runPublisher({
      NPM_TOKEN: undefined,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic-oidc-grant',
    });

    expect(result.status).toBe(0);
    expect(events.map((event) => event.command)).toEqual([
      'version-check',
      'build',
      'install',
      'view',
      'publish',
    ]);
    expect(events.every((event) => !event.token && !event.config)).toBe(true);
    expect(readFileSync(originalConfig, 'utf-8')).toBe('registry=https://registry.example.test/\n');
  });
});
