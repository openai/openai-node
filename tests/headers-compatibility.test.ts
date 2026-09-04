import { once } from 'node:events';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';

import OpenAI from 'openai';
import { Headers as UndiciHeaders } from 'undici';
import { expect, test } from 'vitest';

const headerPairs: [string, string][] = [
  ['x-custom', 'from-input'],
  ['X-Override', 'from-input'],
  ['x-repeated', 'one'],
  ['x-repeated', 'two'],
  ['x-remove', 'from-input'],
  ['entries', 'literal-entries'],
  ['get', 'literal-get'],
];

const inputs = [
  { name: 'native Headers', create: () => new Headers(headerPairs) },
  { name: 'undici Headers', create: () => new UndiciHeaders(headerPairs) },
  {
    name: 'header record',
    create: () => ({
      'x-custom': 'from-input',
      'X-Override': 'from-input',
      'x-repeated': ['one', 'two'],
      'x-remove': 'from-input',
      entries: 'literal-entries',
      get: 'literal-get',
    }),
  },
  { name: 'header pairs', create: () => headerPairs.map((pair) => [...pair]) },
];
const cases = inputs.flatMap((input) =>
  (['client defaults', 'request options'] as const).map((location) => ({ ...input, location })),
);

test.each(cases)('sends $name from $location over HTTP', async ({ name, create, location }) => {
  const requests: {
    method: string | undefined;
    url: string | undefined;
    headers: IncomingHttpHeaders;
  }[] = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, headers: { ...request.headers } });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ object: 'list', data: [] }));
  });

  try {
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await listening;
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a loopback TCP server address');
    }

    const headers = create();
    if (name === 'undici Headers') {
      expect(headers).not.toBeInstanceOf(globalThis.Headers);
    }
    const client = new OpenAI({
      apiKey: 'synthetic-header-test-key',
      organization: null,
      project: null,
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      maxRetries: 0,
      timeout: 5000,
      logLevel: 'off',
      defaultHeaders:
        location === 'client defaults'
          ? headers
          : { 'x-override': 'from-defaults', 'x-retained': 'retained' },
    });
    const result = await client.models.list({
      headers: location === 'request options' ? headers : { 'x-override': 'from-request', 'x-remove': null },
    });

    expect(result.data).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'GET', url: '/v1/models' });
    expect(requests[0]?.headers).toMatchObject({
      'x-custom': 'from-input',
      'x-override': location === 'client defaults' ? 'from-request' : 'from-input',
      'x-repeated': 'one, two',
      entries: 'literal-entries',
      get: 'literal-get',
    });
    expect(requests[0]?.headers['x-remove']).toBe(location === 'client defaults' ? undefined : 'from-input');
    if (location === 'request options') {
      expect(requests[0]?.headers['x-retained']).toBe('retained');
    }
  } finally {
    if (server.listening) {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    }
  }
});
