import { once } from 'node:events';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { vi } from 'vitest';
import type { Mock } from 'vitest';

import OpenAI, { AzureOpenAI } from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';
import { OpenAIRealtimeWS as StableNodeRealtime } from 'openai/realtime/ws';
import { OpenAIRealtimeWS as BetaNodeRealtime } from 'openai/beta/realtime/ws';
import * as WS from 'ws';

type Listener = (event: any) => void;

interface FakeNodeSocket {
  url: URL;
  options: WS.ClientOptions;
  on: Mock;
  send: Mock;
  close: Mock;
}

vi.mock('ws', () => ({ WebSocket: vi.fn() }));

const nodeSocketConstructor = WS.WebSocket as unknown as Mock;
let actualWebSocketConstructor: typeof WS.WebSocket | undefined;

function CapturingWebSocket(url: URL, options: FakeNodeSocket['options']): FakeNodeSocket {
  return {
    url,
    options,
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
  };
}

function ActualWebSocket(url: URL, options: WS.ClientOptions): WS.WebSocket {
  if (!actualWebSocketConstructor) {
    throw new Error('Expected the real WebSocket constructor');
  }
  return new actualWebSocketConstructor(url, options);
}

function lastNodeSocket(): FakeNodeSocket {
  const [result] = nodeSocketConstructor.mock.results.slice(-1);
  const socket = result?.value as FakeNodeSocket | undefined;
  if (!socket) {
    throw new Error('Expected a WebSocket instance');
  }
  return socket;
}

function onRealtimeEvent(realtime: unknown, event: string, listener: Listener): void {
  (realtime as { on: (event: string, listener: Listener) => unknown }).on(event, listener);
}

function createClient(apiKey = 'test-key', baseURL = 'https://example.com/v1/'): OpenAI {
  return new OpenAI({ apiKey, baseURL });
}

function createAzureClient(
  options: { tokenProvider?: boolean; deployment?: string; baseURL?: string } = {},
): AzureOpenAI {
  return new AzureOpenAI({
    apiVersion: '2024-10-01-preview',
    baseURL: options.baseURL ?? 'https://azure.example.com/openai/',
    ...(options.tokenProvider
      ? { azureADTokenProvider: async () => 'azure-token' }
      : { apiKey: 'azure-key' }),
    ...(options.deployment === undefined ? {} : { deployment: options.deployment }),
  });
}

function createPlainConnection(options: { port?: number | string }): ReturnType<typeof connect> {
  return connect({ host: '127.0.0.1', port: Number(options.port) });
}

async function closeServers(...servers: ReturnType<typeof createServer>[]): Promise<void> {
  await Promise.all(
    servers.map(async (server) => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    }),
  );
}

