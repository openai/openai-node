import { getEventListeners } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { vi } from 'vitest';

import OpenAI, { APIUserAbortError } from 'openai';
import type { Fetch, RequestInit } from 'openai/internal/builtin-types';
import { bedrock as bearerBedrock } from 'openai/providers/bedrock';
import { bedrock as awsBedrock } from 'openai/providers/bedrock/aws';

type TokenProvider = () => Promise<string>;
type Endpoint = 'mantle' | 'runtime';
type ProviderFactory = (endpoint: Endpoint, tokenProvider: TokenProvider) => ReturnType<typeof bearerBedrock>;
type FetchMock = ReturnType<typeof vi.fn<Fetch>>;

class SignalReplacingOpenAI extends OpenAI {
  private readonly replacementSignal: AbortSignal;

  constructor(options: ConstructorParameters<typeof OpenAI>[0], replacementSignal: AbortSignal) {
    super(options);
    this.replacementSignal = replacementSignal;
  }

  protected override async prepareRequest(request: RequestInit): Promise<void> {
    request.signal = this.replacementSignal;
  }
}

const dependencyFreeProvider: ProviderFactory = (endpoint, tokenProvider) =>
  bearerBedrock({ endpoint, region: 'us-east-1', tokenProvider });

const sigV4Provider: ProviderFactory = (endpoint, tokenProvider) =>
  awsBedrock({
    endpoint,
    region: 'us-east-1',
    baseURL:
      endpoint === 'mantle'
        ? 'https://bedrock-mantle.us-east-1.api.aws/openai/v1'
        : 'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1',
    apiKey: null,
    credentialProvider: async () => ({
      accessKeyId: 'synthetic-access-key',
      secretAccessKey: await tokenProvider(),
    }),
  });

const providerFactories: [string, ProviderFactory][] = [
  ['dependency-free bearer', dependencyFreeProvider],
  [
    'AWS-entrypoint bearer',
    (endpoint, tokenProvider) => awsBedrock({ endpoint, region: 'us-east-1', tokenProvider }),
  ],
  ['AWS SigV4', sigV4Provider],
];

const providerCases: [string, Endpoint, ProviderFactory][] = providerFactories.flatMap(([name, create]) =>
  (['mantle', 'runtime'] as const).map((endpoint): [string, Endpoint, ProviderFactory] => [
    name,
    endpoint,
    create,
  ]),
);

function createClient(
  tokenProvider: TokenProvider,
  create: ProviderFactory = dependencyFreeProvider,
  endpoint: Endpoint = 'mantle',
  requestSignal?: AbortSignal,
): { client: OpenAI; fetch: FetchMock } {
  const fetch = vi.fn<Fetch>(async () => Response.json({ object: 'list', data: [], has_more: false }));
  const options = { provider: create(endpoint, tokenProvider), fetch, maxRetries: 0 };
  return {
    client: requestSignal ? new SignalReplacingOpenAI(options, requestSignal) : new OpenAI(options),
    fetch,
  };
}

async function observe(promise: Promise<unknown>): Promise<unknown> {
  try {
    return { completed: await promise };
  } catch (error) {
    return error;
  }
}

async function waitForProvider(provider: ReturnType<typeof vi.fn<TokenProvider>>): Promise<void> {
  await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1), { timeout: 300, interval: 1 });
}

