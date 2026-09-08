/* oxlint-disable max-classes-per-file -- Each class exercises a distinct protected dispatch boundary. */
import OpenAI from 'openai';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

const clientOptions = (fetch: typeof globalThis.fetch) => ({
  ...createTestClientOptions(),
  apiKey: null,
  adminAPIKey: null,
  fetch,
  maxRetries: 0,
});

function nativeClone(this: Response) {
  return Response.prototype.clone.call(this);
}

function replacementClone(this: Response) {
  return Response.prototype.clone.call(this);
}

test.each([false, true])(
  'retires a response clone tracker after its accessor %s its descriptor',
  async (replaceDescriptor) => {
    const cached = new Response(null, { status: 401 });
    let method = nativeClone;
    Object.defineProperty(cached, 'clone', {
      configurable: true,
      get() {
        return method;
      },
      set(this: Response, value: typeof method) {
        if (replaceDescriptor) {
          Object.defineProperty(this, 'clone', { value, configurable: true, writable: true });
        } else {
          method = value;
        }
      },
    });
    let warmup = true;
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [url, init, timeout, , context] = args;
        const response = await super.fetchWithTimeout(...args);
        if (warmup) {
          response.clone = replacementClone;
          return new Response(null);
        }
        await super.fetchWithTimeout(
          url,
          { ...init, headers: { Authorization: 'Bearer independent' } },
          timeout,
          new AbortController(),
          context,
        );
        return response.clone().clone();
      }
    }
    const transport = createWorkloadIdentityTransport((_url, init) =>
      new Headers(init?.headers).get('Authorization') === 'Bearer access-token-1'
        ? cached
        : new Response(null),
    );
    const client = new HookClient(clientOptions(transport.fetch));

    await client.get('/warmup').asResponse();
    warmup = false;
    await expect(client.get('/synthetic').asResponse()).resolves.toMatchObject({ status: 200 });
    expect(transport.exchanges).toBe(2);
  },
);

test('does not attribute an accessor clone when its owner and invocation receiver disagree', async () => {
  let sends = 0;
  class HookClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      const [url, init, timeout, , context] = args;
      const workload = await super.fetchWithTimeout(...args);
      const independent = await super.fetchWithTimeout(
        url,
        { ...init, headers: { Authorization: 'Bearer independent' } },
        timeout,
        new AbortController(),
        context,
      );
      return Reflect.apply(workload.clone, independent, []);
    }
  }
  const transport = createWorkloadIdentityTransport(() => {
    sends += 1;
    const response = new Response(null, { status: 401 });
    Object.defineProperty(response, 'clone', {
      configurable: true,
      get() {
        return Response.prototype.clone;
      },
    });
    return response;
  });
  const client = new HookClient(clientOptions(transport.fetch));

  await expect(client.get('/synthetic').asResponse()).rejects.toMatchObject({ status: 401 });
  expect({ sends, exchanges: transport.exchanges }).toEqual({ sends: 2, exchanges: 1 });
});

test.each([false, true])(
  'attributes a clone returned by a bound accessor when detached: %s',
  async (detached) => {
    class HookClient extends OpenAI {
      override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
        const [url, init, timeout, , context] = args;
        const response = await super.fetchWithTimeout(...args);
        await super.fetchWithTimeout(
          url,
          { ...init, headers: { Authorization: 'Bearer independent' } },
          timeout,
          new AbortController(),
          context,
        );
        const { clone } = response;
        return detached ? clone() : response.clone();
      }
    }
    const transport = createWorkloadIdentityTransport((_url, init) => {
      const response = new Response(null, {
        status: new Headers(init?.headers).get('Authorization') === 'Bearer access-token-1' ? 401 : 200,
      });
      Object.defineProperty(response, 'clone', {
        configurable: true,
        get(this: Response) {
          return Response.prototype.clone.bind(this);
        },
      });
      return response;
    });

    await expect(
      new HookClient(clientOptions(transport.fetch)).get('/synthetic').asResponse(),
    ).resolves.toMatchObject({
      status: 200,
    });
    expect(transport.exchanges).toBe(2);
  },
);

test.each(
  (['own', 'inherited'] as const).flatMap((placement) =>
    [false, true].map((configurable) => ({ placement, configurable })),
  ),
)('preserves a nonwritable response clone descriptor: %j', async ({ placement, configurable }) => {
  const response = new Response(null);
  const target = placement === 'own' ? response : Object.create(Response.prototype);
  if (placement === 'inherited') {
    Object.setPrototypeOf(response, target);
  }
  Object.defineProperty(target, 'clone', { value: nativeClone, writable: false, configurable });
  let changed: boolean | undefined;
  class HookClient extends OpenAI {
    override async fetchWithTimeout(...args: Parameters<OpenAI['fetchWithTimeout']>) {
      const result = await super.fetchWithTimeout(...args);
      changed = Reflect.set(result, 'clone', () => new Response(null));
      return result;
    }
  }
  const transport = createWorkloadIdentityTransport(() => response);

  await new HookClient(clientOptions(transport.fetch)).get('/synthetic').asResponse();
  expect(changed).toBe(false);
  expect(response.clone).toBe(nativeClone);
});
