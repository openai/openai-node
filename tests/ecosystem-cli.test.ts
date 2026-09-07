import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';

const root = process.cwd();
const protectedMainCondition =
  "github.repository == 'openai/openai-node' && github.event_name == 'push' && github.ref == 'refs/heads/main' && github.actor != 'dependabot[bot]'";

function normalizeLineEndings(value: string) {
  return value.split(/\r\n?/u).join('\n');
}

function runCli(args: string[], cwd = root, env: Partial<NodeJS.ProcessEnv> = {}) {
  return spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules/ts-node/dist/bin.js'),
      '-r',
      path.join(root, 'node_modules/tsconfig-paths/register.js'),
      path.join(root, 'ecosystem-tests/cli.ts'),
      ...args,
    ],
    {
      cwd,
      encoding: 'utf-8',
      env: {
        ...process.env,
        OPENAI_API_KEY: undefined,
        DISABLE_V8_COMPILE_CACHE: '1',
        TS_NODE_PROJECT: path.join(root, 'tsconfig.json'),
        TS_NODE_TRANSPILE_ONLY: 'true',
        ...env,
      },
      timeout: 15_000,
    },
  );
}

function workflowJob(workflow: string, name: string) {
  const normalizedWorkflow = normalizeLineEndings(workflow);
  return normalizedWorkflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[a-z_]+:\n/u)[0] ?? '';
}

function workflowCondition(job: string) {
  return job
    .split('    if: >-\n')[1]
    ?.split('\n    environment:')[0]
    ?.split('\n')
    .slice(1, -1)
    .map((line) => line.trim())
    .join(' ');
}

function writeSuccessfulNpmStub(bin: string) {
  const filename = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const contents = process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n';
  writeFileSync(path.join(bin, filename), contents, { mode: 0o755 });
}

