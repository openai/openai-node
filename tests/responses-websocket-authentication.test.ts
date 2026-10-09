import { once } from 'node:events';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';

import OpenAI from 'openai';
import { ResponsesWS as StableResponsesWS } from 'openai/resources/responses/ws';
import { ResponsesWS as BetaResponsesWS } from 'openai/resources/beta/responses/ws';

async function inspectHandshake(
  Responses: typeof StableResponsesWS | typeof BetaResponsesWS,
  makeClient: (baseURL: string) => OpenAI,
  options: ConstructorParameters<typeof StableResponsesWS>[1],
): Promise<IncomingHttpHeaders> {
  let received: IncomingHttpHeaders | undefined;
  const server = createServer((request, response) => {
    request.resume();
    received = request.headers;
    response.writeHead(401);
    response.end();
  });
  await once(server.listen(0, '127.0.0.1'), 'listening');

  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a local HTTP server');
    }
    const connection = new Responses(makeClient(`http://127.0.0.1:${address.port}/v1`), options);
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- The shared error-listener contract bridges the different stable and beta WebSocket event APIs.
    const errorEmitter: { on: (event: 'error', listener: (error: Error) => void) => void } = connection;
    errorEmitter.on('error', () => {});
    await once(connection.socket.platformSocket, 'error');
    if (!received) {
      throw new Error('Expected a WebSocket handshake');
    }
    return received;
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
}

describe.each([
  { name: 'stable', Responses: StableResponsesWS },
  { name: 'beta', Responses: BetaResponsesWS },
])('$name Responses WebSocket authentication', ({ Responses }) => {
  test.each(['X-Auth-Token', 'X-Custom'])(
    'sends caller-supplied %s with an unresolved function api key',
    async (headerName) => {
      const headers = await inspectHandshake(
        Responses,
        (baseURL) => new OpenAI({ baseURL, apiKey: async () => 'SYNTHETIC_KEY' }),
        { headers: { [headerName]: 'SYNTHETIC_TOKEN' } },
      );
      expect(headers[headerName.toLowerCase()]).toBe('SYNTHETIC_TOKEN');
    },
  );

  test.each([
    {
      name: 'undefined',
      value: undefined,
      expectedAuthorization: 'Bearer SYNTHETIC_KEY',
      expectedCustom: 'client-default',
    },
    { name: 'null', value: null, expectedAuthorization: undefined, expectedCustom: undefined },
    { name: 'empty string', value: '', expectedAuthorization: '', expectedCustom: '' },
  ])(
    'preserves $name header override semantics on the wire',
    async ({ value, expectedAuthorization, expectedCustom }) => {
      const headers = await inspectHandshake(
        Responses,
        (baseURL) =>
          new OpenAI({
            baseURL,
            apiKey: 'SYNTHETIC_KEY',
            defaultHeaders: { 'X-Client-Default': 'client-default' },
          }),
        // JavaScript callers can use the SDK's undefined/no-override and null/removal semantics.
        // SAFETY: These intentional non-string fixtures exercise the public JavaScript header boundary.
        { headers: { Authorization: value as string, 'X-Client-Default': value as string } },
      );
      expect(headers.authorization).toBe(expectedAuthorization);
      expect(headers['x-client-default']).toBe(expectedCustom);
    },
  );

  test('preserves Basic authentication for an empty static api key', async () => {
    const headers = await inspectHandshake(
      Responses,
      (baseURL) => new OpenAI({ baseURL, apiKey: '', adminAPIKey: 'SYNTHETIC_ADMIN_KEY' }),
      { auth: 'user:pass' },
    );
    expect(headers.authorization).toBe('Basic dXNlcjpwYXNz');
  });

  test('sends the same serialized credential that was validated', async () => {
    let serializations = 0;
    const credential = {
      toString() {
        serializations += 1;
        return serializations === 1 ? 'Bearer SYNTHETIC_TOKEN' : '';
      },
    };
    const headers = await inspectHandshake(
      Responses,
      (baseURL) => new OpenAI({ baseURL, apiKey: async () => 'SYNTHETIC_KEY' }),
      // JavaScript callers can pass values that Node serializes into header strings.
      // SAFETY: The credential fixture intentionally passes a non-string value to verify Node header serialization and credential rejection.
      { headers: { Authorization: credential as string } },
    );
    expect(headers.authorization).toBe('Bearer SYNTHETIC_TOKEN');
    expect(serializations).toBe(1);
  });
});