async function expectImmediateCancellation(
  pending: Promise<unknown>,
  signal: AbortSignal,
  fetch: FetchMock,
  expectedFetchCalls = 0,
): Promise<void> {
  await nextTurn();
  const waiting = Symbol('credential provider is still blocking cancellation');
  const result = await Promise.race([pending, Promise.resolve(waiting)]);

  expect(result).not.toBe(waiting);
  expect(result).toBeInstanceOf(APIUserAbortError);
  expect(Object.getOwnPropertyDescriptor(result, 'cause')).toEqual({
    value: signal.reason,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  expect(fetch).toHaveBeenCalledTimes(expectedFetchCalls);
}

function structuralSignal(controller: AbortController): AbortSignal {
  return {
    get aborted() {
      return controller.signal.aborted;
    },
    get reason() {
      return controller.signal.reason;
    },
    onabort: null,
    throwIfAborted: controller.signal.throwIfAborted.bind(controller.signal),
    addEventListener: controller.signal.addEventListener.bind(controller.signal),
    removeEventListener: controller.signal.removeEventListener.bind(controller.signal),
    dispatchEvent: controller.signal.dispatchEvent.bind(controller.signal),
  };
}

function throwAfterRemovingOnce(signal: AbortSignal): void {
  const original = signal.removeEventListener.bind(signal);
  vi.spyOn(signal, 'removeEventListener').mockImplementationOnce((type, listener, options) => {
    original(type, listener, options);
    throw new Error('hostile cleanup failed');
  });
}

afterEach(() => vi.restoreAllMocks());

describe.each(providerCases)('%s %s credentials', (_name, endpoint, create) => {
  test('cancels a documented public models request while its token provider remains pending', async () => {
    const controller = new AbortController();
    const reason = new Error('caller cancelled credential resolution');
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider, create, endpoint);
    const pending = observe(client.models.list({ signal: controller.signal }));

    await waitForProvider(tokenProvider);
    controller.abort(reason);

    await expectImmediateCancellation(pending, controller.signal, fetch);
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });

  test('rejects a pre-aborted request without invoking the credential provider', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already cancelled'));
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider, create, endpoint);
    const pending = observe(client.models.list({ signal: controller.signal }));

    await expectImmediateCancellation(pending, controller.signal, fetch);
    expect(tokenProvider).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });

  test('cancels a finalized request signal supplied by the protected request hook', async () => {
    const finalized = new AbortController();
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider, create, endpoint, finalized.signal);
    const pending = observe(client.models.list());

    await waitForProvider(tokenProvider);
    finalized.abort(new Error('protected hook cancelled the finalized request'));

    await expectImmediateCancellation(pending, finalized.signal, fetch);
    expect(getEventListeners(finalized.signal, 'abort')).toEqual([]);
  });

  test.each(['original options', 'finalized request'] as const)(
    'cancels from the %s signal when the protected request hook replaces it',
    async (source) => {
      const original = new AbortController();
      const finalized = new AbortController();
      const cancelled = source === 'original options' ? original : finalized;
      const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
      const { client, fetch } = createClient(tokenProvider, create, endpoint, finalized.signal);
      const pending = observe(client.models.list({ signal: original.signal }));

      await waitForProvider(tokenProvider);
      cancelled.abort(new Error(`${source} cancelled credential resolution`));

      await expectImmediateCancellation(pending, cancelled.signal, fetch);
      expect(getEventListeners(original.signal, 'abort')).toEqual([]);
      expect(getEventListeners(finalized.signal, 'abort')).toEqual([]);
    },
  );

  test('rejects a pre-aborted replacement signal without invoking the credential provider', async () => {
    const original = new AbortController();
    const finalized = new AbortController();
    finalized.abort(new Error('protected hook supplied an already-cancelled signal'));
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider, create, endpoint, finalized.signal);

    await expectImmediateCancellation(
      observe(client.models.list({ signal: original.signal })),
      finalized.signal,
      fetch,
    );
    expect(tokenProvider).not.toHaveBeenCalled();
    expect(getEventListeners(original.signal, 'abort')).toEqual([]);
    expect(getEventListeners(finalized.signal, 'abort')).toEqual([]);
  });
});