describe('ecosystem test CLI', () => {
  test('limits live examples and ecosystem credentials to protected main pushes', () => {
    const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf-8');
    const liveJob = workflowJob(workflow, 'examples');
    const ecosystemJob = workflowJob(workflow, 'ecosystem_tests');

    expect(workflowCondition(liveJob)).toBe(protectedMainCondition);
    expect(liveJob).toContain('\n    environment: ci\n');
    expect(liveJob).toContain('pnpm tsn examples/chat-completions/demo.ts');
    expect(liveJob).toContain(
      'pnpm tsn ecosystem-tests/cli.ts --live --verbose --parallel --jobs=4 --retry=3',
    );
    expect(liveJob.match(/secrets\.OPENAI_API_KEY/gu)).toHaveLength(1);

    expect(ecosystemJob).toContain('pnpm tsn ecosystem-tests/cli.ts --verbose --parallel --jobs=4 --retry=3');
    expect(ecosystemJob).not.toContain('--live');
    expect(ecosystemJob).not.toContain('OPENAI_API_KEY');
    expect(ecosystemJob).not.toContain('environment: ci');
    expect(workflow.match(/secrets\.OPENAI_API_KEY/gu)).toHaveLength(1);
  });

  test('reads protected workflow conditions from CRLF checkouts', () => {
    const workflow = normalizeLineEndings(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf-8'))
      .split('\n')
      .join('\r\n');

    expect(workflowCondition(workflowJob(workflow, 'examples'))).toBe(protectedMainCondition);
  });

  test.each([
    ['protected main push', 'push', 'refs/heads/main', 'octocat', 'openai/openai-node', true],
    ['Dependabot push to main', 'push', 'refs/heads/main', 'dependabot[bot]', 'openai/openai-node', false],
    [
      'unprotected same-repository branch push',
      'push',
      'refs/heads/feature',
      'octocat',
      'openai/openai-node',
      false,
    ],
    [
      'same-repository pull request',
      'pull_request',
      'refs/pull/42/merge',
      'octocat',
      'openai/openai-node',
      false,
    ],
    ['fork pull request', 'pull_request', 'refs/pull/43/merge', 'octocat', 'openai/openai-node', false],
    [
      'merge group',
      'merge_group',
      'refs/heads/gh-readonly-queue/main/pr-42',
      'octocat',
      'openai/openai-node',
      false,
    ],
    ['workflow dispatch', 'workflow_dispatch', 'refs/heads/main', 'octocat', 'openai/openai-node', false],
    ['different repository main push', 'push', 'refs/heads/main', 'octocat', 'octocat/openai-node', false],
  ])(
    'runs credential-free ecosystem checks and gates live checks for a %s',
    (_event, eventName, ref, actor, repository, trusted) => {
      const live =
        repository === 'openai/openai-node' &&
        eventName === 'push' &&
        ref === 'refs/heads/main' &&
        actor !== 'dependabot[bot]';

      expect({ credentialFree: true, live }).toEqual({ credentialFree: true, live: trusted });
    },
  );

  test.each(['--live', '--deploy'])('rejects keyless %s before running projects', (option) => {
    const result = runCli([option]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('OPENAI_API_KEY');
    expect(result.stderr).not.toContain('running projects:');
    expect(result.stdout).not.toContain('[run]:');
  });

  test('shows help without credentials', () => {
    const result = runCli(['--help']);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('run tests using various different project setups');
    expect(result.stdout).toContain('--live');
    expect(result.stderr).not.toContain('OPENAI_API_KEY');
  });

  test.each([
    undefined,
    '0',
    '-0',
    '2',
    '2e0',
    '1.0000000000000000',
    '10e-1',
    '.2e1',
    '0x2',
    '0o2',
    '0b10',
    '0e-400',
    '-0.000e-400',
    ' 2 ',
    '9007199254740991',
  ])('permits bounded keyless non-live project checks with retry %s', (retry) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-ecosystem-cli-'));

    try {
      writeFileSync(path.join(fixture, 'package.json'), '{}\n');

      const result = runCli(
        [
          'node-ts-cjs',
          '--skip=node-ts-cjs',
          '--skipPack',
          '--noCleanup',
          ...(retry === undefined ? [] : [`--retry=${retry}`]),
        ],
        fixture,
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toContain('running projects:');
      expect(result.stderr).not.toContain('▶️');
      expect(result.stderr).not.toContain('OPENAI_API_KEY');
      expect(result.stdout).not.toContain('[run]:');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test.each([
    ['NaN', true],
    ['Infinity', true],
    ['-Infinity', true],
    ['1e309', true],
    ['-1', true],
    ['0.5', true],
    ['0.99999999999999999', true],
    ['1.0000000000000001', true],
    [' 1.0000000000000001 ', true],
    ['9007199254740991.1', true],
    ['10000000000000001e-16', true],
    ['1e-400', true],
    ['-1e-400', true],
    ['9007199254740992', true],
    ['1e20', true],
    ['NaN', false],
    ['1.0000000000000001', false],
  ] as const)('rejects retry %s before ecosystem setup with skipPack=%s', (retry, skipPack) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'openai-ecosystem-retry-count-'));

    try {
      writeFileSync(path.join(fixture, 'package.json'), '{}\n');

      const result = runCli(
        ['node-js', '--skip=node-js', ...(skipPack ? ['--skipPack'] : []), '--noCleanup', `--retry=${retry}`],
        fixture,
        { PATH: path.join(fixture, 'missing-bin') },
      );

      expect(result.error, result.stdout + result.stderr).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(1);
      expect(result.stderr).toContain('--retry must be a non-negative safe integer.');
      expect(result.stderr).not.toContain('rootDir:');
      expect(result.stderr).not.toContain('running projects:');
      expect(result.stdout).not.toContain('[run]:');
      expect(existsSync(path.join(fixture, '.pack'))).toBe(false);
      expect(existsSync(path.join(fixture, 'tmp'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test.each([
    ['an unknown project', ['bun-typo'], true],
    ['mixed known and unknown projects', ['node-js', 'bun-typo'], true],
    ['an inherited property name', ['toString'], true],
    ['a numeric zero', ['0'], true],
    ['an empty project name', [''], true],
    ['an unknown project after --', ['--', 'bun-typo'], true],
    ['an unknown project with packing enabled', ['bun-typo'], false],
  ] as const)('rejects %s before ecosystem setup', (_name, projects, skipPack) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'openai-ecosystem-project-selection-'));

    try {
      writeFileSync(path.join(fixture, 'package.json'), '{}\n');

      const result = runCli([...(skipPack ? ['--skipPack'] : []), '--noCleanup', ...projects], fixture, {
        PATH: path.join(fixture, 'missing-bin'),
      });

      expect(result.error, result.stdout + result.stderr).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(1);
      expect(result.stderr).toContain('Unknown ecosystem project:');
      expect(result.stderr).not.toContain('running projects:');
      expect(result.stdout).not.toContain('[run]:');
      expect(existsSync(path.join(fixture, '.pack'))).toBe(false);
      expect(existsSync(path.join(fixture, 'tmp'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test.each([
    { name: 'sequential', options: [], packageOption: '--fromNpm', retryDelay: 7 },
    { name: 'explicit worker count', options: ['--jobs=2'], packageOption: '--fromNpm', retryDelay: 25 },
    { name: 'parallel', options: ['--parallel'], packageOption: '--from-npm', retryDelay: 0 },
    {
      name: 'default-delay parallel',
      options: ['--parallel'],
      packageOption: '--from-npm',
      retryDelay: undefined,
    },
  ])('installs and retries a local package in $name mode', ({ options, packageOption, retryDelay }) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-ecosystem-cli-'));
    const dependency = path.join(fixture, 'selected package = fixture');
    const projects = ['node-js', 'cloudflare-worker'];
    const version = '0.0.0-selected-fixture';

    try {
      mkdirSync(dependency);
      writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: 'openai', version }));
      writeFileSync(
        path.join(fixture, 'package.json'),
        JSON.stringify({
          private: true,
          packageManager: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8')).packageManager,
          scripts: { tsn: 'node tsn.cjs' },
        }),
      );
      writeFileSync(
        path.join(fixture, 'tsn.cjs'),
        `require(${JSON.stringify(path.join(root, 'node_modules/ts-node/dist/bin.js'))}).main();\n`,
      );
      // The fixture uses the repository's installed ts-node; parallel workers need no root install.
      writeFileSync(path.join(fixture, 'pnpm-workspace.yaml'), 'verifyDepsBeforeRun: false\n');

      for (const name of projects) {
        const project = path.join(fixture, 'ecosystem-tests', name);
        mkdirSync(project, { recursive: true });
        // pnpm workers strip npm_config_* from the environment. Keep local installs offline
        // even with npm versions that audit linked packages.
        writeFileSync(
          path.join(project, '.npmrc'),
          'audit=false\nfund=false\noffline=true\npackage-lock=false\nupdate-notifier=false\n',
        );
        writeFileSync(
          path.join(project, 'package.json'),
          JSON.stringify({
            private: true,
            scripts: { tsc: 'node test.js', 'test:smoke': 'node test.js' },
          }),
        );
        writeFileSync(
          path.join(project, 'test.js'),
          [
            "const fs = require('node:fs');",
            "const { version } = require('openai/package.json');",
            "const firstAttempt = !fs.existsSync('installed-version.txt');",
            "fs.writeFileSync('installed-version.txt', version);",
            'if (firstAttempt) process.exit(1);',
          ].join('\n'),
        );
      }

      const result = runCli(
        [
          ...projects,
          `${packageOption}=${dependency}`,
          '--noCleanup',
          '--retry=1',
          ...(retryDelay === undefined ? [] : [`--retryDelay=${retryDelay}`]),
          ...options,
        ],
        fixture,
      );

      expect(result.error, result.stdout + result.stderr).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect((result.stdout + result.stderr).match(/next retry in \d+ms/gu)).toEqual(
        projects.map(() => `next retry in ${retryDelay ?? 1000}ms`),
      );
      for (const project of projects) {
        expect(
          readFileSync(path.join(fixture, 'ecosystem-tests', project, 'installed-version.txt'), 'utf-8'),
        ).toBe(version);
      }
      expect(existsSync(path.join(fixture, '.pack'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test.each([
    ['selected package', true, false, '', 0],
    ['live selected package', true, true, '', 0],
    ['install failure', true, false, 'install', 0],
    ['typecheck failure', true, false, 'typecheck', 0],
    ['test failure', true, false, 'test', 0],
    ['test failure with retry budget', true, false, 'test', 2],
    ['local tarball', false, false, '', 0],
    ['live local tarball', false, true, '', 0],
    ['local tarball test failure', false, false, 'test', 0],
  ] as const)('runs Bun validation for %s', (_name, fromNpm, live, failure, retry) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'openai-bun-cli-'));
    const bin = path.join(fixture, 'bin');
    const project = path.join(fixture, 'ecosystem-tests', 'bun');
    const selectedPackage = path.join(fixture, 'selected package = fixture');
    const observations = path.join(fixture, 'commands.jsonl');
    const recordCommand = [
      "const fs = require('node:fs');",
      'const args = process.argv.slice(2);',
      "const phase = tool === 'npm' ? 'typecheck' : args[0] === 'install' ? 'install' : 'test';",
      'const observation = { tool, args, apiKeyPresent: Boolean(process.env.OPENAI_API_KEY) };',
      "fs.appendFileSync(process.env.ECOSYSTEM_COMMAND_OBSERVATIONS, JSON.stringify(observation) + '\\n');",
      'process.exit(phase === process.env.ECOSYSTEM_COMMAND_FAILURE ? 47 : 0);',
    ].join('\n');

    try {
      mkdirSync(bin);
      mkdirSync(project, { recursive: true });
      mkdirSync(path.join(fixture, '.pack'));
      writeFileSync(path.join(fixture, 'package.json'), '{}\n');
      writeFileSync(path.join(fixture, '.pack', 'openai.tgz'), 'synthetic command-dispatch fixture');
      // Record command dispatch and exit statuses; no real Bun or package installation is needed.
      for (const tool of ['bun', 'npm']) {
        const script = path.join(bin, process.platform === 'win32' ? `${tool}.cjs` : tool);
        writeFileSync(script, `#!/usr/bin/env node\nconst tool = '${tool}';\n${recordCommand}`, {
          mode: 0o755,
        });
        if (process.platform === 'win32') {
          writeFileSync(path.join(bin, `${tool}.cmd`), `@"${process.execPath}" "${script}" %*\r\n`);
        }
      }

      const result = runCli(
        [
          'bun',
          ...(fromNpm ? [`--from-npm=${selectedPackage}`] : []),
          '--skipPack',
          '--noCleanup',
          `--retry=${retry}`,
          '--retryDelay=0',
          ...(live ? ['--live'] : []),
        ],
        fixture,
        {
          PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
          OPENAI_API_KEY: 'synthetic-bun-cli-key',
          ECOSYSTEM_COMMAND_OBSERVATIONS: observations,
          ECOSYSTEM_COMMAND_FAILURE: failure,
        },
      );

      expect(result.error, result.stdout + result.stderr).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(failure ? 1 : 0);
      const expected = [
        {
          tool: 'bun',
          args: ['install', '-D', fromNpm ? selectedPackage : './openai.tgz'],
          apiKeyPresent: false,
        },
        { tool: 'npm', args: ['run', 'tsc'], apiKeyPresent: false },
        {
          tool: 'bun',
          args: live ? ['test'] : ['test', 'workload-identity-access-token.test.ts'],
          apiKeyPresent: live,
        },
      ];
      const failedPhase = ['install', 'typecheck', 'test'].indexOf(failure);
      expect(
        readFileSync(observations, 'utf-8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
      ).toEqual(
        Array.from({ length: retry + 1 }, () =>
          expected.slice(0, failedPhase === -1 ? expected.length : failedPhase + 1),
        ).flat(),
      );
      expect(result.stdout + result.stderr).not.toContain('synthetic-bun-cli-key');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test.each([
    {
      projectName: 'node-ts-cjs',
      option: '--live',
      phase: 'live-test',
      scripts: { tsc: 'node observe.cjs typecheck', test: 'node observe.cjs live-test' },
    },
    {
      projectName: 'cloudflare-worker',
      option: '--deploy',
      phase: 'deploy',
      scripts: {
        tsc: 'node observe.cjs typecheck',
        'test:smoke': 'node observe.cjs smoke',
        deploy: 'node observe.cjs deploy',
      },
    },
  ])(
    'provides API credentials and case variants only to the $phase ecosystem command',
    ({ projectName, option, phase, scripts }) => {
      const fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-ecosystem-cli-'));
      const project = path.join(fixture, 'ecosystem-tests', projectName);
      const dependency = path.join(fixture, 'local-dependency');
      const observations = path.join(fixture, 'observations.jsonl');
      const apiKey = 'synthetic-ecosystem-test-key';
      const mixedCaseApiKey = 'synthetic-ecosystem-mixed-case-key';
      const lowercaseApiKey = 'synthetic-ecosystem-lowercase-key';
      const inheritedApiKeyNames =
        process.platform === 'win32'
          ? ['OPENAI_API_KEY']
          : ['OPENAI_API_KEY', 'OpenAI_API_Key', 'openai_api_key'];
      const observe = [
        "const fs = require('node:fs');",
        'const apiKeyNames = Object.keys(process.env).filter((name) => name.toLowerCase() === "openai_api_key").sort();',
        'const observation = { phase: process.argv[2], apiKey: process.env.OPENAI_API_KEY ?? null, apiKeyNames, unrelatedValue: process.env.ECOSYSTEM_UNRELATED_VALUE ?? null };',
        "fs.appendFileSync(process.env.ECOSYSTEM_COMMAND_OBSERVATIONS, JSON.stringify(observation) + '\\n');",
      ].join('\n');

      try {
        mkdirSync(project, { recursive: true });
        mkdirSync(dependency);
        writeFileSync(path.join(fixture, 'package.json'), '{}\n');
        writeFileSync(
          path.join(project, 'package.json'),
          JSON.stringify({
            name: 'ecosystem-project',
            private: true,
            scripts,
          }),
        );
        writeFileSync(path.join(project, 'observe.cjs'), observe);
        writeFileSync(
          path.join(dependency, 'package.json'),
          JSON.stringify({
            name: 'openai',
            version: '0.0.0',
            scripts: { postinstall: 'node observe.cjs install' },
          }),
        );
        writeFileSync(path.join(dependency, 'observe.cjs'), observe);

        const result = runCli(
          [projectName, `--fromNpm=${dependency}`, '--skipPack', '--noCleanup', option],
          fixture,
          {
            OPENAI_API_KEY: apiKey,
            OpenAI_API_Key: mixedCaseApiKey,
            openai_api_key: lowercaseApiKey,
            ECOSYSTEM_COMMAND_OBSERVATIONS: observations,
            ECOSYSTEM_UNRELATED_VALUE: 'preserved-value',
            npm_config_audit: 'false',
            npm_config_fund: 'false',
            npm_config_offline: 'true',
            npm_config_package_lock: 'false',
          },
        );

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        for (const secret of [apiKey, mixedCaseApiKey, lowercaseApiKey]) {
          expect(result.stdout).not.toContain(secret);
          expect(result.stderr).not.toContain(secret);
        }
        expect(
          readFileSync(observations, 'utf-8')
            .trim()
            .split('\n')
            .map((observation) => JSON.parse(observation)),
        ).toEqual([
          { phase: 'install', apiKey: null, apiKeyNames: [], unrelatedValue: 'preserved-value' },
          { phase: 'typecheck', apiKey: null, apiKeyNames: [], unrelatedValue: 'preserved-value' },
          ...(projectName === 'cloudflare-worker'
            ? [{ phase: 'smoke', apiKey: null, apiKeyNames: [], unrelatedValue: 'preserved-value' }]
            : []),
          { phase, apiKey, apiKeyNames: inheritedApiKeyNames, unrelatedValue: 'preserved-value' },
        ]);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    },
  );

  const existingCloudflareDevVars = "OPENAI_API_KEY='existing-test-secret'\nANOTHER_VAR='keep-me'\n";

  test.each([
    {
      name: 'preserves existing Cloudflare credentials without an API key',
      existingVars: existingCloudflareDevVars,
      apiKey: undefined,
      expectedVars: existingCloudflareDevVars,
    },
    {
      name: 'does not create Cloudflare credentials without an API key',
      existingVars: undefined,
      apiKey: undefined,
      expectedVars: undefined,
    },
    {
      name: 'preserves existing Cloudflare credentials when the API key is empty',
      existingVars: existingCloudflareDevVars,
      apiKey: '',
      expectedVars: existingCloudflareDevVars,
    },
    {
      name: 'preserves existing Cloudflare credentials in non-live mode with an API key',
      existingVars: existingCloudflareDevVars,
      apiKey: 'test-api-key',
      expectedVars: existingCloudflareDevVars,
    },
  ])('$name', ({ existingVars, apiKey, expectedVars }) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-ecosystem-cli-'));
    const worker = path.join(fixture, 'ecosystem-tests', 'cloudflare-worker');
    const bin = path.join(fixture, 'bin');
    const devVars = path.join(worker, '.dev.vars');

    try {
      mkdirSync(worker, { recursive: true });
      mkdirSync(bin);
      writeFileSync(path.join(fixture, 'package.json'), '{}\n');
      writeSuccessfulNpmStub(bin);

      if (existingVars !== undefined) {
        writeFileSync(devVars, existingVars);
      }

      const result = runCli(['cloudflare-worker', '--fromNpm=openai', '--skipPack', '--noCleanup'], fixture, {
        PATH: bin,
        OPENAI_API_KEY: apiKey,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);

      if (expectedVars === undefined) {
        expect(existsSync(devVars)).toBe(false);
      } else {
        const actualVars = readFileSync(devVars, 'utf-8');
        expect(actualVars).toBe(expectedVars);
        expect(actualVars).not.toContain('undefined');
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
