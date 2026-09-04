import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const workflow = readFileSync(path.join(root, '.github/workflows/create-releases.yml'), 'utf-8')
  .split('\r\n')
  .join('\n');
const publishJob = workflow.split('\n  publish:\n')[1] ?? '';
const releaseCIJob = workflow.split('\n  release-ci:\n')[1]?.split(/\n {2}[\w-]+:\n/u)[0] ?? '';

function workflowRunStep(name: string, job = publishJob): string {
  const [, step] = job.split(`      - name: ${name}\n`);
  const script = step?.split('        run: |\n')[1]?.split('\n      - ')[0];

  if (!script) {
    throw new Error(`Missing workflow run step: ${name}`);
  }

  return script
    .split('\n')
    .map((line) => line.slice(10))
    .join('\n');
}

function writeExecutable(filename: string, source: string) {
  writeFileSync(filename, `#!/usr/bin/env node\n${source}\n`, { mode: 0o755 });
}

describe('release commit CI gate', () => {
  test('requires successful release CI before publication', () => {
    const publicationCondition = "    if: needs.publication-check.outputs.should_publish == 'true'\n";
    expect(publishJob).toContain(publicationCondition);
    expect(publishJob).toContain('\n      - release-ci\n');
    expect(releaseCIJob).toContain(publicationCondition);
    expect(releaseCIJob).toContain('\n    needs: publication-check\n');
    // oxlint-disable-next-line no-template-curly-in-string -- This is a literal GitHub Actions expression.
    expect(releaseCIJob).toContain('RELEASE_SHA: ${{ needs.publication-check.outputs.release_sha }}');
    expect(releaseCIJob).toContain('      actions: read\n      checks: read');
    expect(releaseCIJob).not.toContain('continue-on-error:');
  });

  test.each([
    { name: 'successful CI', exitCode: 0, watchExit: 0 },
    { name: 'failed CI', exitCode: 1, watchExit: 1 },
    { name: 'cancelled CI', exitCode: 1, watchExit: 1 },
    { name: 'missing CI', exitCode: 1, missing: true, error: 'No CI push workflow found' },
    { name: 'mismatched commit', exitCode: 1, mismatch: true, error: 'targets' },
    { name: 'API failure', exitCode: 73, apiFailure: true },
  ])('handles $name for the immutable release commit', (scenario) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-release-ci-'));
    const releaseSHA = 'a'.repeat(40);
    const repository = 'openai/test-sdk';
    const invocations = path.join(fixture, 'gh.jsonl');
    const selectedRun = { id: 42, event: 'push', head_sha: releaseSHA, head_branch: 'main' };

    try {
      writeExecutable(
        path.join(fixture, 'gh'),
        `
const { appendFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
const data = JSON.parse(process.env.GATE_FIXTURE);
appendFileSync(process.env.GATE_INVOCATIONS, JSON.stringify(args) + '\\n');
if (args[0] === 'api') {
  if (data.apiFailure) process.exit(73);
  const query = args[args.indexOf('--jq') + 1];
  let response;
  if (args.includes('repos/' + process.env.GITHUB_REPOSITORY + '/actions/workflows/ci.yml/runs')) {
    const filters = Object.fromEntries(args.flatMap((arg, index) => arg === '-f' ? [args[index + 1].split('=')] : []));
    response = { workflow_runs: data.runs.filter(run =>
      (!filters.event || run.event === filters.event) && (!filters.head_sha || run.head_sha === filters.head_sha)
    ) };
  } else if (args.includes('repos/' + process.env.GITHUB_REPOSITORY + '/actions/runs/42')) {
    response = { head_sha: data.runSHA };
  } else {
    throw new Error('Unexpected API request: ' + JSON.stringify(args));
  }
  process.stdout.write(execFileSync('jq', ['-r', query], { input: JSON.stringify(response), encoding: 'utf8' }));
} else if (args[0] === 'run' && args[1] === 'watch') {
  process.exit(args.includes('--exit-status') ? data.watchExit : 0);
} else {
  throw new Error('Unexpected gh invocation: ' + JSON.stringify(args));
}
`,
      );
      // Keep the missing-run polling path deterministic and fast.
      writeExecutable(path.join(fixture, 'sleep'), 'process.exit(0);');

      const result = spawnSync(
        'bash',
        [
          '-e',
          '-o',
          'pipefail',
          '-c',
          workflowRunStep('Wait for CI on the immutable release commit', releaseCIJob),
        ],
        {
          cwd: fixture,
          encoding: 'utf-8',
          timeout: 15_000,
          env: {
            PATH: `${fixture}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env['PATH']}`,
            GITHUB_REPOSITORY: repository,
            RELEASE_SHA: releaseSHA,
            GH_TOKEN: 'synthetic-github-token',
            GATE_INVOCATIONS: invocations,
            GATE_FIXTURE: JSON.stringify({
              ...scenario,
              runSHA: scenario.mismatch ? 'b'.repeat(40) : releaseSHA,
              runs: [
                { ...selectedRun, id: 11, head_sha: 'b'.repeat(40) },
                { ...selectedRun, id: 12, event: 'pull_request' },
                { ...selectedRun, id: 13, head_branch: 'feature' },
                ...(scenario.missing ? [] : [selectedRun]),
              ],
            }),
          },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(scenario.exitCode);
      if (scenario.error) {
        expect(result.stdout).toContain(scenario.error);
      }

      const calls: string[][] = readFileSync(invocations, 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const watchCalls = calls.filter((args) => args[0] === 'run');
      expect(watchCalls).toEqual(
        scenario.watchExit === undefined
          ? []
          : [['run', 'watch', '42', '--repo', repository, '--exit-status']],
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

describe('trusted npm release publication', () => {
  test('preserves immutable publisher, artifact, OIDC, and npm provenance boundaries', () => {
    const workflowCheckout = publishJob.search(/ref: \$\{\{ github\.sha \}\}/u);
    const releaseCheckout = publishJob.search(
      /ref: \$\{\{ needs\.publication-check\.outputs\.release_sha \}\}/u,
    );

    expect(workflowCheckout).toBeGreaterThan(-1);
    expect(releaseCheckout).toBeGreaterThan(workflowCheckout);
    expect(publishJob).toContain('      contents: read\n      id-token: write');
    expect(publishJob).toContain('npm install --global --ignore-scripts npm@11.6.2');
    expect(publishJob).toMatch(/artifact-ids: \$\{\{ needs\.build-package\.outputs\.artifact-id \}\}/u);
    expect(publishJob).toContain('merge-multiple: true');
    expect(publishJob).toContain('path: dist/');
    expect(publishJob).toContain('digest-mismatch: error');
    expect(publishJob).not.toMatch(/(?:NODE_AUTH_TOKEN|NPM_TOKEN)/u);
    expect(workflow).toContain('retention-days: 7');
    expect(workflowRunStep('Preserve workflow-version publisher')).toMatch(/\$\{RUNNER_TEMP\}/u);
    expect(workflowRunStep('Publish to NPM').trim()).toMatch(
      /^bash "\$\{RUNNER_TEMP\}\/openai-publish-npm"$/u,
    );
  });

  test.each([
    ['stable', '7.5.0', '7.5.0', 'latest'],
    ['prerelease', '7.5.0-beta.1', '7.5.0-beta.1', 'beta'],
    ['mismatched artifact', '7.5.0', '7.5.1', null],
  ])(
    'uses the captured workflow publisher for a historical %s release',
    (_kind, sourceVersion, artifactVersion, expectedTag) => {
      const fixture = mkdtempSync(path.join(tmpdir(), 'openai-node-release-publisher-'));
      const checkout = path.join(fixture, 'checkout');
      const executableDirectory = path.join(fixture, 'executables');
      const runnerTemp = path.join(fixture, 'runner-temp');
      const npmObservations = path.join(fixture, 'npm.jsonl');
      const pnpmInvocation = path.join(fixture, 'pnpm-invoked');

      try {
        mkdirSync(path.join(checkout, 'bin'), { recursive: true });
        mkdirSync(path.join(checkout, 'dist'));
        mkdirSync(executableDirectory);
        mkdirSync(runnerTemp);
        writeFileSync(
          path.join(checkout, 'bin/publish-npm'),
          readFileSync(path.join(root, 'bin/publish-npm')),
        );
        writeFileSync(
          path.join(checkout, 'bin/check-npm-version'),
          readFileSync(path.join(root, 'bin/check-npm-version')),
        );
        writeFileSync(
          path.join(checkout, 'package.json'),
          JSON.stringify({ name: 'openai', version: sourceVersion }),
        );
        writeFileSync(
          path.join(checkout, 'dist/package.json'),
          JSON.stringify({ name: 'openai', version: artifactVersion }),
        );
        writeFileSync(path.join(checkout, 'dist/verified-artifact'), 'preserve verified bytes');

        writeExecutable(
          path.join(executableDirectory, 'npm'),
          [
            "const fs = require('node:fs');",
            'const args = process.argv.slice(2);',
            'const observation = { args, cwd: process.cwd(), registry: process.env.npm_config_registry ?? null, registryToken: Boolean(process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN) };',
            "fs.appendFileSync(process.env.NPM_OBSERVATIONS, JSON.stringify(observation) + '\\n');",
            "if (args[0] === 'view' && args[1].includes('@')) {",
            "  process.stdout.write(JSON.stringify({ error: { code: 'E404' } }));",
            '  process.exit(1);',
            '}',
            "if (args[0] === 'view') process.stdout.write(JSON.stringify('7.4.0'));",
          ].join('\n'),
        );
        writeExecutable(
          path.join(executableDirectory, 'pnpm'),
          [
            "require('node:fs').writeFileSync(process.env.PNPM_INVOCATION, 'obsolete publisher ran');",
            'process.exit(91);',
          ].join('\n'),
        );

        const env = {
          ...process.env,
          PATH: `${executableDirectory}${path.delimiter}${process.env['PATH']}`,
          RUNNER_TEMP: runnerTemp,
          GITHUB_ACTIONS: 'true',
          ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example.test/token',
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic-oidc-token',
          NPM_OBSERVATIONS: npmObservations,
          PNPM_INVOCATION: pnpmInvocation,
          NODE_AUTH_TOKEN: undefined,
          NPM_TOKEN: undefined,
        };
        const capture = spawnSync(
          'bash',
          ['-euo', 'pipefail', '-c', workflowRunStep('Preserve workflow-version publisher')],
          {
            cwd: checkout,
            encoding: 'utf-8',
            env,
          },
        );

        expect(capture.error).toBeUndefined();
        expect(capture.status).toBe(0);

        writeFileSync(
          path.join(checkout, 'bin/publish-npm'),
          '#!/usr/bin/env bash\nrm -rf dist\npnpm build\n',
        );

        const publication = spawnSync('bash', ['-euo', 'pipefail', '-c', workflowRunStep('Publish to NPM')], {
          cwd: checkout,
          encoding: 'utf-8',
          env,
        });
        const observations = readFileSync(npmObservations, 'utf-8')
          .trim()
          .split('\n')
          .map(
            (line) =>
              JSON.parse(line) as {
                args: string[];
                cwd: string;
                registry: string | null;
                registryToken: boolean;
              },
          );
        const publicationObservation = observations.find(({ args }) => args[0] === 'publish');

        expect(publication.error).toBeUndefined();
        expect(existsSync(pnpmInvocation)).toBe(false);
        expect(readFileSync(path.join(checkout, 'dist/verified-artifact'), 'utf-8')).toBe(
          'preserve verified bytes',
        );
        expect(observations.every(({ registryToken }) => !registryToken)).toBe(true);

        if (expectedTag === null) {
          expect(publication.status).toBe(1);
          expect(publication.stderr).toContain('does not match the checked-out release commit');
          expect(publicationObservation).toBeUndefined();
        } else {
          expect(publication.status).toBe(0);
          expect(publicationObservation).toEqual({
            args: ['publish', '--ignore-scripts', '--tag', expectedTag],
            cwd: realpathSync(path.join(checkout, 'dist')),
            registry: 'https://registry.npmjs.org',
            registryToken: false,
          });
        }
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    },
  );
});
