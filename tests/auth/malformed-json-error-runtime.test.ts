import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { inspect, types } from 'node:util';
import { runInNewContext } from 'node:vm';

import { vi } from 'vitest';

const PRIVATE_VALUE = 'sk-runtime-private-fixture';
type PublicSurface = 'azure-provider' | 'public-workload';
type RuntimeErrorBrand = 'native intrinsics' | 'fallback' | 'fallback without structuredClone';
type ErrorBrandCandidate = (value: object) => boolean;
const publicSurfaces: readonly PublicSurface[] = ['azure-provider', 'public-workload'];
const runtimeErrorBrands: readonly RuntimeErrorBrand[] = ['native intrinsics', 'fallback'];
const proxyIntrinsicTest = typeof process.getBuiltinModule === 'function' ? it : it.skip;
const originalRuntimeLoader = Object.getOwnPropertyDescriptor(process, 'getBuiltinModule')?.value as
  | ((name: string) => unknown)
  | undefined;
const originalErrorBrand = Object.getOwnPropertyDescriptor(Error, 'isError')?.value as
  | ErrorBrandCandidate
  | undefined;

const errorBrandProbe = {
  isError(_value: object): boolean {
    return false;
  },
};
const runtimeLoaderProbe = {
  getBuiltinModule(_name: string): unknown {
    return undefined;
  },
};
const spoofableBoundRuntimeLoaderTest =
  typeof originalRuntimeLoader === 'function' &&
  Function.prototype.toString.call(originalRuntimeLoader) ===
    Function.prototype.toString.call(Function.prototype.bind.call(runtimeLoaderProbe.getBuiltinModule, null))
    ? it
    : it.skip;
const sourceIdenticalRuntimeLoaderTest =
  typeof originalRuntimeLoader === 'function' &&
  !Function.prototype.toString.call(originalRuntimeLoader).includes('[native code]')
    ? it
    : it.skip;
const boundErrorBrandSource = Function.prototype.toString.call(
  Function.prototype.bind.call(errorBrandProbe.isError, null),
);
const spoofableBoundErrorBrandTest =
  typeof originalErrorBrand === 'function' &&
  Function.prototype.toString.call(originalErrorBrand) === boundErrorBrandSource
    ? it
    : it.skip;
const authenticatedGlobalErrorBrandTest =
  typeof originalErrorBrand === 'function' &&
  Function.prototype.toString.call(originalErrorBrand) !== boundErrorBrandSource
    ? it
    : it.skip;

async function importPublicSDK() {
  const [{ default: OpenAI, SubjectTokenProviderError }, { azureManagedIdentityTokenProvider }] =
    await Promise.all([import('openai'), import('openai/auth/subject-token-providers')]);
  return { OpenAI, SubjectTokenProviderError, azureManagedIdentityTokenProvider };
}

async function withPatchedRuntimeIntrinsic<T>(
  target: object,
  property: string,
  replacement: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(target, property);
  Object.defineProperty(target, property, { configurable: true, value: replacement, writable: true });

  try {
    return await run();
  } finally {
    if (original) {
      Object.defineProperty(target, property, original);
    } else {
      Reflect.deleteProperty(target, property);
    }
  }
}

async function capturePatchedRuntimeIntrinsic(
  target: object,
  property: string,
  replacement: unknown,
): Promise<void> {
  vi.resetModules();
  await withPatchedRuntimeIntrinsic(target, property, replacement, async () => {
    await import('../../src/internal/auth/malformed-json-error');
  });
}

