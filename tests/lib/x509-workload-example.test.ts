import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const example = readFileSync(
  path.resolve(process.cwd(), 'examples/mtls/x509-workload-identity.mjs'),
  'utf-8',
);
const exampleDocumentation = readFileSync(path.resolve(process.cwd(), 'examples/mtls/README.md'), 'utf-8');
const packageDocumentation = readFileSync(path.resolve(process.cwd(), 'README.md'), 'utf-8');
const packageScripts = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8')) as {
  scripts: Record<string, string>;
};
const mtlsBaseURLModule = path.resolve(process.cwd(), 'examples/mtls/base-url.mjs');

function runExample(environment: Record<string, string>) {
  return spawnSync(process.execPath, ['--input-type=module'], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    input: example,
    env: {
      PATH: process.env['PATH'],
      OPENAI_X509_CLIENT_CERTIFICATE_CHAIN_PEM: 'synthetic-certificate-chain',
      OPENAI_X509_CLIENT_PRIVATE_KEY_PEM: 'synthetic-private-key',
      ...environment,
    },
  });
}

describe('X.509 workload-identity runnable example', () => {
  test.each([
    'http://mtls.api.openai.com/v1',
    'https://attacker.example/v1',
    'https://mtls.api.openai.com.attacker.example/v1',
    'https://mtls.api.openai.com/v1?api_key=synthetic-secret',
  ])('rejects unsafe API-key mTLS example endpoint %s', async (configured) => {
    const { mtlsBaseURL } = (await import(mtlsBaseURLModule)) as {
      mtlsBaseURL: (configured: string) => string;
    };

    expect(() => mtlsBaseURL(configured)).toThrow(/documented.*HTTPS.*mTLS/iu);
  });

  test.each(['https://mtls.api.openai.com/v1', 'https://mtls-eu.api.openai.com/v1'])(
    'preserves documented API-key mTLS endpoint %s',
    async (configured) => {
      const { mtlsBaseURL } = (await import(mtlsBaseURLModule)) as {
        mtlsBaseURL: (configured: string) => string;
      };

      expect(mtlsBaseURL(configured)).toBe(configured);
    },
  );

  test('builds the SDK before running its clean-checkout live validation command', () => {
    expect(packageScripts.scripts['test:live:x509']).toMatch(/^pnpm build && node /u);
  });

  test('documents an Undici version compatible with the complete supported Node 22 range', () => {
    expect(exampleDocumentation.match(/npm install openai "undici@\^7"/gu)).toHaveLength(2);
  });

  test('builds repository self-imports before documenting the direct example command', () => {
    expect(exampleDocumentation).toMatch(/pnpm build\s+node examples\/mtls\/x509-workload-identity\.mjs/u);
  });

  test('preserves an explicitly empty encrypted-key passphrase', () => {
    expect(example).toContain('passphrase === undefined ? {} : { passphrase }');
    expect(readFileSync(path.resolve(process.cwd(), 'examples/mtls/node.mjs'), 'utf-8')).toContain(
      'passphrase === undefined ? {} : { passphrase }',
    );
  });

  test.each([
    ['runnable', example],
    ['documented', packageDocumentation],
  ])('keeps the %s X.509 example isolated from ambient credentials and routing', (_name, source) => {
    expect(source).toContain('workloadIdentity.fromX509');
    expect(source).toContain('credential,');
    expect(source).toContain("project: process.env['OPENAI_X509_PROJECT_ID'] ?? null");
  });

  test('never exposes credentials from a malformed CONNECT proxy URL', () => {
    const secret = 'synthetic-private-proxy-password';
    const result = runExample({
      OPENAI_X509_PROXY_MODE: 'http_connect',
      HTTPS_PROXY: `http://user:${secret}@[invalid`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('valid CONNECT proxy URL');
    expect(result.stderr).not.toContain(secret);
    expect(result.stdout).not.toContain(secret);
  });

  test('rejects a CONNECT proxy whose protocol does not match the explicitly selected mode', () => {
    const result = runExample({
      OPENAI_X509_PROXY_MODE: 'https_connect',
      HTTPS_PROXY: 'http://127.0.0.1:8080',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must match the HTTPS_PROXY protocol');
  });

  test('ignores ambient proxy settings unless a CONNECT proxy mode is explicitly requested', () => {
    const secret = 'synthetic-ignored-ambient-proxy-password';
    const result = runExample({ HTTPS_PROXY: `http://user:${secret}@[invalid` });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('OPENAI_X509_IDENTITY_PROVIDER_ID');
    expect(result.stderr).not.toContain(secret);
  });
});