describe.each(['mantle', 'runtime'] as const)('Bedrock %s SigV4 credential lifecycle', (endpoint) => {
  test.each(['resolve', 'reject'] as const)(
    'keeps cancellation when late credentials %s and permits a fresh request',
    async (settlement) => {
      const controller = new AbortController();
      const lateFailure = new Error('synthetic late credential refresh failure');
      let finishLate!: () => void;
      // oxlint-disable-next-line promise/avoid-new -- The deferred credential exercises settlement after cancellation.
      const lateCredential = new Promise<string>((resolve, reject) => {
        finishLate = () => {
          if (settlement === 'resolve') {
            resolve('synthetic-late-secret-key');
          } else {
            reject(lateFailure);
          }
        };
      });
      const tokenProvider = vi
        .fn<TokenProvider>()
        .mockReturnValueOnce(lateCredential)
        .mockResolvedValue('synthetic-fresh-secret-key');
      const { client, fetch } = createClient(tokenProvider, sigV4Provider, endpoint);
      const pending = observe(client.models.list({ signal: controller.signal }));
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);

      try {
        await waitForProvider(tokenProvider);
        controller.abort(new Error('caller cancelled pending AWS credentials'));
        await expectImmediateCancellation(pending, controller.signal, fetch);
        finishLate();
        await nextTurn();

        await expect(pending).resolves.toBeInstanceOf(APIUserAbortError);
        expect(fetch).not.toHaveBeenCalled();
        expect(unhandled).not.toHaveBeenCalled();
        expect(getEventListeners(controller.signal, 'abort')).toEqual([]);

        await expect(client.models.list()).resolves.toBeDefined();
        expect(tokenProvider).toHaveBeenCalledTimes(2);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toContain(
          'Credential=synthetic-access-key/',
        );
      } finally {
        finishLate();
        await pending;
        process.removeListener('unhandledRejection', unhandled);
      }
    },
  );

  test('cancels credential refresh on a retry without sending a second request', async () => {
    const controller = new AbortController();
    const tokenProvider = vi
      .fn<TokenProvider>()
      .mockResolvedValueOnce('synthetic-first-secret-key')
      .mockImplementationOnce(() => Promise.race([]));
    const fetch = vi.fn<Fetch>(async () =>
      Response.json(
        { error: { message: 'retry once' } },
        { status: 500, headers: { 'retry-after-ms': '1' } },
      ),
    );
    const client = new OpenAI({
      provider: sigV4Provider(endpoint, tokenProvider),
      fetch,
      maxRetries: 1,
    });
    const pending = observe(client.models.list({ signal: controller.signal }));

    await vi.waitFor(() => expect(tokenProvider).toHaveBeenCalledTimes(2), { timeout: 1000, interval: 1 });
    controller.abort(new Error('caller cancelled the refreshed AWS credentials'));

    await expectImmediateCancellation(pending, controller.signal, fetch, 1);
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });
});