async function importWithoutNativeErrorBrand(
  withoutStructuredClone = false,
  structuredClonePolyfill?: (value: object) => unknown,
  errorBrandPolyfill?: ErrorBrandCandidate,
  preserveRuntimeIntrinsics = false,
) {
  vi.resetModules();
  const properties: { target: object; name: string }[] = [{ target: Error, name: 'isError' }];
  if (!preserveRuntimeIntrinsics) {
    properties.push({ target: process, name: 'getBuiltinModule' }, { target: process, name: 'binding' });
  }
  if (withoutStructuredClone || structuredClonePolyfill) {
    properties.push({ target: globalThis, name: 'structuredClone' });
  }
  const descriptors = properties.map(({ target, name }) => Object.getOwnPropertyDescriptor(target, name));

  try {
    for (const { target, name } of properties) {
      let replacement: unknown;
      if (name === 'structuredClone') {
        replacement = structuredClonePolyfill;
      }
      if (name === 'isError') {
        replacement = errorBrandPolyfill;
      }
      Object.defineProperty(target, name, {
        configurable: true,
        value: replacement,
      });
    }
    return await importPublicSDK();
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

async function publicParserRejection(
  surface: PublicSurface,
  rejected: unknown,
  runtimeErrorBrand: RuntimeErrorBrand = 'fallback',
  structuredClonePolyfill?: (value: object) => unknown,
  errorBrandPolyfill?: ErrorBrandCandidate,
  preserveRuntimeIntrinsics = false,
  preserveImportedModules = false,
) {
  if (runtimeErrorBrand === 'native intrinsics' && !preserveImportedModules) {
    vi.resetModules();
  }
  const { OpenAI, SubjectTokenProviderError, azureManagedIdentityTokenProvider } =
    runtimeErrorBrand === 'native intrinsics'
      ? await importPublicSDK()
      : await importWithoutNativeErrorBrand(
          runtimeErrorBrand === 'fallback without structuredClone',
          structuredClonePolyfill,
          errorBrandPolyfill,
          preserveRuntimeIntrinsics,
        );
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

async function expectOriginalPublicFailure(
  surface: PublicSurface,
  rejected: object,
  runtimeErrorBrand: RuntimeErrorBrand,
  errorBrandPolyfill?: ErrorBrandCandidate,
  preserveRuntimeIntrinsics = false,
  preserveImportedModules = false,
) {
  const { run, fetch, SubjectTokenProviderError } = await publicParserRejection(
    surface,
    rejected,
    runtimeErrorBrand,
    undefined,
    errorBrandPolyfill,
    preserveRuntimeIntrinsics,
    preserveImportedModules,
  );
  let failure: unknown;
  try {
    await run();
  } catch (error) {
    failure = error;
  }

  if (surface === 'azure-provider') {
    expect(failure).toBeInstanceOf(SubjectTokenProviderError);
    if (!(failure instanceof SubjectTokenProviderError)) {
      throw new Error('The public Azure provider did not preserve its custom parser failure.');
    }
    expect(failure.cause === (rejected instanceof Error ? rejected : undefined)).toBe(true);
  } else {
    expect(failure === rejected).toBe(true);
  }

  expect(fetch).toHaveBeenCalledTimes(1);
}

async function expectSanitizedPublicFailure(
  surface: PublicSurface,
  rejected: object,
  runtimeErrorBrand: RuntimeErrorBrand,
  structuredClonePolyfill?: (value: object) => unknown,
  errorBrandPolyfill?: ErrorBrandCandidate,
  preserveRuntimeIntrinsics = false,
  preserveImportedModules = false,
) {
  const { run, fetch, SubjectTokenProviderError } = await publicParserRejection(
    surface,
    rejected,
    runtimeErrorBrand,
    structuredClonePolyfill,
    errorBrandPolyfill,
    preserveRuntimeIntrinsics,
    preserveImportedModules,
  );
  let failure: unknown;
  try {
    await run();
  } catch (error) {
    failure = error;
  }
  const sanitized =
    surface === 'azure-provider' && failure instanceof SubjectTokenProviderError ? failure.cause : failure;

  expect(sanitized instanceof SyntaxError).toBe(true);
  expect(sanitized && Object.getOwnPropertyDescriptor(sanitized, 'message')?.value).toBe(
    surface === 'azure-provider'
      ? 'IMDS response contains invalid JSON'
      : 'Token exchange response contains invalid JSON',
  );
  expect(inspect(failure, { depth: null })).not.toContain(PRIVATE_VALUE);
  expect(fetch).toHaveBeenCalledTimes(1);
}

async function withNativeCloneFailureMessage<T>(message: string, run: () => Promise<T>): Promise<T> {
  const originalName = Object.getOwnPropertyDescriptor(DOMException.prototype, 'name');
  const originalMessage = Object.getOwnPropertyDescriptor(DOMException.prototype, 'message');
  if (!originalName?.get || !originalMessage?.get) {
    throw new Error('Expected native DOMException diagnostic accessors.');
  }

  const getName = originalName.get;
  const getMessage = originalMessage.get;
  Object.defineProperty(DOMException.prototype, 'message', {
    ...originalMessage,
    get(this: object) {
      return getName.call(this) === 'DataCloneError' ? message : getMessage.call(this);
    },
  });

  try {
    return await run();
  } finally {
    Object.defineProperty(DOMException.prototype, 'message', originalMessage);
  }
}

async function withoutCustomStackFormatter<T>(run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
  Object.defineProperty(Error, 'prepareStackTrace', { configurable: true, value: undefined, writable: true });
  try {
    return await run();
  } finally {
    if (original) {
      Object.defineProperty(Error, 'prepareStackTrace', original);
    } else {
      Reflect.deleteProperty(Error, 'prepareStackTrace');
    }
  }
}

function nativeCloneFailureMessage(value: object): string {
  try {
    structuredClone(value);
  } catch (error) {
    if (!(error instanceof DOMException)) {
      throw error;
    }
    expect(error.name).toBe('DataCloneError');
    return error.message;
  }
  throw new Error('Expected native structured cloning to reject an error proxy.');
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

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.map((surface) => ({ runtimeErrorBrand, surface })),
    ),
  )(
    'sanitizes a stack-only native parser proxy through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface }) => {
      const parserFailure = new SyntaxError(PRIVATE_VALUE);
      expect(parserFailure.stack).toContain(PRIVATE_VALUE);
      expect(Reflect.deleteProperty(parserFailure, 'message')).toBe(true);

      const readProxy = vi.fn((_target: SyntaxError, property: PropertyKey) => {
        throw new Error(`${PRIVATE_VALUE} escaped through the ${String(property)} stack-only parser getter`);
      });
      const rejected = new Proxy(parserFailure, { get: readProxy });

      await expectSanitizedPublicFailure(surface, rejected, runtimeErrorBrand);
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    [...runtimeErrorBrands, 'fallback without structuredClone' as const].flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['Error', 'TypeError'] as const).flatMap((constructor) =>
          (['direct', 'nested'] as const).map((placement) => ({
            runtimeErrorBrand,
            surface,
            constructor,
            placement,
          })),
        ),
      ),
    ),
  )(
    'sanitizes a $placement $constructor proxy concealing a native parser cause through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, constructor, placement }) => {
      const target =
        constructor === 'Error'
          ? new Error('safe custom response body parser wrapper')
          : new TypeError('safe custom response body parser wrapper');
      Object.defineProperty(target, 'cause', {
        configurable: true,
        value: new SyntaxError(PRIVATE_VALUE),
      });
      const readHook = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through a concealed parser cause hook`);
      });
      Object.defineProperties(target, {
        toJSON: { configurable: true, get: readHook },
        [Symbol.toStringTag]: { configurable: true, get: readHook },
      });
      const readProxy = vi.fn((_target: Error, property: PropertyKey) => {
        throw new Error(
          `${PRIVATE_VALUE} escaped through the ${String(property)} concealed parser cause getter`,
        );
      });
      const proxy = new Proxy(target, {
        get: readProxy,
        getOwnPropertyDescriptor(value, property) {
          return property === 'cause' ? undefined : Reflect.getOwnPropertyDescriptor(value, property);
        },
      });
      const rejected =
        placement === 'direct'
          ? proxy
          : Object.defineProperty(new Error('safe custom outer response body parser wrapper'), 'cause', {
              configurable: true,
              value: proxy,
            });

      expect(Object.getOwnPropertyDescriptor(proxy, 'cause')).toBeUndefined();
      expect(Reflect.ownKeys(proxy)).toContain('cause');
      await expectSanitizedPublicFailure(surface, rejected, runtimeErrorBrand);
      expect(readHook).not.toHaveBeenCalled();
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    publicSurfaces.flatMap((surface) =>
      (['Error', 'TypeError'] as const).map((constructor) => ({ surface, constructor })),
    ),
  )(
    'preserves indistinguishable $constructor transport proxies with fully concealed causes through $surface',
    async ({ surface, constructor }) => {
      const readProxy = vi.fn((_target: Error, property: PropertyKey) => {
        throw new Error(
          `${PRIVATE_VALUE} escaped through the ${String(property)} fully concealed cause getter`,
        );
      });
      const createProxy = (concealCause: boolean): Error => {
        const target =
          constructor === 'Error'
            ? new Error('safe transport failure')
            : new TypeError('safe transport failure');
        Object.defineProperty(target, 'stack', {
          configurable: true,
          value: `${constructor}: safe transport failure`,
          writable: true,
        });
        if (concealCause) {
          Object.defineProperty(target, 'cause', {
            configurable: true,
            value: new SyntaxError(PRIVATE_VALUE),
          });
        }
        return new Proxy(target, {
          get: readProxy,
          getOwnPropertyDescriptor(value, property) {
            return property === 'cause' ? undefined : Reflect.getOwnPropertyDescriptor(value, property);
          },
          ownKeys(value) {
            return Reflect.ownKeys(value).filter((property) => property !== 'cause');
          },
          has(value, property) {
            return property === 'cause' ? false : Reflect.has(value, property);
          },
        });
      };
      const transport = createProxy(false);
      const concealed = createProxy(true);

      expect(Object.getPrototypeOf(transport)).toBe(Object.getPrototypeOf(concealed));
      expect(Reflect.ownKeys(transport)).toEqual(Reflect.ownKeys(concealed));
      expect(Object.getOwnPropertyDescriptors(transport)).toEqual(
        Object.getOwnPropertyDescriptors(concealed),
      );
      expect(Reflect.has(transport, 'cause')).toBe(false);
      expect(Reflect.has(concealed, 'cause')).toBe(false);
      expect(types.isNativeError(transport)).toBe(types.isNativeError(concealed));
      expect(types.isProxy(transport)).toBe(types.isProxy(concealed));
      expect(nativeCloneFailureMessage(transport)).toBe(nativeCloneFailureMessage(concealed));

      // No safe observation can distinguish these shapes while preserving transport identity.
      await expectOriginalPublicFailure(surface, transport, 'native intrinsics');
      await expectOriginalPublicFailure(surface, concealed, 'native intrinsics');
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    publicSurfaces.flatMap((surface) =>
      (['Error', 'SyntaxError'] as const).map((prototype) => ({ surface, prototype })),
    ),
  )(
    'rejects a pre-import process loader shim for a forged $prototype through $surface',
    async ({ surface, prototype }) => {
      const rejected = Object.create(
        prototype === 'Error' ? Error.prototype : SyntaxError.prototype,
      ) as object;
      Object.defineProperty(rejected, 'message', {
        configurable: true,
        value: 'safe custom parser rejection',
      });
      if (prototype === 'Error') {
        Object.defineProperty(rejected, 'type', {
          configurable: true,
          enumerable: true,
          value: 'invalid-json',
        });
      }

      const fakeBrand = vi.fn((value: object) => value instanceof Error);
      const fakeLoader = vi.fn(() => ({ types: { isNativeError: fakeBrand, isProxy: () => false } }));

      await capturePatchedRuntimeIntrinsic(process, 'getBuiltinModule', fakeLoader);
      await expectOriginalPublicFailure(surface, rejected, 'native intrinsics', undefined, false, true);
      expect(fakeLoader).not.toHaveBeenCalled();
      expect(fakeBrand).not.toHaveBeenCalled();
    },
  );

  it.each(publicSurfaces)(
    'rejects a callable-proxy process loader without invoking its traps through %s',
    async (surface) => {
      const readLoader = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an untrusted process loader trap`);
      });
      const fakeLoader = new Proxy(() => null, { apply: readLoader, get: readLoader });
      const readRejection = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an untrusted parser rejection getter`);
      });
      const rejected = new Proxy(new SyntaxError(PRIVATE_VALUE), { get: readRejection });

      await capturePatchedRuntimeIntrinsic(process, 'getBuiltinModule', fakeLoader);
      await expectSanitizedPublicFailure(
        surface,
        rejected,
        'native intrinsics',
        undefined,
        undefined,
        false,
        true,
      );
      expect(readLoader).not.toHaveBeenCalled();
      expect(readRejection).not.toHaveBeenCalled();
    },
  );

  sourceIdenticalRuntimeLoaderTest.each(publicSurfaces)(
    'rejects fake error predicates behind a source-identical JavaScript process loader through %s',
    async (surface) => {
      if (!originalRuntimeLoader) {
        throw new Error('The source-identical loader fixture requires a native runtime loader.');
      }

      const rejected = Object.create(Error.prototype) as object;
      Object.defineProperties(rejected, {
        message: { configurable: true, value: 'safe custom parser rejection' },
        type: { configurable: true, enumerable: true, value: 'invalid-json' },
      });
      const fakeBrand = vi.fn((value: object) => value instanceof Error);
      const validateString = vi.fn((_id: string, _name: string) => null);
      const BuiltinModule = { normalizeRequirableId: (id: string): string => id };
      const require = vi.fn((_id: string) => ({
        types: { isNativeError: fakeBrand, isProxy: () => false },
      }));
      const getBuiltinModule = runInNewContext(
        `(${Function.prototype.toString.call(originalRuntimeLoader)})`,
        { validateString, BuiltinModule, require },
      ) as (id: string) => unknown;

      expect(Function.prototype.toString.call(getBuiltinModule)).toBe(
        Function.prototype.toString.call(originalRuntimeLoader),
      );
      await capturePatchedRuntimeIntrinsic(process, 'getBuiltinModule', getBuiltinModule);
      await expectOriginalPublicFailure(surface, rejected, 'native intrinsics', undefined, false, true);
      expect(validateString).toHaveBeenCalledTimes(1);
      expect(require).toHaveBeenCalledWith('node:util');
      expect(fakeBrand).not.toHaveBeenCalled();
    },
  );

  spoofableBoundRuntimeLoaderTest.each(publicSurfaces)(
    'rejects fake error predicates behind a source-identical bound process loader through %s',
    async (surface) => {
      if (!originalRuntimeLoader) {
        throw new Error('The bound process loader fixture requires a native runtime loader.');
      }

      const readRejection = vi.fn((_target: SyntaxError, property: PropertyKey) => {
        throw new Error(`${PRIVATE_VALUE} escaped through the ${String(property)} bound-loader getter`);
      });
      const rejected = new Proxy(new SyntaxError(PRIVATE_VALUE), { get: readRejection });
      const fakeBrand = vi.fn((value: object) => Reflect.get(value, 'privateDiagnostic') === true);
      const fakeLoaders = {
        getBuiltinModule(_name: string) {
          return { types: { isNativeError: fakeBrand, isProxy: fakeBrand } };
        },
      };
      const spoof = Function.prototype.bind.call(fakeLoaders.getBuiltinModule, null);
      for (const property of ['name', 'length'] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(originalRuntimeLoader, property);
        if (descriptor) {
          Object.defineProperty(spoof, property, descriptor);
        }
      }

      expect(Function.prototype.toString.call(spoof)).toBe(
        Function.prototype.toString.call(originalRuntimeLoader),
      );
      await capturePatchedRuntimeIntrinsic(process, 'getBuiltinModule', spoof);
      await expectSanitizedPublicFailure(
        surface,
        rejected,
        'native intrinsics',
        undefined,
        undefined,
        false,
        true,
      );
      expect(fakeBrand).not.toHaveBeenCalled();
      expect(readRejection).not.toHaveBeenCalled();
    },
  );

  proxyIntrinsicTest.each(
    publicSurfaces.flatMap((surface) =>
      (['Error', 'SyntaxError'] as const).map((prototype) => ({ surface, prototype })),
    ),
  )(
    'rejects a pre-import instanceof util native-error brand for a forged $prototype through $surface',
    async ({ surface, prototype }) => {
      const rejected = Object.create(
        prototype === 'Error' ? Error.prototype : SyntaxError.prototype,
      ) as object;
      Object.defineProperty(rejected, 'message', {
        configurable: true,
        value: 'safe custom parser rejection',
      });
      if (prototype === 'Error') {
        Object.defineProperty(rejected, 'type', {
          configurable: true,
          enumerable: true,
          value: 'invalid-json',
        });
      }
      const fakeBrand = vi.fn((value: object) => value instanceof Error);

      await capturePatchedRuntimeIntrinsic(types, 'isNativeError', fakeBrand);
      await expectOriginalPublicFailure(surface, rejected, 'native intrinsics', undefined, false, true);
      expect(fakeBrand).not.toHaveBeenCalled();
    },
  );

  proxyIntrinsicTest.each(publicSurfaces)(
    'rejects simultaneous runtime and global error-brand replacements without reading a hostile %s rejection',
    async (surface) => {
      const readRejection = vi.fn((_target: SyntaxError, property: PropertyKey) => {
        throw new Error(`${PRIVATE_VALUE} escaped through the ${String(property)} combined-brand getter`);
      });
      const rejected = new Proxy(new SyntaxError(PRIVATE_VALUE), { get: readRejection });
      const fakeBrand = vi.fn((value: object) => Reflect.get(value, 'privateDiagnostic') === true);

      vi.resetModules();
      await withPatchedRuntimeIntrinsic(types, 'isNativeError', fakeBrand, async () => {
        await withPatchedRuntimeIntrinsic(types, 'isProxy', fakeBrand, async () => {
          await withPatchedRuntimeIntrinsic(Error, 'isError', fakeBrand, async () => {
            await import('../../src/internal/auth/malformed-json-error');
          });
        });
      });
      await expectSanitizedPublicFailure(
        surface,
        rejected,
        'native intrinsics',
        undefined,
        undefined,
        false,
        true,
      );
      expect(fakeBrand).not.toHaveBeenCalled();
      expect(readRejection).not.toHaveBeenCalled();
    },
  );

  proxyIntrinsicTest.each(
    publicSurfaces.flatMap((surface) =>
      (['isNativeError', 'isProxy'] as const).flatMap((intrinsic) =>
        (['getter-reading function', 'callable proxy', 'constructible callable proxy'] as const).map(
          (candidate) => ({
            surface,
            intrinsic,
            candidate,
          }),
        ),
      ),
    ),
  )(
    'rejects a $candidate util $intrinsic replacement without invoking hostile hooks through $surface',
    async ({ surface, intrinsic, candidate }) => {
      const readRejection = vi.fn((_target: SyntaxError, property: PropertyKey) => {
        throw new Error(`${PRIVATE_VALUE} escaped through the ${String(property)} runtime-brand getter`);
      });
      const rejected = new Proxy(new SyntaxError(PRIVATE_VALUE), { get: readRejection });
      const invokeCandidate = vi.fn();
      const readCandidate = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an untrusted runtime callable proxy trap`);
      });
      function constructibleRuntimeIntrinsic(_value: object): boolean {
        invokeCandidate();
        return false;
      }
      const nonconstructibleRuntimeIntrinsic = (_value: object): boolean => {
        invokeCandidate();
        return false;
      };
      const replacement =
        candidate === 'getter-reading function'
          ? (value: object): boolean => {
              invokeCandidate();
              return Reflect.get(value, 'privateDiagnostic') === true;
            }
          : new Proxy(
              candidate === 'constructible callable proxy'
                ? constructibleRuntimeIntrinsic
                : nonconstructibleRuntimeIntrinsic,
              { apply: readCandidate, construct: readCandidate, get: readCandidate },
            );

      await capturePatchedRuntimeIntrinsic(types, intrinsic, replacement);
      await expectSanitizedPublicFailure(
        surface,
        rejected,
        'native intrinsics',
        undefined,
        undefined,
        false,
        true,
      );
      expect(invokeCandidate).not.toHaveBeenCalled();
      expect(readCandidate).not.toHaveBeenCalled();
      expect(readRejection).not.toHaveBeenCalled();
    },
  );

  proxyIntrinsicTest.each(
    publicSurfaces.flatMap((surface) =>
      (['isNativeError', 'isProxy'] as const).flatMap((intrinsic) =>
        (['nonconstructible', 'constructible'] as const).map((kind) => ({ surface, intrinsic, kind })),
      ),
    ),
  )(
    'rejects a $kind source-identical bound util $intrinsic spoof through $surface',
    async ({ surface, intrinsic, kind }) => {
      const original = Object.getOwnPropertyDescriptor(types, intrinsic)?.value as ErrorBrandCandidate;
      const readRejection = vi.fn((_target: SyntaxError, property: PropertyKey) => {
        throw new Error(`${PRIVATE_VALUE} escaped through the ${String(property)} bound-runtime getter`);
      });
      const rejected = new Proxy(new SyntaxError(PRIVATE_VALUE), { get: readRejection });
      const invokeSpoof = vi.fn((_value: object) => null);
      const candidates = {
        isNativeError(value: object): boolean {
          invokeSpoof(value);
          return value === rejected ? Reflect.get(value, 'privateDiagnostic') === true : original(value);
        },
        isProxy(value: object): boolean {
          invokeSpoof(value);
          return value === rejected ? Reflect.get(value, 'privateDiagnostic') === true : original(value);
        },
      };
      function isNativeError(value: object): boolean {
        return candidates.isNativeError(value);
      }
      function isProxy(value: object): boolean {
        return candidates.isProxy(value);
      }
      let unbound = candidates[intrinsic];
      if (kind === 'constructible') {
        unbound = intrinsic === 'isNativeError' ? isNativeError : isProxy;
      }
      const spoof = Function.prototype.bind.call(unbound, null) as ErrorBrandCandidate;
      for (const property of ['name', 'length'] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(original, property);
        if (descriptor) {
          Object.defineProperty(spoof, property, descriptor);
        }
      }

      expect(Function.prototype.toString.call(spoof)).toBe(Function.prototype.toString.call(original));
      await capturePatchedRuntimeIntrinsic(types, intrinsic, spoof);
      await expectSanitizedPublicFailure(
        surface,
        rejected,
        'native intrinsics',
        undefined,
        undefined,
        false,
        true,
      );
      expect(invokeSpoof.mock.calls.every(([value]) => value !== rejected)).toBe(true);
      if (kind === 'nonconstructible') {
        expect(invokeSpoof).not.toHaveBeenCalled();
      }
      expect(readRejection).not.toHaveBeenCalled();
    },
  );

  it.each(
    publicSurfaces.flatMap((surface) =>
      (['Error', 'SyntaxError'] as const).flatMap((prototype) =>
        (['without runtime intrinsics', 'with runtime intrinsics'] as const).map((runtime) => ({
          surface,
          prototype,
          runtime,
        })),
      ),
    ),
  )(
    'rejects an instanceof Error.isError polyfill for a forged $prototype through $surface $runtime',
    async ({ surface, prototype, runtime }) => {
      const rejected = Object.create(
        prototype === 'Error' ? Error.prototype : SyntaxError.prototype,
      ) as object;
      Object.defineProperty(rejected, 'message', {
        configurable: true,
        value: 'safe custom parser rejection',
      });
      if (prototype === 'Error') {
        Object.defineProperty(rejected, 'type', {
          configurable: true,
          enumerable: true,
          value: 'invalid-json',
        });
      }
      const polyfill = vi.fn((value: object) => value instanceof Error);

      await expectOriginalPublicFailure(
        surface,
        rejected,
        'fallback',
        polyfill,
        runtime === 'with runtime intrinsics',
      );
      expect(polyfill).not.toHaveBeenCalled();
    },
  );

  authenticatedGlobalErrorBrandTest.each(
    publicSurfaces.flatMap((surface) =>
      (['cross-realm SyntaxError', 'forged Error', 'hostile parser proxy'] as const).map((shape) => ({
        surface,
        shape,
      })),
    ),
  )(
    'uses an authenticated native Error.isError for $shape through $surface without runtime intrinsics',
    async ({ surface, shape }) => {
      if (!originalErrorBrand) {
        throw new Error('The authenticated Error.isError fixture requires a native intrinsic.');
      }
      const readProxy = vi.fn((_target: SyntaxError, property: PropertyKey) => {
        throw new Error(
          `${PRIVATE_VALUE} escaped through the ${String(property)} authenticated branding getter`,
        );
      });
      let rejected: object;
      if (shape === 'cross-realm SyntaxError') {
        rejected = runInNewContext('new SyntaxError(privateValue)', {
          privateValue: PRIVATE_VALUE,
        }) as object;
      } else if (shape === 'hostile parser proxy') {
        rejected = new Proxy(new SyntaxError(PRIVATE_VALUE), { get: readProxy });
      } else {
        rejected = Object.create(Error.prototype) as object;
        Object.defineProperties(rejected, {
          message: { configurable: true, value: 'safe custom parser rejection' },
          type: { configurable: true, enumerable: true, value: 'invalid-json' },
        });
      }

      await (shape === 'forged Error'
        ? expectOriginalPublicFailure(surface, rejected, 'fallback', originalErrorBrand)
        : expectSanitizedPublicFailure(surface, rejected, 'fallback', undefined, originalErrorBrand));
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    publicSurfaces.flatMap((surface) =>
      (['getter-reading function', 'callable proxy'] as const).map((candidate) => ({ surface, candidate })),
    ),
  )(
    'rejects a $candidate Error.isError replacement without invoking hostile hooks through $surface',
    async ({ surface, candidate }) => {
      const readProxy = vi.fn((_target: SyntaxError, property: PropertyKey) => {
        throw new Error(`${PRIVATE_VALUE} escaped through the ${String(property)} untrusted branding getter`);
      });
      const rejected = new Proxy(new SyntaxError(PRIVATE_VALUE), { get: readProxy });
      const invokeCandidate = vi.fn();
      const readCandidate = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an untrusted callable proxy trap`);
      });
      const brand =
        candidate === 'getter-reading function'
          ? (value: object): boolean => {
              invokeCandidate();
              return Reflect.get(value, 'privateDiagnostic') === true;
            }
          : new Proxy(
              (_value: object): boolean => {
                invokeCandidate();
                return false;
              },
              { apply: readCandidate, get: readCandidate },
            );

      await expectSanitizedPublicFailure(surface, rejected, 'fallback', undefined, brand);
      expect(invokeCandidate).not.toHaveBeenCalled();
      expect(readCandidate).not.toHaveBeenCalled();
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  spoofableBoundErrorBrandTest.each(
    publicSurfaces.flatMap((surface) =>
      (['without runtime intrinsics', 'with runtime intrinsics'] as const).map((runtime) => ({
        surface,
        runtime,
      })),
    ),
  )(
    'rejects a native-looking bound Error.isError spoof through $surface $runtime',
    async ({ surface, runtime }) => {
      if (!originalErrorBrand) {
        throw new Error('The native-looking bound Error.isError fixture requires a native intrinsic.');
      }
      const trustedErrorBrand = originalErrorBrand;
      const readProxy = vi.fn((_target: SyntaxError, property: PropertyKey) => {
        throw new Error(`${PRIVATE_VALUE} escaped through the ${String(property)} bound branding getter`);
      });
      const rejected = new Proxy(new SyntaxError(PRIVATE_VALUE), { get: readProxy });
      const invokeSpoof = vi.fn();
      function isError(value: object): boolean {
        invokeSpoof();
        return value === rejected
          ? Reflect.get(value, 'privateDiagnostic') === true
          : trustedErrorBrand(value);
      }
      const spoof = Function.prototype.bind.call(isError, null) as ErrorBrandCandidate;
      Object.defineProperty(spoof, 'name', { configurable: true, value: 'isError' });

      expect(Function.prototype.toString.call(spoof)).toBe(
        Function.prototype.toString.call(originalErrorBrand),
      );
      await expectSanitizedPublicFailure(
        surface,
        rejected,
        'fallback',
        undefined,
        spoof,
        runtime === 'with runtime intrinsics',
      );
      expect(invokeSpoof).not.toHaveBeenCalled();
      expect(readProxy).not.toHaveBeenCalled();
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

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['same-realm', 'cross-realm'] as const).flatMap((realm) =>
          (['Error', 'SyntaxError'] as const).map((prototype) => ({
            runtimeErrorBrand,
            surface,
            realm,
            prototype,
          })),
        ),
      ),
    ),
  )(
    'preserves a forged $realm $prototype with a non-enumerable message through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, realm, prototype }) => {
      const forged =
        realm === 'same-realm'
          ? (Object.create(prototype === 'Error' ? Error.prototype : SyntaxError.prototype) as object)
          : (runInNewContext(`Object.create(${prototype}.prototype)`) as object);
      Object.defineProperty(forged, 'message', {
        configurable: true,
        value: 'safe custom parser rejection',
        writable: true,
      });
      if (prototype === 'Error') {
        Object.defineProperty(forged, 'type', {
          configurable: true,
          enumerable: true,
          value: 'invalid-json',
        });
      }

      const rejected =
        realm === 'cross-realm' && surface === 'azure-provider'
          ? Object.defineProperty(new Error('safe cross-realm custom parser wrapper'), 'cause', {
              configurable: true,
              value: forged,
            })
          : forged;

      await expectOriginalPublicFailure(surface, rejected, runtimeErrorBrand);
    },
  );

  it.each(
    publicSurfaces.flatMap((surface) =>
      (
        [
          'plain object',
          'nested plain object',
          'TypeError',
          'cyclic object',
          'cyclic TypeError',
          'non-enumerable getter',
          'transparent proxy',
        ] as const
      ).map((cause) => ({ surface, cause })),
    ),
  )(
    'preserves a forged Error with a benign $cause cause through $surface without native branding',
    async ({ surface, cause }) => {
      const readHook = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an untrusted ${cause} cause getter`);
      });
      let nested: object;
      if (cause === 'TypeError' || cause === 'cyclic TypeError') {
        nested = new TypeError('safe transport cause');
      } else if (cause === 'transparent proxy') {
        nested = new Proxy({ detail: 'safe transport cause' }, { get: readHook });
      } else {
        nested = { detail: 'safe transport cause' };
      }
      if (cause === 'nested plain object') {
        Object.defineProperty(nested, 'nested', {
          configurable: true,
          enumerable: true,
          value: { detail: 'safe nested transport cause' },
        });
      }
      if (cause === 'cyclic object') {
        Object.defineProperty(nested, 'self', { configurable: true, enumerable: true, value: nested });
      }
      if (cause === 'cyclic TypeError') {
        Object.defineProperty(nested, 'cause', { configurable: true, value: nested });
      }
      if (cause === 'non-enumerable getter') {
        Object.defineProperty(nested, 'privateDiagnostic', { configurable: true, get: readHook });
      }

      const rejected = Object.create(Error.prototype) as object;
      Object.defineProperties(rejected, {
        message: { configurable: true, value: 'safe custom parser rejection' },
        type: { configurable: true, enumerable: true, value: 'invalid-json' },
        cause: { configurable: true, value: nested },
      });

      const verifyFailure = () => expectOriginalPublicFailure(surface, rejected, 'fallback');
      await (cause === 'TypeError' || cause === 'cyclic TypeError'
        ? withoutCustomStackFormatter(verifyFailure)
        : verifyFailure());
      expect(readHook).not.toHaveBeenCalled();
    },
  );

  it.each(
    publicSurfaces.flatMap((surface) =>
      (['forged record', 'stackless native parser wrapper'] as const).map((shape) => ({ surface, shape })),
    ),
  )(
    'never invokes a patched stack formatter while guarding a TypeError cause on $shape through $surface',
    async ({ surface, shape }) => {
      const nested = new TypeError('safe transport cause');
      const rejected =
        shape === 'forged record'
          ? (Object.create(Error.prototype) as object)
          : new Error('safe parser wrapper');
      Reflect.deleteProperty(rejected, 'stack');
      Object.defineProperties(rejected, {
        message: { configurable: true, value: 'safe custom parser rejection' },
        type: { configurable: true, enumerable: true, value: 'invalid-json' },
        cause: { configurable: true, value: nested },
      });
      const formatter = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an untrusted nested TypeError stack formatter`);
      });
      const original = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
      Object.defineProperty(Error, 'prepareStackTrace', {
        configurable: true,
        value: formatter,
        writable: true,
      });
      let failure: unknown;
      let SubjectTokenProviderError: Awaited<ReturnType<typeof importPublicSDK>>['SubjectTokenProviderError'];

      try {
        const operation = await publicParserRejection(surface, rejected, 'fallback');
        ({ SubjectTokenProviderError } = operation);
        try {
          await operation.run();
        } catch (error) {
          failure = error;
        }
      } finally {
        if (original) {
          Object.defineProperty(Error, 'prepareStackTrace', original);
        } else {
          Reflect.deleteProperty(Error, 'prepareStackTrace');
        }
      }

      const actual =
        surface === 'azure-provider' &&
        SubjectTokenProviderError &&
        failure instanceof SubjectTokenProviderError
          ? failure.cause
          : failure;
      const nestedStack = Object.getOwnPropertyDescriptor(nested, 'stack');
      if (shape === 'forged record' && nestedStack && 'value' in nestedStack) {
        expect(actual === rejected).toBe(true);
      } else {
        expect(actual instanceof SyntaxError).toBe(true);
        expect(actual && Object.getOwnPropertyDescriptor(actual, 'message')?.value).toBe(
          surface === 'azure-provider'
            ? 'IMDS response contains invalid JSON'
            : 'Token exchange response contains invalid JSON',
        );
      }
      expect(formatter).not.toHaveBeenCalled();
    },
  );

  it.each(publicSurfaces)(
    'fails closed for an enumerable accessor inside an unverified Error cause through %s',
    async (surface) => {
      const readHook = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an enumerable nested cause getter`);
      });
      const nested = Object.defineProperty({}, 'privateDiagnostic', {
        configurable: true,
        enumerable: true,
        get: readHook,
      });
      const rejected = Object.create(Error.prototype) as object;
      Object.defineProperties(rejected, {
        message: { configurable: true, value: 'safe custom parser rejection' },
        type: { configurable: true, enumerable: true, value: 'invalid-json' },
        cause: { configurable: true, value: nested },
      });

      await expectSanitizedPublicFailure(surface, rejected, 'fallback');
      expect(readHook).not.toHaveBeenCalled();
    },
  );

  it.each(publicSurfaces)(
    'bounds the total unverified object-valued cause graph through %s',
    async (surface) => {
      const root: { next?: object } = {};
      let current = root;
      for (let depth = 0; depth < 40; depth += 1) {
        const next: { next?: object } = {};
        current.next = next;
        current = next;
      }
      const readHook = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped beyond the bounded object-valued cause graph`);
      });
      Object.defineProperty(current, 'privateDiagnostic', {
        configurable: true,
        enumerable: true,
        get: readHook,
      });
      const rejected = Object.create(Error.prototype) as object;
      Object.defineProperties(rejected, {
        message: { configurable: true, value: 'safe custom parser rejection' },
        type: { configurable: true, enumerable: true, value: 'invalid-json' },
        cause: { configurable: true, value: root },
      });

      await expectSanitizedPublicFailure(surface, rejected, 'fallback');
      expect(readHook).not.toHaveBeenCalled();
    },
  );

  it.each(publicSurfaces)(
    'sanitizes a native parser cause nested under a TypeError without native branding through %s',
    async (surface) => {
      const nested = Object.defineProperty(new TypeError('safe transport wrapper'), 'cause', {
        configurable: true,
        value: new SyntaxError(PRIVATE_VALUE),
      });
      const rejected = Object.defineProperty(new Error('safe custom parser wrapper'), 'cause', {
        configurable: true,
        value: nested,
      });

      await expectSanitizedPublicFailure(surface, rejected, 'fallback');
    },
  );

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['Error', 'SyntaxError'] as const).map((prototype) => ({
          runtimeErrorBrand,
          surface,
          prototype,
        })),
      ),
    ),
  )(
    'preserves a forged $prototype with non-enumerable message and stack through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, prototype }) => {
      const rejected: object = Object.create(prototype === 'Error' ? Error.prototype : SyntaxError.prototype);
      Object.defineProperties(rejected, {
        message: { configurable: true, value: 'safe custom parser rejection', writable: true },
        stack: { configurable: true, value: 'safe custom parser stack', writable: true },
      });
      if (prototype === 'Error') {
        Object.defineProperty(rejected, 'type', { configurable: true, value: 'invalid-json' });
      }

      await expectOriginalPublicFailure(surface, rejected, runtimeErrorBrand);
    },
  );

  it.each(
    [...runtimeErrorBrands, 'fallback without structuredClone' as const].flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['same-realm', 'cross-realm'] as const).flatMap((realm) =>
          (['Error', 'SyntaxError'] as const).flatMap((prototype) =>
            (['bare', 'enumerable diagnostics', 'captured stack', 'copied native stack'] as const).flatMap(
              (diagnostics) =>
                (['direct', 'nested'] as const).map((placement) => ({
                  runtimeErrorBrand,
                  surface,
                  realm,
                  prototype,
                  diagnostics,
                  placement,
                })),
            ),
          ),
        ),
      ),
    ),
  )(
    'handles a $placement transparent forged $realm $prototype proxy with $diagnostics through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, realm, prototype, diagnostics, placement }) => {
      const target =
        realm === 'same-realm'
          ? (Object.create(prototype === 'Error' ? Error.prototype : SyntaxError.prototype) as object)
          : (runInNewContext(`Object.create(${prototype}.prototype)`) as object);
      if (diagnostics === 'enumerable diagnostics') {
        Object.defineProperties(target, {
          message: { configurable: true, enumerable: true, value: 'safe custom parser rejection' },
          stack: { configurable: true, enumerable: true, value: 'safe custom parser stack' },
        });
      } else if (diagnostics === 'captured stack') {
        Error.captureStackTrace(target);
      } else if (diagnostics === 'copied native stack') {
        const stack = Object.getOwnPropertyDescriptor(new Error('safe native stack fixture'), 'stack');
        if (!stack) {
          throw new Error('Expected a native Error stack descriptor.');
        }
        Object.defineProperty(target, 'stack', stack);
      }
      if (prototype === 'Error') {
        Object.defineProperty(target, 'type', {
          configurable: true,
          enumerable: true,
          value: 'invalid-json',
        });
      }

      const readHook = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an unbranded parser hook`);
      });
      Object.defineProperties(target, {
        toJSON: { configurable: true, get: readHook },
        [Symbol.toStringTag]: { configurable: true, get: readHook },
      });
      const readProxy = vi.fn((_target: object, property: PropertyKey) => {
        throw new Error(
          `${PRIVATE_VALUE} escaped through the ${String(property)} custom parser proxy getter`,
        );
      });
      const proxy = new Proxy(target, { get: readProxy });
      const rejected =
        placement === 'direct'
          ? proxy
          : Object.defineProperty(new Error('safe custom parser wrapper'), 'cause', {
              configurable: true,
              value: proxy,
            });

      const stack = Object.getOwnPropertyDescriptor(target, 'stack');
      const indistinguishableSyntaxStack =
        prototype === 'SyntaxError' &&
        (diagnostics === 'captured stack' || diagnostics === 'copied native stack') &&
        stack &&
        !('value' in stack) &&
        typeof stack.get === 'function' &&
        !(
          runtimeErrorBrand === 'native intrinsics' &&
          typeof process.getBuiltinModule === 'function' &&
          realm === 'cross-realm' &&
          diagnostics === 'copied native stack'
        );

      if (indistinguishableSyntaxStack) {
        expect(types.isNativeError(target)).toBe(false);
        await expectSanitizedPublicFailure(surface, rejected, runtimeErrorBrand);
      } else {
        await expectOriginalPublicFailure(surface, rejected, runtimeErrorBrand);
      }
      expect(readHook).not.toHaveBeenCalled();
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    [...runtimeErrorBrands, 'fallback without structuredClone' as const].flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['direct', 'nested'] as const).map((placement) => ({ runtimeErrorBrand, surface, placement })),
      ),
    ),
  )(
    'preserves a $placement forged proxy concealing its parser-like marker through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, placement }) => {
      const target = Object.create(Error.prototype) as object;
      Object.defineProperty(target, 'type', {
        configurable: true,
        enumerable: true,
        value: 'invalid-json',
      });
      const readProxy = vi.fn((_target: object, property: PropertyKey) => {
        throw new Error(
          `${PRIVATE_VALUE} escaped through the ${String(property)} forged marker proxy getter`,
        );
      });
      const proxy = new Proxy(target, {
        get: readProxy,
        getOwnPropertyDescriptor(value, property) {
          return property === 'type' ? undefined : Reflect.getOwnPropertyDescriptor(value, property);
        },
      });
      const rejected =
        placement === 'direct'
          ? proxy
          : Object.defineProperty(new Error('safe custom parser wrapper'), 'cause', {
              configurable: true,
              value: proxy,
            });

      await expectOriginalPublicFailure(surface, rejected, runtimeErrorBrand);
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    [...runtimeErrorBrands, 'fallback without structuredClone' as const].flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['direct', 'nested'] as const).map((placement) => ({ runtimeErrorBrand, surface, placement })),
      ),
    ),
  )(
    'sanitizes a $placement parser proxy hiding its descriptors through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, placement }) => {
      const readTag = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an untrusted parser tag getter`);
      });
      const readProxy = vi.fn((_target: SyntaxError, property: PropertyKey) => {
        throw new Error(`${PRIVATE_VALUE} escaped through the ${String(property)} parser proxy getter`);
      });
      const parserFailure = new SyntaxError(PRIVATE_VALUE);
      Object.defineProperty(parserFailure, Symbol.toStringTag, { configurable: true, get: readTag });
      const proxy = new Proxy(parserFailure, {
        get: readProxy,
        getOwnPropertyDescriptor(target, property) {
          return property === 'message' || property === 'stack'
            ? undefined
            : Reflect.getOwnPropertyDescriptor(target, property);
        },
      });
      const rejected =
        placement === 'direct'
          ? proxy
          : Object.defineProperty(
              new Error(`${PRIVATE_VALUE} escaped through a nested parser wrapper`),
              'cause',
              {
                configurable: true,
                value: proxy,
              },
            );

      await expectSanitizedPublicFailure(surface, rejected, runtimeErrorBrand);
      expect(readTag).not.toHaveBeenCalled();
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['same-realm', 'cross-realm'] as const).flatMap((realm) =>
          (['direct', 'nested'] as const).flatMap((placement) =>
            (['without marker', 'with concealed marker'] as const).map((marker) => ({
              runtimeErrorBrand,
              surface,
              realm,
              placement,
              marker,
            })),
          ),
        ),
      ),
    ),
  )(
    'sanitizes a $placement $realm parser proxy with fully concealed diagnostic keys $marker through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, realm, placement, marker }) => {
      const target =
        realm === 'same-realm'
          ? new SyntaxError(PRIVATE_VALUE)
          : (runInNewContext('new SyntaxError(privateValue)', {
              privateValue: PRIVATE_VALUE,
            }) as SyntaxError);
      if (marker === 'with concealed marker') {
        Object.defineProperty(target, 'type', { configurable: true, value: 'invalid-json' });
      }

      const readHook = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through a fully concealed parser hook`);
      });
      Object.defineProperties(target, {
        toJSON: { configurable: true, get: readHook },
        [Symbol.toStringTag]: { configurable: true, get: readHook },
      });
      const readProxy = vi.fn((_target: SyntaxError, property: PropertyKey) => {
        throw new Error(
          `${PRIVATE_VALUE} escaped through the ${String(property)} fully concealed parser getter`,
        );
      });
      const concealed = new Set<PropertyKey>(['message', 'stack', 'type']);
      const proxy = new Proxy(target, {
        get: readProxy,
        getOwnPropertyDescriptor(value, property) {
          return concealed.has(property) ? undefined : Reflect.getOwnPropertyDescriptor(value, property);
        },
        ownKeys(value) {
          return Reflect.ownKeys(value).filter((property) => !concealed.has(property));
        },
      });
      const rejected =
        placement === 'direct'
          ? proxy
          : Object.defineProperty(
              new Error(`${PRIVATE_VALUE} escaped through a nested parser wrapper`),
              'cause',
              {
                configurable: true,
                value: proxy,
              },
            );

      await expectSanitizedPublicFailure(surface, rejected, runtimeErrorBrand);
      expect(readHook).not.toHaveBeenCalled();
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    [...runtimeErrorBrands, 'fallback without structuredClone' as const].flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['Error', 'SyntaxError'] as const).flatMap((prototype) =>
          (['direct', 'nested'] as const).map((placement) => ({
            runtimeErrorBrand,
            surface,
            prototype,
            placement,
          })),
        ),
      ),
    ),
  )(
    'preserves a $placement fully concealed forged $prototype proxy through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, prototype, placement }) => {
      const target = Object.create(prototype === 'Error' ? Error.prototype : SyntaxError.prototype) as object;
      if (prototype === 'Error') {
        Object.defineProperty(target, 'type', { configurable: true, value: 'invalid-json' });
      }

      const readProxy = vi.fn((_target: object, property: PropertyKey) => {
        throw new Error(
          `${PRIVATE_VALUE} escaped through the ${String(property)} fully concealed forged getter`,
        );
      });
      const concealed = new Set<PropertyKey>(['message', 'stack', 'type']);
      const proxy = new Proxy(target, {
        get: readProxy,
        getOwnPropertyDescriptor(value, property) {
          return concealed.has(property) ? undefined : Reflect.getOwnPropertyDescriptor(value, property);
        },
        ownKeys(value) {
          return Reflect.ownKeys(value).filter((property) => !concealed.has(property));
        },
      });
      const rejected =
        placement === 'direct'
          ? proxy
          : Object.defineProperty(new Error('safe custom parser wrapper'), 'cause', {
              configurable: true,
              value: proxy,
            });

      await expectOriginalPublicFailure(surface, rejected, runtimeErrorBrand);
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['same-realm', 'cross-realm'] as const).flatMap((realm) =>
          (['direct', 'Error cause', 'TypeError cause'] as const).map((placement) => ({
            runtimeErrorBrand,
            surface,
            realm,
            placement,
          })),
        ),
      ),
    ),
  )(
    'sanitizes a $placement $realm native SyntaxError after prototype mutation through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, realm, placement }) => {
      const target =
        realm === 'same-realm'
          ? Object.setPrototypeOf(new SyntaxError(PRIVATE_VALUE), Error.prototype)
          : (runInNewContext('Object.setPrototypeOf(new SyntaxError(privateValue), Error.prototype)', {
              privateValue: PRIVATE_VALUE,
            }) as Error);
      Object.defineProperty(target, 'name', { configurable: true, value: 'SyntaxError' });
      const readHook = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through a mutated native parser hook`);
      });
      Object.defineProperties(target, {
        toJSON: { configurable: true, get: readHook },
        [Symbol.toStringTag]: { configurable: true, get: readHook },
      });
      const rejected =
        placement === 'direct'
          ? target
          : Object.defineProperty(
              placement === 'TypeError cause'
                ? new TypeError(`${PRIVATE_VALUE} escaped through a nested parser wrapper`)
                : new Error(`${PRIVATE_VALUE} escaped through a nested parser wrapper`),
              'cause',
              { configurable: true, value: target },
            );

      await expectSanitizedPublicFailure(surface, rejected, runtimeErrorBrand);
      expect(readHook).not.toHaveBeenCalled();
    },
  );

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['runtime-native', 'Bun-compatible'] as const).map((cloneDiagnostic) => ({
          runtimeErrorBrand,
          surface,
          cloneDiagnostic,
        })),
      ),
    ),
  )(
    'fails closed for indistinguishable custom-named transport and native parser proxies through $surface using $runtimeErrorBrand and a $cloneDiagnostic clone failure',
    async ({ runtimeErrorBrand, surface, cloneDiagnostic }) => {
      const readProxy = vi.fn((_target: Error, property: PropertyKey) => {
        throw new Error(
          `${PRIVATE_VALUE} escaped through the ${String(property)} custom-named parser proxy getter`,
        );
      });
      const createProxy = (constructor: ErrorConstructor | SyntaxErrorConstructor): Error => {
        const target = new constructor(PRIVATE_VALUE);
        Object.setPrototypeOf(target, Error.prototype);
        target.name = 'NetworkFailure';
        Object.defineProperty(target, 'stack', {
          configurable: true,
          value: `NetworkFailure: ${PRIVATE_VALUE}\n    at syntheticProxyFixture`,
          writable: true,
        });
        return new Proxy(target, { get: readProxy });
      };
      const transport = createProxy(Error);
      const parser = createProxy(SyntaxError);

      expect(Object.getPrototypeOf(transport)).toBe(Error.prototype);
      expect(Object.getPrototypeOf(parser)).toBe(Error.prototype);
      expect(Object.getOwnPropertyDescriptors(transport)).toEqual(Object.getOwnPropertyDescriptors(parser));
      expect(types.isNativeError(transport)).toBe(false);
      expect(types.isNativeError(parser)).toBe(false);
      expect(types.isProxy(transport)).toBe(true);
      expect(types.isProxy(parser)).toBe(true);
      expect(nativeCloneFailureMessage(transport)).toBe(nativeCloneFailureMessage(parser));

      const assertBothSanitized = async () => {
        await expectSanitizedPublicFailure(surface, parser, runtimeErrorBrand);
        await expectSanitizedPublicFailure(surface, transport, runtimeErrorBrand);
      };
      await (cloneDiagnostic === 'Bun-compatible'
        ? withNativeCloneFailureMessage('The object can not be cloned.', assertBothSanitized)
        : assertBothSanitized());
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['Error', 'TypeError'] as const).flatMap((constructor) =>
          (['direct', 'nested'] as const).map((placement) => ({
            runtimeErrorBrand,
            surface,
            constructor,
            placement,
          })),
        ),
      ),
    ),
  )(
    'preserves a $placement native $constructor renamed SyntaxError by assignment through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, constructor, placement }) => {
      const target =
        constructor === 'Error'
          ? new Error('safe custom parser transport failure')
          : new TypeError('safe custom parser transport failure');
      target.name = 'SyntaxError';
      const readHook = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through a renamed transport error hook`);
      });
      Object.defineProperties(target, {
        toJSON: { configurable: true, get: readHook },
        [Symbol.toStringTag]: { configurable: true, get: readHook },
      });
      const rejected =
        placement === 'direct'
          ? target
          : Object.defineProperty(new Error('safe custom parser transport wrapper'), 'cause', {
              configurable: true,
              value: target,
            });

      await expectOriginalPublicFailure(surface, rejected, runtimeErrorBrand);
      expect(readHook).not.toHaveBeenCalled();
    },
  );

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['same-realm', 'cross-realm'] as const).flatMap((realm) =>
          (['direct', 'nested'] as const).map((placement) => ({
            runtimeErrorBrand,
            surface,
            realm,
            placement,
          })),
        ),
      ),
    ),
  )(
    'preserves a $placement $realm native Error with a spoofed SyntaxError name through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, realm, placement }) => {
      const target =
        realm === 'same-realm'
          ? new Error('safe custom parser failure')
          : (runInNewContext("new Error('safe custom parser failure')") as Error);
      Object.defineProperty(target, 'name', { value: 'SyntaxError' });
      const rejected =
        placement === 'direct'
          ? target
          : Object.defineProperty(new Error('safe custom parser wrapper'), 'cause', {
              configurable: true,
              value: target,
            });

      await expectOriginalPublicFailure(surface, rejected, runtimeErrorBrand);
    },
  );

  it.each(
    [...runtimeErrorBrands, 'fallback without structuredClone' as const].flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['Error', 'TypeError'] as const).flatMap((constructor) =>
          (['type', 'type and message', 'type and stack'] as const).flatMap((concealed) =>
            (['direct', 'nested'] as const).map((placement) => ({
              runtimeErrorBrand,
              surface,
              constructor,
              concealed,
              placement,
            })),
          ),
        ),
      ),
    ),
  )(
    'sanitizes a $placement native $constructor parser proxy concealing $concealed through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, constructor, concealed, placement }) => {
      const target =
        constructor === 'Error'
          ? new Error(`invalid json response body reason: ${PRIVATE_VALUE}`)
          : new TypeError(`invalid json response body reason: ${PRIVATE_VALUE}`);
      Object.defineProperty(target, 'type', {
        configurable: true,
        enumerable: true,
        value: 'invalid-json',
      });
      const readHook = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through a concealed parser hook`);
      });
      Object.defineProperties(target, {
        toJSON: { configurable: true, get: readHook },
        [Symbol.toStringTag]: { configurable: true, get: readHook },
      });
      const readProxy = vi.fn((_target: Error, property: PropertyKey) => {
        throw new Error(
          `${PRIVATE_VALUE} escaped through the ${String(property)} concealed parser proxy getter`,
        );
      });
      const proxy = new Proxy(target, {
        get: readProxy,
        getOwnPropertyDescriptor(value, property) {
          return property === 'type' || concealed.endsWith(String(property))
            ? undefined
            : Reflect.getOwnPropertyDescriptor(value, property);
        },
      });
      const rejected =
        placement === 'direct'
          ? proxy
          : Object.defineProperty(
              new Error(`${PRIVATE_VALUE} escaped through a nested parser wrapper`),
              'cause',
              {
                configurable: true,
                value: proxy,
              },
            );

      await expectSanitizedPublicFailure(surface, rejected, runtimeErrorBrand);
      expect(readHook).not.toHaveBeenCalled();
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    [...runtimeErrorBrands, 'fallback without structuredClone' as const].flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['Error', 'TypeError'] as const).map((constructor) => ({ runtimeErrorBrand, surface, constructor })),
      ),
    ),
  )(
    'preserves a native $constructor transport proxy concealing unrelated metadata through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, constructor }) => {
      const target =
        constructor === 'Error'
          ? new Error('safe custom response body transport failure')
          : new TypeError('safe custom response body transport failure');
      Object.defineProperties(target, {
        type: { configurable: true, enumerable: true, value: 'system' },
        metadata: { configurable: true, enumerable: true, value: 'safe custom transport metadata' },
      });
      const readProxy = vi.fn((_target: Error, property: PropertyKey) => {
        throw new Error(`${PRIVATE_VALUE} escaped through the ${String(property)} transport proxy getter`);
      });
      const rejected = new Proxy(target, {
        get: readProxy,
        getOwnPropertyDescriptor(value, property) {
          return property === 'metadata' ? undefined : Reflect.getOwnPropertyDescriptor(value, property);
        },
      });

      await expectOriginalPublicFailure(surface, rejected, runtimeErrorBrand);
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['Error', 'Object'] as const).flatMap((prototype) =>
          (['direct', 'nested'] as const).flatMap((placement) =>
            (['visible', 'hidden'] as const).map((descriptors) => ({
              runtimeErrorBrand,
              surface,
              prototype,
              placement,
              descriptors,
            })),
          ),
        ),
      ),
    ),
  )(
    'sanitizes a $placement parser proxy behind the $prototype prototype with $descriptors descriptors through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, prototype, placement, descriptors }) => {
      const readProxy = vi.fn((_target: SyntaxError, property: PropertyKey) => {
        throw new Error(`${PRIVATE_VALUE} escaped through the ${String(property)} parser proxy getter`);
      });
      const parserFailure = new SyntaxError(PRIVATE_VALUE);
      if (runtimeErrorBrand === 'fallback' || typeof process.getBuiltinModule !== 'function') {
        Reflect.deleteProperty(parserFailure, 'stack');
      }
      const proxy = new Proxy(parserFailure, {
        get: readProxy,
        getPrototypeOf: () => (prototype === 'Error' ? Error.prototype : Object.prototype),
        getOwnPropertyDescriptor(target, property) {
          return descriptors === 'hidden' && (property === 'message' || property === 'stack')
            ? undefined
            : Reflect.getOwnPropertyDescriptor(target, property);
        },
      });
      const rejected =
        placement === 'direct'
          ? proxy
          : Object.defineProperty(
              new Error(`${PRIVATE_VALUE} escaped through a nested parser wrapper`),
              'cause',
              {
                configurable: true,
                value: proxy,
              },
            );

      await expectSanitizedPublicFailure(surface, rejected, runtimeErrorBrand);
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  proxyIntrinsicTest.each(
    publicSurfaces.flatMap((surface) =>
      (
        [
          'invalid-json Error marker',
          'invalid-json TypeError marker',
          'Error SyntaxError cause',
          'TypeError SyntaxError cause',
        ] as const
      ).map((shape) => ({ surface, shape })),
    ),
  )(
    'sanitizes a prototype-hiding proxy with an authentic $shape through $surface',
    async ({ surface, shape }) => {
      const target = shape.includes('TypeError')
        ? new TypeError(`${PRIVATE_VALUE} escaped through a parser wrapper`)
        : new Error(`${PRIVATE_VALUE} escaped through a parser wrapper`);
      const parserMarker = shape.startsWith('invalid-json ');
      Object.defineProperty(target, parserMarker ? 'type' : 'cause', {
        configurable: true,
        value: parserMarker ? 'invalid-json' : new SyntaxError(PRIVATE_VALUE),
      });
      const readProxy = vi.fn((_target: Error, property: PropertyKey) => {
        throw new Error(`${PRIVATE_VALUE} escaped through the ${String(property)} parser proxy getter`);
      });
      const rejected = new Proxy(target, {
        get: readProxy,
        getPrototypeOf: () => Object.prototype,
      });

      await expectSanitizedPublicFailure(surface, rejected, 'native intrinsics');
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  proxyIntrinsicTest.each(
    publicSurfaces.flatMap((surface) =>
      (['Error', 'TypeError', 'custom Error', 'DOMException', 'custom record'] as const).flatMap((shape) =>
        (['Error', 'Object'] as const).map((prototype) => ({ surface, shape, prototype })),
      ),
    ),
  )(
    'preserves a $shape transport proxy behind the $prototype prototype through $surface',
    async ({ surface, shape, prototype }) => {
      let target: object;
      if (shape === 'TypeError') {
        target = new TypeError('safe custom response body transport failure');
      } else if (shape === 'custom Error') {
        target = Object.defineProperty(new Error('safe custom response body transport failure'), 'name', {
          configurable: true,
          value: 'TransportError',
        });
      } else if (shape === 'DOMException') {
        target = new DOMException('safe custom response body cancellation', 'AbortError');
      } else if (shape === 'custom record') {
        target = Object.create(Error.prototype) as object;
        Object.defineProperties(target, {
          message: { configurable: true, value: 'safe custom parser record' },
          type: { configurable: true, value: 'system' },
        });
      } else {
        target = new Error('safe custom response body transport failure');
      }

      const readProxy = vi.fn((_target: object, property: PropertyKey) => {
        throw new Error(`${PRIVATE_VALUE} escaped through the ${String(property)} transport proxy getter`);
      });
      const rejected = new Proxy(target, {
        get: readProxy,
        getPrototypeOf: () => (prototype === 'Error' ? Error.prototype : Object.prototype),
      });

      await expectOriginalPublicFailure(surface, rejected, 'native intrinsics');
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  proxyIntrinsicTest.each(publicSurfaces)(
    'fails closed without invoking a concealed parser name getter through %s',
    async (surface) => {
      const readName = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through a concealed parser name getter`);
      });
      const target = new SyntaxError(PRIVATE_VALUE);
      Object.defineProperty(target, 'name', { configurable: true, get: readName });
      const rejected = new Proxy(target, { getPrototypeOf: () => Error.prototype });

      await expectSanitizedPublicFailure(surface, rejected, 'native intrinsics');
      expect(readName).not.toHaveBeenCalled();
    },
  );

  proxyIntrinsicTest.each(
    publicSurfaces.flatMap((surface) =>
      (['name', 'message'] as const).map((diagnostic) => ({ surface, diagnostic })),
    ),
  )(
    'never invokes a $diagnostic getter installed by a parser proxy on DOMException through $surface',
    async ({ surface, diagnostic }) => {
      const original = Object.getOwnPropertyDescriptor(DOMException.prototype, diagnostic);
      const read = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an untrusted clone-failure ${diagnostic} getter`);
      });
      const rejected = new Proxy(new SyntaxError(PRIVATE_VALUE), {
        getPrototypeOf() {
          Object.defineProperty(DOMException.prototype, diagnostic, { configurable: true, get: read });
          return Error.prototype;
        },
      });

      try {
        await expectSanitizedPublicFailure(surface, rejected, 'native intrinsics');
      } finally {
        if (original) {
          Object.defineProperty(DOMException.prototype, diagnostic, original);
        } else {
          Reflect.deleteProperty(DOMException.prototype, diagnostic);
        }
      }

      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each(
    publicSurfaces.flatMap((surface) =>
      (['JSON-based', 'user-installed', 'native-looking'] as const).map((polyfill) => ({
        surface,
        polyfill,
      })),
    ),
  )(
    'never passes a hostile parser error to a $polyfill structuredClone polyfill through $surface',
    async ({ surface, polyfill }) => {
      const read = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an untrusted ${polyfill} serialization getter`);
      });
      const rejected = new SyntaxError(PRIVATE_VALUE);
      Reflect.deleteProperty(rejected, 'stack');
      const property = polyfill === 'JSON-based' ? 'toJSON' : 'privateSerializationHook';
      Object.defineProperty(rejected, property, { configurable: true, get: read });

      const nativeClone = globalThis.structuredClone;
      const invokePolyfill = vi.fn();
      const clone =
        polyfill === 'native-looking'
          ? function structuredClone(value: object): unknown {
              invokePolyfill();
              const hook = Object.getOwnPropertyDescriptor(value, 'privateSerializationHook');
              if (hook && !('value' in hook) && hook.get) {
                return hook.get.call(value);
              }
              const nativeStructuredClone = nativeClone;
              const idlOptions = undefined;
              return nativeStructuredClone(value, idlOptions);
            }
          : vi.fn((value: object): unknown => {
              invokePolyfill();
              if (polyfill === 'JSON-based') {
                // oxlint-disable-next-line unicorn/prefer-structured-clone -- This security fixture models an unsafe JSON polyfill.
                return JSON.parse(JSON.stringify(value)) as unknown;
              }
              const hook = Object.getOwnPropertyDescriptor(value, 'privateSerializationHook');
              if (hook && !('value' in hook) && hook.get) {
                return hook.get.call(value);
              }
              return nativeClone(value);
            });

      await expectSanitizedPublicFailure(surface, rejected, 'fallback', clone);
      expect(read).not.toHaveBeenCalled();
      expect(invokePolyfill).not.toHaveBeenCalled();
    },
  );

  it.each(
    publicSurfaces.flatMap((surface) =>
      (
        [
          'own name',
          'inherited name',
          'own message',
          'inherited message',
          'own stack',
          'inherited stack',
          'own cause',
          'inherited cause',
          'own tag',
          'inherited tag',
        ] as const
      ).map((shape) => ({ surface, shape })),
    ),
  )(
    'never invokes a $shape parser getter through $surface without native intrinsics',
    async ({ surface, shape }) => {
      const read = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an untrusted ${shape} getter`);
      });
      const rejected = new SyntaxError(PRIVATE_VALUE);
      Reflect.deleteProperty(rejected, 'stack');
      const property = shape.endsWith('tag')
        ? Symbol.toStringTag
        : shape.slice(shape.startsWith('inherited ') ? 'inherited '.length : 'own '.length);
      if (shape.startsWith('inherited ')) {
        const prototype: object = Object.create(SyntaxError.prototype);
        Object.defineProperty(prototype, property, { configurable: true, get: read });
        Object.setPrototypeOf(rejected, prototype);
        if (shape === 'inherited message') {
          Reflect.deleteProperty(rejected, 'message');
        }
      } else {
        Object.defineProperty(rejected, property, { configurable: true, get: read });
      }

      await expectSanitizedPublicFailure(surface, rejected, 'fallback');
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each(
    publicSurfaces.flatMap((surface) =>
      (['own name', 'inherited name', 'own message', 'inherited message', 'own stack'] as const).map(
        (shape) => ({
          surface,
          shape,
        }),
      ),
    ),
  )(
    'never invokes a stack-deleted Error wrapper $shape getter through $surface without native intrinsics',
    async ({ surface, shape }) => {
      const read = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an untrusted wrapper ${shape} getter`);
      });
      const rejected = new Error(`${PRIVATE_VALUE} escaped through a parser wrapper`);
      Reflect.deleteProperty(rejected, 'stack');
      Object.defineProperty(rejected, 'cause', { configurable: true, value: new SyntaxError(PRIVATE_VALUE) });
      const property = shape.slice(shape.startsWith('inherited ') ? 'inherited '.length : 'own '.length);
      if (shape.startsWith('inherited ')) {
        const prototype: object = Object.create(Error.prototype);
        Object.defineProperty(prototype, property, { configurable: true, get: read });
        Object.setPrototypeOf(rejected, prototype);
        if (shape === 'inherited message') {
          Reflect.deleteProperty(rejected, 'message');
        }
      } else {
        Object.defineProperty(rejected, property, { configurable: true, get: read });
      }

      await expectSanitizedPublicFailure(surface, rejected, 'fallback');
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each(publicSurfaces)(
    'never invokes a foreign parser getter installed by a later prototype descriptor trap through %s',
    async (surface) => {
      const rejected = runInNewContext('new SyntaxError(privateValue)', {
        privateValue: PRIVATE_VALUE,
      }) as Error;
      Reflect.deleteProperty(rejected, 'stack');
      const errorPrototype = Object.getPrototypeOf(Object.getPrototypeOf(rejected)) as object;
      const original = Object.getPrototypeOf(errorPrototype) as object;
      const read = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through a mutated foreign parser getter`);
      });
      Object.setPrototypeOf(
        errorPrototype,
        new Proxy(original, {
          getOwnPropertyDescriptor(target, property) {
            if (property === 'cause') {
              Object.defineProperty(rejected, 'name', { configurable: true, get: read });
            }
            return Reflect.getOwnPropertyDescriptor(target, property);
          },
        }),
      );

      await expectSanitizedPublicFailure(surface, rejected, 'fallback');
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each(
    publicSurfaces.flatMap((surface) =>
      (['enumerable accessor', 'enumerable nested object'] as const).map((shape) => ({ surface, shape })),
    ),
  )(
    'fails closed without reading an unknown $shape on an unbranded parser rejection through $surface',
    async ({ surface, shape }) => {
      const read = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an untrusted clone getter`);
      });
      const rejected: object = Object.create(Error.prototype);
      Object.defineProperties(rejected, {
        message: { configurable: true, value: PRIVATE_VALUE },
        type: { configurable: true, enumerable: true, value: 'invalid-json' },
      });
      if (shape === 'enumerable accessor') {
        Object.defineProperty(rejected, 'metadata', { configurable: true, enumerable: true, get: read });
      } else {
        const metadata = Object.defineProperty({}, 'privateValue', {
          configurable: true,
          enumerable: true,
          get: read,
        });
        Object.defineProperty(rejected, 'metadata', {
          configurable: true,
          enumerable: true,
          value: metadata,
        });
      }

      await expectSanitizedPublicFailure(surface, rejected, 'fallback');
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['native', 'prototype-mutated'] as const).map((prototype) => ({
          runtimeErrorBrand,
          surface,
          prototype,
        })),
      ),
    ),
  )(
    'does not invoke Error.prepareStackTrace while classifying a $prototype parser failure through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, prototype }) => {
      const rejected = new SyntaxError(PRIVATE_VALUE);
      if (prototype === 'prototype-mutated') {
        Object.setPrototypeOf(rejected, Error.prototype);
        Object.defineProperty(rejected, 'name', { configurable: true, value: 'SyntaxError' });
      }
      const { run, SubjectTokenProviderError } = await publicParserRejection(
        surface,
        rejected,
        runtimeErrorBrand,
      );
      const prepareStackTrace = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an untrusted stack formatter`);
      });
      const original = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
      let failure: unknown;

      try {
        Object.defineProperty(Error, 'prepareStackTrace', {
          configurable: true,
          value: prepareStackTrace,
          writable: true,
        });
        try {
          await run();
        } catch (error) {
          failure = error;
        }
      } finally {
        if (original) {
          Object.defineProperty(Error, 'prepareStackTrace', original);
        } else {
          Reflect.deleteProperty(Error, 'prepareStackTrace');
        }
      }

      const sanitized =
        surface === 'azure-provider' && failure instanceof SubjectTokenProviderError
          ? failure.cause
          : failure;
      expect(sanitized).toBeInstanceOf(SyntaxError);
      expect(sanitized && Object.getOwnPropertyDescriptor(sanitized, 'message')?.value).toBe(
        surface === 'azure-provider'
          ? 'IMDS response contains invalid JSON'
          : 'Token exchange response contains invalid JSON',
      );
      expect(prepareStackTrace).not.toHaveBeenCalled();
    },
  );

  it.each(
    [...runtimeErrorBrands, 'fallback without structuredClone' as const].flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['forged SyntaxError', 'concealed parser marker'] as const).map((shape) => ({
          runtimeErrorBrand,
          surface,
          shape,
        })),
      ),
    ),
  )(
    'does not invoke Error.prepareStackTrace while classifying a $shape proxy through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, shape }) => {
      const target =
        shape === 'forged SyntaxError'
          ? (Object.create(SyntaxError.prototype) as object)
          : Object.defineProperty(new Error(`invalid json response body reason: ${PRIVATE_VALUE}`), 'type', {
              configurable: true,
              enumerable: true,
              value: 'invalid-json',
            });
      const readProxy = vi.fn((_target: object, property: PropertyKey) => {
        throw new Error(
          `${PRIVATE_VALUE} escaped through the ${String(property)} stack-formatting proxy getter`,
        );
      });
      const rejected = new Proxy(target, {
        get: readProxy,
        getOwnPropertyDescriptor(value, property) {
          return shape === 'concealed parser marker' && property === 'type'
            ? undefined
            : Reflect.getOwnPropertyDescriptor(value, property);
        },
      });
      const { run, fetch, SubjectTokenProviderError } = await publicParserRejection(
        surface,
        rejected,
        runtimeErrorBrand,
      );
      const prepareStackTrace = vi.fn(() => {
        throw new Error(`${PRIVATE_VALUE} escaped through an untrusted proxy stack formatter`);
      });
      const original = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
      let failure: unknown;

      try {
        Object.defineProperty(Error, 'prepareStackTrace', {
          configurable: true,
          value: prepareStackTrace,
          writable: true,
        });
        try {
          await run();
        } catch (error) {
          failure = error;
        }
      } finally {
        if (original) {
          Object.defineProperty(Error, 'prepareStackTrace', original);
        } else {
          Reflect.deleteProperty(Error, 'prepareStackTrace');
        }
      }

      const actual =
        surface === 'azure-provider' && failure instanceof SubjectTokenProviderError
          ? failure.cause
          : failure;
      if (shape === 'forged SyntaxError') {
        expect(actual === rejected).toBe(true);
      } else {
        expect(actual instanceof SyntaxError).toBe(true);
        expect(actual && Object.getOwnPropertyDescriptor(actual, 'message')?.value).toBe(
          surface === 'azure-provider'
            ? 'IMDS response contains invalid JSON'
            : 'Token exchange response contains invalid JSON',
        );
      }

      expect(prepareStackTrace).not.toHaveBeenCalled();
      expect(readProxy).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (
          [
            'invalid-json Error marker',
            'invalid-json TypeError marker',
            'Error SyntaxError cause',
            'TypeError SyntaxError cause',
          ] as const
        ).map((shape) => ({ runtimeErrorBrand, surface, shape })),
      ),
    ),
  )(
    'sanitizes a transparent proxy with an authentic $shape through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, shape }) => {
      const target = shape.includes('TypeError')
        ? new TypeError(`${PRIVATE_VALUE} escaped through a parser wrapper`)
        : new Error(`${PRIVATE_VALUE} escaped through a parser wrapper`);
      const isParserMarker = shape.startsWith('invalid-json ');
      Object.defineProperty(target, isParserMarker ? 'type' : 'cause', {
        configurable: true,
        value: isParserMarker ? 'invalid-json' : new SyntaxError(PRIVATE_VALUE),
      });
      const readProxy = vi.fn((value: Error, property: PropertyKey, receiver: unknown) =>
        Reflect.get(value, property, receiver),
      );
      const rejected = new Proxy(target, { get: readProxy });

      await expectSanitizedPublicFailure(surface, rejected, runtimeErrorBrand);
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['TypeError', 'DOMException', 'Error', 'custom record'] as const).map((shape) => ({
          runtimeErrorBrand,
          surface,
          shape,
        })),
      ),
    ),
  )(
    'preserves a transparent $shape transport proxy through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, shape }) => {
      let target: object;
      if (shape === 'TypeError') {
        target = new TypeError('safe custom response body transport failure');
      } else if (shape === 'DOMException') {
        target = new DOMException('safe custom response body cancellation', 'AbortError');
      } else if (shape === 'Error') {
        target = new Error('safe custom response body transport failure');
      } else {
        target = Object.create(Error.prototype) as object;
        Object.defineProperties(target, {
          message: { configurable: true, value: 'safe custom parser record' },
          type: { configurable: true, value: 'system' },
        });
      }
      const readProxy = vi.fn((value: object, property: PropertyKey, receiver: unknown) =>
        Reflect.get(value, property, receiver),
      );
      const rejected = new Proxy(target, { get: readProxy });

      await expectOriginalPublicFailure(surface, rejected, runtimeErrorBrand);
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    publicSurfaces.flatMap((surface) =>
      (['Error', 'TypeError'] as const).map((constructor) => ({ surface, constructor })),
    ),
  )(
    'safely handles a diagnostic-free $constructor transport proxy through $surface',
    async ({ surface, constructor }) => {
      const target =
        constructor === 'Error'
          ? new Error('safe custom response body transport failure')
          : new TypeError('safe custom response body transport failure');
      expect(Reflect.deleteProperty(target, 'message')).toBe(true);
      expect(Reflect.deleteProperty(target, 'stack')).toBe(true);

      const readProxy = vi.fn((_target: Error, property: PropertyKey) => {
        throw new Error(
          `${PRIVATE_VALUE} escaped through the ${String(property)} diagnostic-free transport getter`,
        );
      });
      const rejected = new Proxy(target, { get: readProxy });

      const expectPublicFailure =
        typeof process.versions['bun'] === 'string'
          ? expectSanitizedPublicFailure
          : expectOriginalPublicFailure;
      await expectPublicFailure(surface, rejected, 'native intrinsics');
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    publicSurfaces.flatMap((surface) =>
      (['Error', 'TypeError'] as const).flatMap((constructor) =>
        (['direct', 'nested'] as const).map((placement) => ({
          surface,
          constructor,
          placement,
        })),
      ),
    ),
  )(
    'preserves a $placement stackless $constructor transport proxy with native runtime diagnostics through $surface',
    async ({ surface, constructor, placement }) => {
      const target =
        constructor === 'Error'
          ? new Error('safe custom response body transport failure')
          : new TypeError('safe custom response body transport failure');
      Reflect.deleteProperty(target, 'stack');
      const readProxy = vi.fn((_target: Error, property: PropertyKey) => {
        throw new Error(
          `${PRIVATE_VALUE} escaped through the ${String(property)} stackless transport proxy getter`,
        );
      });
      const proxy = new Proxy(target, { get: readProxy });
      const rejected =
        placement === 'direct'
          ? proxy
          : Object.defineProperty(new Error('safe custom parser wrapper'), 'cause', {
              configurable: true,
              value: proxy,
            });

      await expectOriginalPublicFailure(surface, rejected, 'native intrinsics');
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['Error', 'TypeError'] as const).flatMap((constructor) =>
          (['direct', 'nested'] as const).map((placement) => ({
            runtimeErrorBrand,
            surface,
            constructor,
            placement,
          })),
        ),
      ),
    ),
  )(
    'preserves a $placement $constructor transport proxy with a Bun-compatible native clone failure through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, constructor, placement }) => {
      const target =
        constructor === 'Error'
          ? new Error('safe custom response body transport failure')
          : new TypeError('safe custom response body transport failure');
      const readProxy = vi.fn((_target: Error, property: PropertyKey) => {
        throw new Error(
          `${PRIVATE_VALUE} escaped through the ${String(property)} Bun transport proxy getter`,
        );
      });
      const proxy = new Proxy(target, { get: readProxy });
      const rejected =
        placement === 'direct'
          ? proxy
          : Object.defineProperty(new Error('safe custom parser wrapper'), 'cause', {
              configurable: true,
              value: proxy,
            });

      await withNativeCloneFailureMessage('The object can not be cloned.', async () => {
        await expectOriginalPublicFailure(surface, rejected, runtimeErrorBrand);
      });
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (
          [
            'native SyntaxError',
            'invalid-json Error marker',
            'invalid-json TypeError marker',
            'Error SyntaxError cause',
            'TypeError SyntaxError cause',
          ] as const
        ).map((shape) => ({ runtimeErrorBrand, surface, shape })),
      ),
    ),
  )(
    'sanitizes a proxy with an authentic $shape and a Bun-compatible native clone failure through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, shape }) => {
      let target: Error;
      if (shape === 'native SyntaxError') {
        target = new SyntaxError(PRIVATE_VALUE);
      } else if (shape.includes('TypeError')) {
        target = new TypeError(`${PRIVATE_VALUE} escaped through a parser wrapper`);
      } else {
        target = new Error(`${PRIVATE_VALUE} escaped through a parser wrapper`);
      }
      if (shape !== 'native SyntaxError') {
        const parserMarker = shape.startsWith('invalid-json ');
        Object.defineProperty(target, parserMarker ? 'type' : 'cause', {
          configurable: true,
          value: parserMarker ? 'invalid-json' : new SyntaxError(PRIVATE_VALUE),
        });
      }

      const readProxy = vi.fn((_target: Error, property: PropertyKey) => {
        throw new Error(`${PRIVATE_VALUE} escaped through the ${String(property)} Bun parser proxy getter`);
      });
      const rejected = new Proxy(target, { get: readProxy });

      await withNativeCloneFailureMessage('The object can not be cloned.', async () => {
        await expectSanitizedPublicFailure(surface, rejected, runtimeErrorBrand);
      });
      expect(readProxy).not.toHaveBeenCalled();
    },
  );

  it.each(
    runtimeErrorBrands.flatMap((runtimeErrorBrand) =>
      publicSurfaces.flatMap((surface) =>
        (['TypeError', 'DOMException', 'custom record'] as const).map((shape) => ({
          runtimeErrorBrand,
          surface,
          shape,
        })),
      ),
    ),
  )(
    'preserves a nested transparent $shape transport proxy through $surface using $runtimeErrorBrand',
    async ({ runtimeErrorBrand, surface, shape }) => {
      let target: object;
      if (shape === 'TypeError') {
        target = new TypeError('safe nested response body transport failure');
      } else if (shape === 'DOMException') {
        target = new DOMException('safe nested response body cancellation', 'AbortError');
      } else {
        target = Object.create(Error.prototype) as object;
        Object.defineProperty(target, 'message', {
          configurable: true,
          value: 'safe nested custom parser record',
        });
      }
      const readProxy = vi.fn((value: object, property: PropertyKey, receiver: unknown) =>
        Reflect.get(value, property, receiver),
      );
      const proxy = new Proxy(target, { get: readProxy });
      const rejected = Object.defineProperty(new Error('safe custom parser wrapper'), 'cause', {
        configurable: true,
        value: proxy,
      });

      await expectOriginalPublicFailure(surface, rejected, runtimeErrorBrand);
      expect(readProxy).not.toHaveBeenCalled();
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
