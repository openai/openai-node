import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { inspect } from 'node:util';
import { runInNewContext } from 'node:vm';

import { vi } from 'vitest';

const PRIVATE_VALUE = 'sk-runtime-private-fixture';
type PublicSurface = 'azure-provider' | 'public-workload';
const publicSurfaces: readonly PublicSurface[] = ['azure-provider', 'public-workload'];

async function importWithoutNativeErrorBrand() {
  vi.resetModules();
  const properties = [
    { target: Error, name: 'isError' },
    { target: process, name: 'getBuiltinModule' },
    { target: process, name: 'binding' },
  ];
  const descriptors = properties.map(({ target, name }) => Object.getOwnPropertyDescriptor(target, name));

  try {
    for (const { target, name } of properties) {
      Object.defineProperty(target, name, { configurable: true, value: undefined });
    }
    const [{ default: OpenAI, SubjectTokenProviderError }, { azureManagedIdentityTokenProvider }] =
      await Promise.all([import('openai'), import('openai/auth/subject-token-providers')]);
    return { OpenAI, SubjectTokenProviderError, azureManagedIdentityTokenProvider };
  } finally {
    for (const [index, { target, name }] of properties.entries()) {
      const descriptor = descriptors[index];
      if (descriptor) {
        Object.defineProperty(target, name, descriptor);
      } else {
        Reflect.deleteProperty(target, name);
      }
    }
  }
}

async function publicParserRejection(surface: PublicSurface, rejected: unknown) {
  const { OpenAI, SubjectTokenProviderError, azureManagedIdentityTokenProvider } =
    await importWithoutNativeErrorBrand();
  const response = new Response(null, { status: 200 });
  vi.spyOn(response, 'json').mockRejectedValue(rejected);
  const fetch = vi.fn(async () => response);

  if (surface === 'azure-provider') {
    const provider = azureManagedIdentityTokenProvider(undefined, { fetch });
    return { run: () => provider.getToken(), fetch, SubjectTokenProviderError };
  }

  const client = new OpenAI({
    apiKey: null,
    workloadIdentity: {
      identityProviderId: 'safe-identity-provider',
      serviceAccountId: 'safe-service-account',
      provider: { tokenType: 'jwt', getToken: async () => 'safe-external-subject-token' },
    },
    fetch,
    maxRetries: 0,
  });

  return { run: () => client.models.list(), fetch, SubjectTokenProviderError };
}

describe('malformed JSON runtime compatibility', () => {
  it.each(
    publicSurfaces.flatMap((surface) =>
      (['syntax error', 'parser wrapper', 'empty wrapper'] as const).flatMap((shape) =>
        (['native stack', 'without stack'] as const)
          .filter((stack) => shape !== 'empty wrapper' || stack === 'without stack')
          .map((stack) => ({ surface, shape, stack })),
      ),
    ),
  )(
    'sanitizes a tagged cross-realm $shape $stack through $surface without reading its tag',
    async ({ surface, shape, stack }) => {
      const expressions = {
        'syntax error': 'new SyntaxError(privateValue)',
        'empty wrapper':
          "Object.defineProperty(new Error(), 'cause', { value: new SyntaxError(privateValue) })",
        'parser wrapper':
          "Object.defineProperty(new Error(privateValue + ' parser wrapper'), 'cause', { value: new SyntaxError(privateValue) })",
      };
      const rejected = runInNewContext(expressions[shape], { privateValue: PRIVATE_VALUE }) as object;
      if (stack === 'without stack') {
        Reflect.deleteProperty(rejected, 'stack');
      }
      const readTag = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} appeared in an untrusted runtime-brand getter`);
      });
      const tagged = shape === 'syntax error' ? rejected : (Object.getPrototypeOf(rejected) as object);
      Object.defineProperty(tagged, Symbol.toStringTag, { configurable: true, get: readTag });

      const { run, fetch, SubjectTokenProviderError } = await publicParserRejection(surface, rejected);
      const failure: unknown = await run().catch((error: unknown) => error);
      const sanitized =
        surface === 'azure-provider' && failure instanceof SubjectTokenProviderError
          ? failure.cause
          : failure;
      expect(sanitized instanceof SyntaxError).toBe(true);
      expect(sanitized instanceof SyntaxError && sanitized.message).toBe(
        surface === 'azure-provider'
          ? 'IMDS response contains invalid JSON'
          : 'Token exchange response contains invalid JSON',
      );
      expect(inspect(failure, { depth: null })).not.toContain(PRIVATE_VALUE);
      expect(readTag).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(publicSurfaces)(
    'sanitizes a proxy-wrapped native parser error through %s without invoking its tag trap',
    async (surface) => {
      const readTag = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through a proxy-brand trap`);
      });
      const rejected = new Proxy(new SyntaxError(PRIVATE_VALUE), {
        get: (target, property, receiver) =>
          property === Symbol.toStringTag ? readTag() : Reflect.get(target, property, receiver),
      });
      const { run, SubjectTokenProviderError } = await publicParserRejection(surface, rejected);
      const failure: unknown = await run().catch((error: unknown) => error);
      const sanitized =
        surface === 'azure-provider' && failure instanceof SubjectTokenProviderError
          ? failure.cause
          : failure;

      expect(sanitized instanceof SyntaxError).toBe(true);
      expect(readTag).not.toHaveBeenCalled();
    },
  );

  it.each(['plain record', 'cross-realm prototype'] as const)(
    'preserves a forged $0 parser rejection without invoking its branding getter',
    async (shape) => {
      const rejected =
        shape === 'plain record'
          ? { message: 'safe custom parser rejection', stack: 'safe custom parser stack' }
          : (runInNewContext(
              "Object.assign(Object.create(SyntaxError.prototype), { type: 'invalid-json' })",
            ) as object);
      const readTag = vi.fn(() => 'Error');
      Object.defineProperty(rejected, Symbol.toStringTag, { configurable: true, get: readTag });

      const { run, fetch } = await publicParserRejection('public-workload', rejected);

      await expect(run()).rejects.toBe(rejected);
      expect(readTag).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('imports the public SDK without a deprecated process.binding fallback', () => {
    const repositoryRoot = process.cwd();
    const script = [
      "Object.defineProperty(process, 'getBuiltinModule', { configurable: true, value: undefined })",
      "require('openai')",
    ].join('; ');
    const result = spawnSync(
      process.execPath,
      [
        '--pending-deprecation',
        '--throw-deprecation',
        '--require',
        path.join(repositoryRoot, 'node_modules/ts-node/register/transpile-only.js'),
        '--require',
        path.join(repositoryRoot, 'node_modules/tsconfig-paths/register.js'),
        '--eval',
        script,
      ],
      { cwd: repositoryRoot, encoding: 'utf-8' },
    );

    expect(result.error).toBeUndefined();
    expect(result.status === 0 ? '' : result.stderr).toBe('');
    expect(result.stderr).not.toContain('DEP0111');
  });
});
