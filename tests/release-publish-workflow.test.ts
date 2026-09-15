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
const workflow = readFileSync(path.join(root, '.github/workflows/create-releases.yml'), 'utf-8');
const publishJob = workflow.split('\n  publish:\n')[1] ?? '';

function workflowRunStep(name: string): string {
  const [, step] = publishJob.split(`      - name: ${name}\n`);
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
        if (spawnSync('jq', ['--version']).status !== 0) {
          writeExecutable(
            path.join(executableDirectory, 'jq'),
            [
              "const fs = require('node:fs');",
              'const args = process.argv.slice(2);',
              "const expression = args.find((arg) => !arg.startsWith('-'));",
              'const filename = expression && args[args.indexOf(expression) + 1];',
              "const input = fs.readFileSync(filename || 0, 'utf-8');",
              'const value = JSON.parse(input);',
              'let output;',
              "if (expression === '.') output = value;",
              "else if (expression === '.name') output = value.name;",
              "else if (expression === '.version') output = value.version;",
              "else if (expression === '.error.code == \"E404\"') output = value?.error?.code === 'E404';",
              "else throw new Error('Unsupported jq expression: ' + expression);",
              "if (args.includes('-e') && (output === false || output == null)) process.exit(1);",
              "process.stdout.write(typeof output === 'string' && args.includes('-r') ? output : JSON.stringify(output));",
            ].join('\n'),
          );
        }

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