beforeEach(() => {
  actualWebSocketConstructor = undefined;
  nodeSocketConstructor.mockReset();
  nodeSocketConstructor.mockImplementation(CapturingWebSocket);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  { name: 'stable', Realtime: StableNodeRealtime },
  { name: 'beta', Realtime: BetaNodeRealtime },
])('$name Node realtime redirect security', ({ Realtime }) => {
  test('disables explicitly enabled redirects when Azure uses a static API key', async () => {
    await Realtime.azure(createAzureClient({ deployment: 'chat' }), {
      options: {
        followRedirects: true,
        handshakeTimeout: 4321,
        headers: { 'X-Custom': 'value' },
      },
    });

    expect(lastNodeSocket().options).toMatchObject({
      followRedirects: false,
      handshakeTimeout: 4321,
      headers: { 'api-key': 'azure-key', 'X-Custom': 'value' },
    });
  });

  test.each(['api-key', 'API-Key', 'aPi-KeY', 'x-api-key', 'X-API-KEY', 'api_key', 'API_KEY', 'ApiKey'])(
    'disables redirects for the custom credential header %s',
    (header) => {
      const realtime = new Realtime(
        {
          model: 'gpt-realtime',
          options: {
            followRedirects: true,
            handshakeTimeout: 4321,
            headers: { [header]: 'custom-secret', 'X-Custom': 'value' },
          },
        },
        createClient(),
      );

      expect(realtime.socket).toBe(lastNodeSocket());
      expect(lastNodeSocket().options).toMatchObject({
        followRedirects: false,
        handshakeTimeout: 4321,
        headers: {
          [header]: 'custom-secret',
          Authorization: 'Bearer test-key',
          'X-Custom': 'value',
        },
      });
    },
  );

  test.each(['authorization', 'Cookie', 'cookie'])(
    'disables redirects for the sensitive header %s',
    (header) => {
      const realtime = new Realtime(
        {
          model: 'gpt-realtime',
          options: {
            followRedirects: true,
            handshakeTimeout: 4321,
            headers: { [header]: 'custom-secret', 'X-Custom': 'value' },
          },
        },
        createClient(),
      );

      expect(realtime.socket).toBe(lastNodeSocket());
      expect(lastNodeSocket().options).toMatchObject({
        followRedirects: false,
        handshakeTimeout: 4321,
        headers: { [header]: 'custom-secret', 'X-Custom': 'value' },
      });
    },
  );

  test('preserves generated bearer precedence while disabling redirects', () => {
    const realtime = new Realtime(
      {
        model: 'gpt-realtime',
        options: {
          followRedirects: true,
          handshakeTimeout: 4321,
          headers: { Authorization: 'custom-secret', 'X-Custom': 'value' },
        },
      },
      createClient(),
    );

    expect(realtime.socket).toBe(lastNodeSocket());
    expect(lastNodeSocket().options).toMatchObject({
      followRedirects: false,
      handshakeTimeout: 4321,
      headers: { Authorization: 'Bearer test-key', 'X-Custom': 'value' },
    });
  });

  test('disables explicitly enabled redirects for bearer-only authentication', () => {
    const realtime = new Realtime(
      {
        model: 'gpt-realtime',
        options: {
          followRedirects: true,
          handshakeTimeout: 4321,
          headers: { 'X-Custom': 'value' },
        },
      },
      createClient(),
    );

    expect(realtime.socket).toBe(lastNodeSocket());
    expect(lastNodeSocket().options).toMatchObject({
      followRedirects: false,
      handshakeTimeout: 4321,
      headers: { Authorization: 'Bearer test-key', 'X-Custom': 'value' },
    });
  });

  test('fails closed by default while preserving unrelated connection options', () => {
    const realtime = new Realtime(
      {
        model: 'gpt-realtime',
        options: { handshakeTimeout: 4321, headers: { 'X-Custom': 'value' } },
      },
      createClient(),
    );

    expect(realtime.socket).toBe(lastNodeSocket());
    expect(lastNodeSocket().options).toMatchObject({
      followRedirects: false,
      handshakeTimeout: 4321,
      headers: { Authorization: 'Bearer test-key', 'X-Custom': 'value' },
    });
  });

  test('disables redirects for Azure token-provider authentication', async () => {
    await Realtime.azure(createAzureClient({ deployment: 'chat', tokenProvider: true }), {
      options: { followRedirects: true, headers: { 'X-Custom': 'value' } },
    });

    expect(lastNodeSocket().options).toMatchObject({
      followRedirects: false,
      headers: { Authorization: 'Bearer azure-token', 'X-Custom': 'value' },
    });
  });

  test.each([302, 307, 308])(
    'does not disclose a static Azure API key across an HTTP %i redirect',
    async (status) => {
      const apiKey = 'AZURE_STATIC_SECRET';
      const sourceAPIKeys: (string | string[] | undefined)[] = [];
      const disclosedAPIKeys: (string | string[] | undefined)[] = [];
      let redirectURL = '';

      const destination = createServer((request, response) => {
        request.resume();
        disclosedAPIKeys.push(request.headers['api-key']);
        response.writeHead(200);
        response.end();
      });

      const source = createServer((request, response) => {
        request.resume();
        sourceAPIKeys.push(request.headers['api-key']);
        response.writeHead(status, { location: redirectURL });
        response.end();
      });

      try {
        await Promise.all([
          once(destination.listen(0, '127.0.0.1'), 'listening'),
          once(source.listen(0, '127.0.0.1'), 'listening'),
        ]);

        const destinationAddress = destination.address();
        const sourceAddress = source.address();

        if (
          !destinationAddress ||
          typeof destinationAddress === 'string' ||
          !sourceAddress ||
          typeof sourceAddress === 'string'
        ) {
          throw new Error('Expected both redirect test servers to bind ephemeral TCP ports');
        }

        redirectURL = `ws://127.0.0.1:${destinationAddress.port}/attacker`;

        const actualWS = await vi.importActual<typeof WS>('ws');
        actualWebSocketConstructor = actualWS.WebSocket;
        nodeSocketConstructor.mockImplementationOnce(ActualWebSocket);

        const client = new AzureOpenAI({
          apiVersion: '2024-10-01-preview',
          baseURL: `https://127.0.0.1:${sourceAddress.port}/openai/`,
          deployment: 'chat',
          apiKey,
        });
        const realtime = await Realtime.azure(client, {
          options: {
            followRedirects: true,
            createConnection: createPlainConnection as typeof connect,
          },
        });
        const errors = vi.fn();
        onRealtimeEvent(realtime, 'error', errors);

        await once(realtime.socket, 'error');
        expect(disclosedAPIKeys).toEqual([]);
        expect(sourceAPIKeys).toEqual([apiKey]);
        expect(errors).toHaveBeenCalledWith(
          expect.objectContaining({ message: `Unexpected server response: ${status}` }),
        );
      } finally {
        await closeServers(source, destination);
      }
    },
  );

  test('does not disclose a bearer token when a redirect listener is registered', async () => {
    const apiKey = 'BEARER_SECRET';
    const sourceAuthorizations: (string | undefined)[] = [];
    const disclosedAuthorizations: (string | undefined)[] = [];
    let redirectURL = '';

    const destination = createServer((request, response) => {
      request.resume();
      disclosedAuthorizations.push(request.headers.authorization);
      response.writeHead(200);
      response.end();
    });

    const source = createServer((request, response) => {
      request.resume();
      sourceAuthorizations.push(request.headers.authorization);
      response.writeHead(302, { location: redirectURL });
      response.end();
    });

    try {
      await Promise.all([
        once(destination.listen(0, '127.0.0.1'), 'listening'),
        once(source.listen(0, '127.0.0.1'), 'listening'),
      ]);

      const destinationAddress = destination.address();
      const sourceAddress = source.address();

      if (
        !destinationAddress ||
        typeof destinationAddress === 'string' ||
        !sourceAddress ||
        typeof sourceAddress === 'string'
      ) {
        throw new Error('Expected both redirect test servers to bind ephemeral TCP ports');
      }

      redirectURL = `ws://127.0.0.1:${destinationAddress.port}/attacker`;

      const actualWS = await vi.importActual<typeof WS>('ws');
      actualWebSocketConstructor = actualWS.WebSocket;
      nodeSocketConstructor.mockImplementationOnce(ActualWebSocket);

      const realtime = new Realtime(
        {
          model: 'gpt-realtime',
          options: {
            followRedirects: true,
            createConnection: createPlainConnection as typeof connect,
          },
        },
        createClient(apiKey, `https://127.0.0.1:${sourceAddress.port}/v1/`),
      );
      const redirects = vi.fn();
      const errors = vi.fn();
      realtime.socket.on('redirect', redirects);
      onRealtimeEvent(realtime, 'error', errors);

      await once(realtime.socket, 'error');
      expect(disclosedAuthorizations).toEqual([]);
      expect(sourceAuthorizations).toEqual([`Bearer ${apiKey}`]);
      expect(redirects).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Unexpected server response: 302' }),
      );
    } finally {
      await closeServers(source, destination);
    }
  });
});

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses WebSocket redirect security', ({ Responses }) => {
  test.each([
    {
      name: 'generated bearer authorization',
      client: () => new OpenAI({ apiKey: 'BEARER_SECRET' }),
      options: {},
      header: 'authorization',
      value: 'Bearer BEARER_SECRET',
    },
    {
      name: 'caller Basic auth',
      client: () => new OpenAI({ apiKey: null, adminAPIKey: 'admin-only' }),
      options: { auth: 'user:pass' },
      header: 'authorization',
      value: 'Basic dXNlcjpwYXNz',
    },
    {
      name: 'caller proxy authorization',
      client: () => new OpenAI({ apiKey: null, adminAPIKey: 'admin-only' }),
      options: { headers: { 'Proxy-Authorization': 'Basic PROXY_SECRET' } },
      header: 'proxy-authorization',
      value: 'Basic PROXY_SECRET',
    },
    {
      name: 'caller cookie',
      client: () => new OpenAI({ apiKey: null, adminAPIKey: 'admin-only' }),
      options: { headers: { Cookie: 'session=COOKIE_SECRET' } },
      header: 'cookie',
      value: 'session=COOKIE_SECRET',
    },
    {
      name: 'caller API key',
      client: () => new OpenAI({ apiKey: null, adminAPIKey: 'admin-only' }),
      options: { headers: { 'X-API-Key': 'API_KEY_SECRET' } },
      header: 'x-api-key',
      value: 'API_KEY_SECRET',
    },
  ])(
    'does not disclose $name across a redirect with a public listener',
    async ({ client, options, header, value }) => {
      const sourceCredentials: (string | undefined)[] = [];
      const destinationRequests: (string | undefined)[] = [];
      let redirectURL = '';

      const destination = createServer((request, response) => {
        request.resume();
        destinationRequests.push(request.headers[header] as string | undefined);
        response.writeHead(200);
        response.end();
      });
      const source = createServer((request, response) => {
        request.resume();
        sourceCredentials.push(request.headers[header] as string | undefined);
        response.writeHead(302, { location: redirectURL });
        response.end();
      });

      try {
        await Promise.all([
          once(destination.listen(0, '127.0.0.1'), 'listening'),
          once(source.listen(0, '127.0.0.1'), 'listening'),
        ]);
        const destinationAddress = destination.address();
        const sourceAddress = source.address();
        if (
          !destinationAddress ||
          typeof destinationAddress === 'string' ||
          !sourceAddress ||
          typeof sourceAddress === 'string'
        ) {
          throw new Error('Expected both redirect test servers to bind ephemeral TCP ports');
        }

        redirectURL = `ws://127.0.0.1:${destinationAddress.port}/attacker`;
        const actualWS = await vi.importActual<typeof WS>('ws');
        actualWebSocketConstructor = actualWS.WebSocket;
        nodeSocketConstructor.mockImplementationOnce(ActualWebSocket);

        const openAI = client();
        openAI.baseURL = `http://127.0.0.1:${sourceAddress.port}/v1`;
        const responses = new Responses(openAI, {
          ...options,
          followRedirects: true,
          createConnection: createPlainConnection as typeof connect,
        });
        const redirects = vi.fn();
        const errors = vi.fn();
        onRealtimeEvent(responses, 'error', errors);
        responses.socket.platformSocket.on('redirect', redirects);

        await once(responses.socket.platformSocket, 'error');

        expect(sourceCredentials).toEqual([value]);
        expect(destinationRequests).toEqual([]);
        expect(redirects).toHaveBeenCalledTimes(1);
        expect(errors).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'WebSocket was closed before the connection was established' }),
        );
      } finally {
        await closeServers(source, destination);
      }
    },
  );
});