describe('Bedrock protected request-hook signal replacement', () => {
  test('registers a shared options and finalized request signal only once', async () => {
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(
      tokenProvider,
      dependencyFreeProvider,
      'mantle',
      controller.signal,
    );
    const pending = observe(client.models.list({ signal: controller.signal }));

    await waitForProvider(tokenProvider);
    expect(addListener).toHaveBeenCalledTimes(1);
    controller.abort(new Error('the shared caller signal cancelled once'));

    await expectImmediateCancellation(pending, controller.signal, fetch);
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });

  test('accepts a structural finalized request signal alongside the original native signal', async () => {
    const original = new AbortController();
    const finalized = new AbortController();
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(
      tokenProvider,
      dependencyFreeProvider,
      'mantle',
      structuralSignal(finalized),
    );
    const pending = observe(client.models.list({ signal: original.signal }));

    await waitForProvider(tokenProvider);
    finalized.abort(new Error('structural finalized request cancelled'));

    await expectImmediateCancellation(pending, finalized.signal, fetch);
    expect(getEventListeners(original.signal, 'abort')).toEqual([]);
    expect(getEventListeners(finalized.signal, 'abort')).toEqual([]);
  });

  test('never attaches a credential when the finalized signal aborts after token settlement', async () => {
    const original = new AbortController();
    const finalized = new AbortController();
    const secret = 'synthetic-late-resolved-credential';
    const tokenProvider: TokenProvider = () => {
      const token = Promise.resolve(secret);
      void token.then(() => queueMicrotask(() => finalized.abort(new Error('finalized signal won'))));
      return token;
    };
    const headersSet = vi.spyOn(Headers.prototype, 'set');
    const { client, fetch } = createClient(tokenProvider, dependencyFreeProvider, 'mantle', finalized.signal);

    await expectImmediateCancellation(
      observe(client.models.list({ signal: original.signal })),
      finalized.signal,
      fetch,
    );
    expect(headersSet.mock.calls).not.toContainEqual(['authorization', `Bearer ${secret}`]);
    expect(getEventListeners(original.signal, 'abort')).toEqual([]);
    expect(getEventListeners(finalized.signal, 'abort')).toEqual([]);
  });

  test.each(['finalized request', 'original options'] as const)(
    'preserves the first %s cancellation after bearer token settlement',
    async (source) => {
      const original = new AbortController();
      const finalized = new AbortController();
      const first = source === 'original options' ? original : finalized;
      const second = first === original ? finalized : original;
      const reason = new Error(`${source} cancelled first after token settlement`);
      const tokenProvider: TokenProvider = () => {
        const token = Promise.resolve('synthetic-late-resolved-credential');
        void token.then(() => {
          queueMicrotask(() => first.abort(reason));
          queueMicrotask(() => second.abort(new Error('second cancellation must not replace the first')));
        });
        return token;
      };
      const { client, fetch } = createClient(
        tokenProvider,
        dependencyFreeProvider,
        'mantle',
        finalized.signal,
      );

      await expectImmediateCancellation(
        observe(client.models.list({ signal: original.signal })),
        first.signal,
        fetch,
      );
      expect(getEventListeners(original.signal, 'abort')).toEqual([]);
      expect(getEventListeners(finalized.signal, 'abort')).toEqual([]);
    },
  );

  test('removes both listeners when finalized signal registration installs and then throws', async () => {
    const original = new AbortController();
    const finalizedController = new AbortController();
    const finalized = structuralSignal(finalizedController);
    const failure = new Error('finalized signal registration failed');
    const add = finalized.addEventListener.bind(finalized);
    vi.spyOn(finalized, 'addEventListener').mockImplementationOnce((type, listener, options) => {
      add(type, listener, options);
      throw failure;
    });
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider, dependencyFreeProvider, 'mantle', finalized);
    const pending = observe(client.models.list({ signal: original.signal }));

    await nextTurn();
    const waiting = Symbol('finalized signal registration failure did not settle');
    expect(await Promise.race([pending, Promise.resolve(waiting)])).toBe(failure);
    expect(tokenProvider).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(getEventListeners(original.signal, 'abort')).toEqual([]);
    expect(getEventListeners(finalizedController.signal, 'abort')).toEqual([]);
  });

  test('keeps the first cancellation and removes a finalized listener installed after it', async () => {
    const original = new AbortController();
    const finalizedController = new AbortController();
    const finalized = structuralSignal(finalizedController);
    const reason = new Error('original cancellation beat finalized registration');
    const add = finalized.addEventListener.bind(finalized);
    vi.spyOn(finalized, 'addEventListener').mockImplementationOnce((type, listener, options) => {
      original.abort(reason);
      add(type, listener, options);
      throw new Error('late finalized registration failure');
    });
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider, dependencyFreeProvider, 'mantle', finalized);

    await expectImmediateCancellation(
      observe(client.models.list({ signal: original.signal })),
      original.signal,
      fetch,
    );
    expect(tokenProvider).not.toHaveBeenCalled();
    expect(getEventListeners(original.signal, 'abort')).toEqual([]);
    expect(getEventListeners(finalizedController.signal, 'abort')).toEqual([]);
  });

  test.each(['original options', 'finalized request'] as const)(
    'removes both structural listeners when %s cancellation cleanup throws',
    async (source) => {
      const originalController = new AbortController();
      const finalizedController = new AbortController();
      const original = structuralSignal(originalController);
      const finalized = structuralSignal(finalizedController);
      const cancelled = source === 'original options' ? originalController : finalizedController;
      throwAfterRemovingOnce(original);
      throwAfterRemovingOnce(finalized);
      const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
      const { client, fetch } = createClient(tokenProvider, dependencyFreeProvider, 'mantle', finalized);
      const pending = observe(client.models.list({ signal: original }));

      await waitForProvider(tokenProvider);
      cancelled.abort(new Error(`${source} cancellation survived cleanup failures`));

      await expectImmediateCancellation(pending, cancelled.signal, fetch);
      expect(getEventListeners(originalController.signal, 'abort')).toEqual([]);
      expect(getEventListeners(finalizedController.signal, 'abort')).toEqual([]);
    },
  );

  test('preserves a successful credential while both structural cleanup methods throw', async () => {
    const originalController = new AbortController();
    const finalizedController = new AbortController();
    const original = structuralSignal(originalController);
    const finalized = structuralSignal(finalizedController);
    throwAfterRemovingOnce(original);
    throwAfterRemovingOnce(finalized);
    const tokenProvider = vi.fn<TokenProvider>(async () => 'valid-bearer-token');
    const { client, fetch } = createClient(tokenProvider, dependencyFreeProvider, 'mantle', finalized);

    await expect(client.models.list({ signal: original })).resolves.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getEventListeners(originalController.signal, 'abort')).toEqual([]);
    const finalizedProviderListener = vi.mocked(finalized.removeEventListener).mock.calls[0]?.[1];
    expect(finalizedProviderListener).toBeDefined();
    expect(getEventListeners(finalizedController.signal, 'abort')).not.toContain(finalizedProviderListener);
    finalizedController.abort();
    expect(getEventListeners(finalizedController.signal, 'abort')).toEqual([]);
  });

  test('preserves a provider failure while both structural cleanup methods throw', async () => {
    const originalController = new AbortController();
    const finalizedController = new AbortController();
    const original = structuralSignal(originalController);
    const finalized = structuralSignal(finalizedController);
    throwAfterRemovingOnce(original);
    throwAfterRemovingOnce(finalized);
    const failure = new Error('private token service unavailable');
    const tokenProvider: TokenProvider = async () => {
      throw failure;
    };
    const { client, fetch } = createClient(tokenProvider, dependencyFreeProvider, 'mantle', finalized);

    await expect(client.models.list({ signal: original })).rejects.toMatchObject({
      message: 'Failed to resolve a bearer credential for Bedrock.',
      cause: failure,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(getEventListeners(originalController.signal, 'abort')).toEqual([]);
    expect(getEventListeners(finalizedController.signal, 'abort')).toEqual([]);
  });
});

