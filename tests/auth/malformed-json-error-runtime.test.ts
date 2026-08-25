import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { inspect } from 'node:util';
import { runInNewContext } from 'node:vm';

import { vi } from 'vitest';

const PRIVATE_VALUE = 'sk-runtime-private-fixture';
type PublicSurface = 'azure-provider' | 'public-workload';
type RuntimeErrorBrand = 'native intrinsics' | 'fallback' | 'fallback without structuredClone';
const publicSurfaces: readonly PublicSurface[] = ['azure-provider', 'public-workload'];
const runtimeErrorBrands: readonly RuntimeErrorBrand[] = ['native intrinsics', 'fallback'];
const proxyIntrinsicTest = typeof process.getBuiltinModule === 'function' ? it : it.skip;

async function importPublicSDK() {
  const [{ default: OpenAI, SubjectTokenProviderError }, { azureManagedIdentityTokenProvider }] =
    await Promise.all([import('openai'), import('openai/auth/subject-token-providers')]);
  return { OpenAI, SubjectTokenProviderError, azureManagedIdentityTokenProvider };
}

async function importWithoutNativeErrorBrand(
  withoutStructuredClone = false,
  structuredClonePolyfill?: (value: object) => unknown,
) {
  vi.resetModules();
  const properties: { target: object; name: string }[] = [
    { target: Error, name: 'isError' },
    { target: process, name: 'getBuiltinModule' },
    { target: process, name: 'binding' },
  ];
  if (withoutStructuredClone || structuredClonePolyfill) {
    properties.push({ target: globalThis, name: 'structuredClone' });
  }
  const descriptors = properties.map(({ target, name }) => Object.getOwnPropertyDescriptor(target, name));

  try {
    for (const { target, name } of properties) {
      Object.defineProperty(target, name, {
        configurable: true,
        value: name === 'structuredClone' ? structuredClonePolyfill : undefined,
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
) {
  if (runtimeErrorBrand === 'native intrinsics') {
    vi.resetModules();
  }
  const { OpenAI, SubjectTokenProviderError, azureManagedIdentityTokenProvider } =
    runtimeErrorBrand === 'native intrinsics'
      ? await importPublicSDK()
      : await importWithoutNativeErrorBrand(
          runtimeErrorBrand === 'fallback without structuredClone',
          structuredClonePolyfill,
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
) {
  const { run, fetch, SubjectTokenProviderError } = await publicParserRejection(
    surface,
    rejected,
    runtimeErrorBrand,
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
) {
  const { run, fetch, SubjectTokenProviderError } = await publicParserRejection(
    surface,
    rejected,
    runtimeErrorBrand,
    structuredClonePolyfill,
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

  it.each(publicSurfaces)(
    'does not invoke Error.prepareStackTrace while classifying a native parser failure through %s',
    async (surface) => {
      const rejected = new SyntaxError(PRIVATE_VALUE);
      const { run, SubjectTokenProviderError } = await publicParserRejection(surface, rejected, 'fallback');
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