describe('Bedrock bearer cancellation ownership and compatibility', () => {
  test('preserves unrelated abort listeners and exact primitive cancellation causes', async () => {
    const controller = new AbortController();
    const unrelated = vi.fn();
    controller.signal.addEventListener('abort', unrelated);
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider);
    const pending = observe(client.models.list({ signal: controller.signal }));

    await waitForProvider(tokenProvider);
    controller.abort(0);

    await expectImmediateCancellation(pending, controller.signal, fetch);
    expect(unrelated).toHaveBeenCalledTimes(1);
    expect(getEventListeners(controller.signal, 'abort')).toEqual([unrelated]);
  });

  test.each([null, false, '', 'private caller reason'])('preserves abort reason %j', async (reason) => {
    const controller = new AbortController();
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider);
    const pending = observe(client.models.list({ signal: controller.signal }));

    await waitForProvider(tokenProvider);
    controller.abort(reason);

    await expectImmediateCancellation(pending, controller.signal, fetch);
  });

  test('keeps the existing provider-error wrapper when its provider rejects APIUserAbortError', async () => {
    const controller = new AbortController();
    const providerError = new APIUserAbortError();
    const tokenProvider = vi.fn<TokenProvider>(async () => {
      throw providerError;
    });
    const { client, fetch } = createClient(tokenProvider);

    await expect(client.models.list({ signal: controller.signal })).rejects.toMatchObject({
      message: 'Failed to resolve a bearer credential for Bedrock.',
      cause: providerError,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });

  test('keeps an already-settled provider failure wrapped when the caller aborts before its catch', async () => {
    const controller = new AbortController();
    const providerError = new APIUserAbortError();
    const tokenProvider = vi.fn<TokenProvider>(() => {
      const rejected = Promise.reject(providerError);
      void rejected.catch(() => queueMicrotask(() => controller.abort(new Error('later cancellation'))));
      return rejected;
    });
    const { client, fetch } = createClient(tokenProvider);

    await expect(client.models.list({ signal: controller.signal })).rejects.toMatchObject({
      message: 'Failed to resolve a bearer credential for Bedrock.',
      cause: providerError,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('keeps a provider-originated NaN failure inside its existing credential wrapper', async () => {
    const controller = new AbortController();
    const failure = Number.NaN;
    const tokenProvider: TokenProvider = () => Promise.reject(failure);
    const { client, fetch } = createClient(tokenProvider);

    await expect(client.models.list({ signal: controller.signal })).rejects.toMatchObject({
      message: 'Failed to resolve a bearer credential for Bedrock.',
      cause: Number.NaN,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });

  test('preserves a synchronous token-provider failure and its original cause', async () => {
    const failure = new Error('credential service failed');
    const tokenProvider: TokenProvider = () => {
      throw failure;
    };
    const { client, fetch } = createClient(tokenProvider);

    await expect(client.models.list({ signal: new AbortController().signal })).rejects.toMatchObject({
      message: 'Failed to resolve a bearer credential for Bedrock.',
      cause: failure,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('keeps the winning caller cancellation when token resolution aborts and then throws', async () => {
    const controller = new AbortController();
    const reason = new Error('caller cancellation won');
    const providerFailure = new Error('private credential-provider failure');
    const tokenProvider: TokenProvider = () => {
      controller.abort(reason);
      throw providerFailure;
    };
    const { client, fetch } = createClient(tokenProvider);
    const pending = observe(client.models.list({ signal: controller.signal }));

    await expectImmediateCancellation(pending, controller.signal, fetch);
  });

  test('handles a rejected provider promise even when synchronous cancellation wins first', async () => {
    const controller = new AbortController();
    const reason = new Error('caller cancellation won first');
    const secretFailure = new Error('synthetic private credential failure');
    const unhandled = vi.fn();
    const tokenProvider: TokenProvider = () => {
      controller.abort(reason);
      return Promise.reject(secretFailure);
    };
    const { client, fetch } = createClient(tokenProvider);
    process.on('unhandledRejection', unhandled);

    try {
      const pending = observe(client.models.list({ signal: controller.signal }));
      await expectImmediateCancellation(pending, controller.signal, fetch);
      await nextTurn();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.removeListener('unhandledRejection', unhandled);
    }
  });

  test('never attaches late-resolved credentials after synchronous cancellation', async () => {
    const controller = new AbortController();
    const reason = new Error('caller cancelled before credentials');
    const tokenProvider: TokenProvider = () => {
      controller.abort(reason);
      return Promise.resolve('late-sensitive-bearer-token');
    };
    const { client, fetch } = createClient(tokenProvider);
    const pending = observe(client.models.list({ signal: controller.signal }));

    await expectImmediateCancellation(pending, controller.signal, fetch);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('never attaches a credential when cancellation arrives after token settlement', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled between token and header');
    const secret = 'synthetic-late-resolved-credential';
    const tokenProvider: TokenProvider = () => {
      const token = Promise.resolve(secret);
      void token.then(() => queueMicrotask(() => controller.abort(reason)));
      return token;
    };
    const headersSet = vi.spyOn(Headers.prototype, 'set');
    const { client, fetch } = createClient(tokenProvider);

    await expectImmediateCancellation(
      observe(client.models.list({ signal: controller.signal })),
      controller.signal,
      fetch,
    );
    expect(headersSet.mock.calls).not.toContainEqual(['authorization', `Bearer ${secret}`]);
  });

  test('preserves custom Authorization failures before inspecting cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already cancelled'));
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider);

    await expect(
      client.models.list({ signal: controller.signal, headers: { authorization: 'caller credentials' } }),
    ).rejects.toThrow(/custom.*Authorization/u);
    expect(tokenProvider).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('preserves configured-origin rejection before inspecting cancellation or resolving credentials', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already cancelled'));
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider);

    await expect(
      client.request({
        method: 'get',
        path: 'https://attacker.example/private',
        signal: controller.signal,
      }),
    ).rejects.toThrow('Bedrock request origin');
    expect(tokenProvider).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('preserves successful bearer requests and removes only the provider-owned listener', async () => {
    const controller = new AbortController();
    const unrelated = vi.fn();
    controller.signal.addEventListener('abort', unrelated);
    const tokenProvider = vi.fn<TokenProvider>(async () => 'valid-bearer-token');
    const { client, fetch } = createClient(tokenProvider);

    await expect(client.models.list({ signal: controller.signal })).resolves.toBeDefined();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer valid-bearer-token',
    );
    expect(getEventListeners(controller.signal, 'abort')).toEqual([unrelated]);
  });

  test('refreshes bearer credentials for retries and cancels the second pending provider', async () => {
    const controller = new AbortController();
    const tokenProvider = vi
      .fn<TokenProvider>()
      .mockResolvedValueOnce('first-rotated-bearer-token')
      .mockImplementationOnce(() => Promise.race([]));
    const fetch = vi.fn<Fetch>(async () =>
      Response.json(
        { error: { message: 'retry once' } },
        { status: 500, headers: { 'retry-after-ms': '1' } },
      ),
    );
    const client = new OpenAI({
      provider: bearerBedrock({ endpoint: 'mantle', region: 'us-east-1', tokenProvider }),
      fetch,
      maxRetries: 1,
    });
    const pending = observe(client.models.list({ signal: controller.signal }));

    await vi.waitFor(() => expect(tokenProvider).toHaveBeenCalledTimes(2), { timeout: 1000, interval: 1 });
    controller.abort(new Error('cancelled refreshed credential resolution'));

    await expectImmediateCancellation(pending, controller.signal, fetch, 1);
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });

  test('preserves a genuine provider promise with a hostile own then getter', async () => {
    const controller = new AbortController();
    const token = Promise.resolve('valid-native-promise-token');
    // oxlint-disable-next-line unicorn/no-thenable -- Genuine provider promises can have hostile own properties.
    Object.defineProperty(token, 'then', {
      configurable: true,
      get() {
        throw new Error('own then getter must never be read');
      },
    });
    const { client, fetch } = createClient(() => token);

    await expect(client.models.list({ signal: controller.signal })).resolves.toBeDefined();
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer valid-native-promise-token',
    );
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });

  test.each([
    ['dependency-free static', bearerBedrock, { apiKey: 'synthetic-static-token' }, 'synthetic-static-token'],
    ['dependency-free environment', bearerBedrock, {}, 'synthetic-environment-token'],
    ['AWS-entrypoint static', awsBedrock, { apiKey: 'synthetic-static-token' }, 'synthetic-static-token'],
    ['AWS-entrypoint environment', awsBedrock, {}, 'synthetic-environment-token'],
  ] as const)(
    'preserves %s bearer credentials with a caller signal',
    async (_name, create, options, expected) => {
      const previous = process.env['AWS_BEARER_TOKEN_BEDROCK'];
      process.env['AWS_BEARER_TOKEN_BEDROCK'] = 'synthetic-environment-token';

      try {
        const controller = new AbortController();
        const fetch = vi.fn<Fetch>(async () => Response.json({ object: 'list', data: [], has_more: false }));
        const client = new OpenAI({
          provider: create({ endpoint: 'mantle', region: 'us-east-1', ...options }),
          fetch,
          maxRetries: 0,
        });

        await expect(client.models.list({ signal: controller.signal })).resolves.toBeDefined();
        expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
          `Bearer ${expected}`,
        );
        expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
      } finally {
        if (previous === undefined) {
          delete process.env['AWS_BEARER_TOKEN_BEDROCK'];
        } else {
          process.env['AWS_BEARER_TOKEN_BEDROCK'] = previous;
        }
      }
    },
  );

  test('preserves calls with no signal and validates invalid returned credentials', async () => {
    const tokenProvider = vi.fn<TokenProvider>(async () => '   ');
    const { client, fetch } = createClient(tokenProvider);

    await expect(client.models.list()).rejects.toThrow('must return a non-empty string');
    expect(tokenProvider).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('accepts a fully typed structural AbortSignal through the documented public API', async () => {
    const controller = new AbortController();
    const signal = structuralSignal(controller);
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider);
    const pending = observe(client.models.list({ signal }));

    await waitForProvider(tokenProvider);
    controller.abort(new Error('structural cancellation'));

    await expectImmediateCancellation(pending, controller.signal, fetch);
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });
});

describe('hostile Bedrock bearer AbortSignal lifecycle', () => {
  test.each(['before install', 'after install'] as const)(
    'settles the original registration failure when addEventListener throws %s',
    async (timing) => {
      const controller = new AbortController();
      const failure = new Error('signal registration failed');
      const original = controller.signal.addEventListener.bind(controller.signal);
      vi.spyOn(controller.signal, 'addEventListener').mockImplementation(((
        type: string,
        listener: Parameters<AbortSignal['addEventListener']>[1],
        options?: Parameters<AbortSignal['addEventListener']>[2],
      ) => {
        if (timing === 'after install') {
          original(type, listener, options);
        }
        throw failure;
      }) as typeof controller.signal.addEventListener);
      const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
      const { client, fetch } = createClient(tokenProvider);

      const pending = observe(client.models.list({ signal: controller.signal }));
      await nextTurn();
      const waiting = Symbol('registration failure did not settle');
      expect(await Promise.race([pending, Promise.resolve(waiting)])).toBe(failure);
      expect(tokenProvider).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
    },
  );

  test.each([false, true])('closes a registration race with delivered abort: %s', async (deliver) => {
    const controller = new AbortController();
    const reason = new Error('registration raced with cancellation');
    const original = controller.signal.addEventListener.bind(controller.signal);
    vi.spyOn(controller.signal, 'addEventListener').mockImplementation(((
      type: string,
      listener: Parameters<AbortSignal['addEventListener']>[1],
      options?: Parameters<AbortSignal['addEventListener']>[2],
    ) => {
      controller.abort(reason);
      if (deliver && typeof listener === 'function') {
        listener.call(controller.signal, new Event('abort'));
      }
      original(type, listener, options);
    }) as typeof controller.signal.addEventListener);
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider);

    const pending = observe(client.models.list({ signal: controller.signal }));
    await expectImmediateCancellation(pending, controller.signal, fetch);
    expect(tokenProvider).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });

  test('keeps cancellation and removes a late listener when registration and cleanup both throw', async () => {
    const controller = new AbortController();
    const signal = structuralSignal(controller);
    const reason = new Error('reentrant cancellation won');
    const add = signal.addEventListener.bind(signal);
    throwAfterRemovingOnce(signal);
    vi.spyOn(signal, 'addEventListener').mockImplementationOnce((type, listener, options) => {
      controller.abort(reason);
      if (typeof listener === 'function') {
        listener.call(signal, new Event('abort'));
      }
      add(type, listener, options);
      throw new Error('late registration failure');
    });
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider);

    await expectImmediateCancellation(observe(client.models.list({ signal })), controller.signal, fetch);
    expect(tokenProvider).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });

  test.each(['before registration', 'after registration'] as const)(
    'settles the original structural aborted getter failure %s',
    async (timing) => {
      const controller = new AbortController();
      const signal = structuralSignal(controller);
      const failure = new Error('structural aborted getter failed');
      let reads = 0;
      Object.defineProperty(signal, 'aborted', {
        configurable: true,
        get() {
          reads += 1;
          if (timing === 'before registration' || reads > 1) {
            throw failure;
          }
          return false;
        },
      });
      const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
      const { client, fetch } = createClient(tokenProvider);
      const pending = observe(client.models.list({ signal }));

      await nextTurn();
      const waiting = Symbol('aborted getter failure did not settle');
      expect(await Promise.race([pending, Promise.resolve(waiting)])).toBe(failure);
      expect(tokenProvider).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
    },
  );

  test('preserves typed cancellation when the signal cleanup method itself throws', async () => {
    const controller = new AbortController();
    const signal = structuralSignal(controller);
    throwAfterRemovingOnce(signal);
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider);
    const pending = observe(client.models.list({ signal }));

    await waitForProvider(tokenProvider);
    controller.abort(new Error('caller still wins'));

    await expectImmediateCancellation(pending, controller.signal, fetch);
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });

  test('preserves provider rejection when its cancellation-listener cleanup throws', async () => {
    const controller = new AbortController();
    const signal = structuralSignal(controller);
    throwAfterRemovingOnce(signal);
    const failure = new Error('private token service unavailable');
    const tokenProvider: TokenProvider = async () => {
      throw failure;
    };
    const { client, fetch } = createClient(tokenProvider);

    await expect(client.models.list({ signal })).rejects.toMatchObject({
      message: 'Failed to resolve a bearer credential for Bedrock.',
      cause: failure,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
    controller.abort();
  });

  test('preserves successful credentials when their cancellation-listener cleanup throws', async () => {
    const controller = new AbortController();
    const signal = structuralSignal(controller);
    throwAfterRemovingOnce(signal);
    const tokenProvider = vi.fn<TokenProvider>(async () => 'valid-bearer-token');
    const { client, fetch } = createClient(tokenProvider);

    await expect(client.models.list({ signal })).resolves.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    const providerListener = vi.mocked(signal.removeEventListener).mock.calls[0]?.[1];
    expect(providerListener).toBeDefined();
    expect(getEventListeners(controller.signal, 'abort')).not.toContain(providerListener);
    controller.abort();
  });

  test('preserves a structural cancellation reason getter that throws NaN', async () => {
    const controller = new AbortController();
    const signal = structuralSignal(controller);
    Object.defineProperty(signal, 'reason', {
      configurable: true,
      get() {
        throw Number.NaN;
      },
    });
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider);
    const pending = observe(client.models.list({ signal }));

    await waitForProvider(tokenProvider);
    controller.abort();
    await nextTurn();

    const waiting = Symbol('NaN reason getter prevented settlement');
    expect(await Promise.race([pending, Promise.resolve(waiting)])).toBe(Number.NaN);
    expect(fetch).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });

  test('settles the original failure when a structural reason getter throws', async () => {
    const controller = new AbortController();
    const signal = structuralSignal(controller);
    const failure = new Error('structural reason getter failed');
    Object.defineProperty(signal, 'reason', {
      configurable: true,
      get() {
        throw failure;
      },
    });
    const tokenProvider = vi.fn<TokenProvider>(() => Promise.race([]));
    const { client, fetch } = createClient(tokenProvider);
    const pending = observe(client.models.list({ signal }));

    await waitForProvider(tokenProvider);
    controller.abort();

    await nextTurn();
    const waiting = Symbol('reason getter prevented settlement');
    const result = await Promise.race([pending, Promise.resolve(waiting)]);
    expect(result).toBe(failure);
    expect(fetch).not.toHaveBeenCalled();
  });
});
