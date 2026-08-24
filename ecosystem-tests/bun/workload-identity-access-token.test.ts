import OpenAI, { OpenAIError } from 'openai';
import { expect, test } from 'bun:test';

const OAUTH_URL = 'https://auth.openai.com/oauth/token';
const SAFE_ERROR = "Token exchange response missing 'access_token' field";

type TokenType = 'jwt' | 'id';

function createLoopbackClient(token: string, tokenType: TokenType) {
  const requests = {
    exchange: 0,
    api: 0,
    provider: 0,
    authorization: null as string | null,
  };

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === '/oauth/token') {
        requests.exchange += 1;
        return Response.json({ access_token: token, expires_in: 3600 });
      }

      requests.api += 1;
      requests.authorization = request.headers.get('authorization');
      return Response.json({ object: 'list', data: [] });
    },
  });

  const client = new OpenAI({
    apiKey: null,
    baseURL: new URL('/v1', server.url).toString(),
    maxRetries: 0,
    fetch(input, init) {
      const requestedURL = String(input);
      const target = new URL(
        requestedURL === OAUTH_URL ? '/oauth/token' : requestedURL,
        server.url,
      );
      if (target.origin !== server.url.origin) {
        throw new Error('The Bun workload-identity regression only permits loopback requests.');
      }
      return globalThis.fetch(target, init);
    },
    workloadIdentity: {
      identityProviderId: 'safe-identity-provider',
      serviceAccountId: 'safe-service-account',
      provider: {
        tokenType,
        getToken: () => {
          requests.provider += 1;
          return Promise.resolve('safe-subject-token');
        },
      },
    },
  });

  return { client, requests, server };
}

async function expectPrivateRejection(client: OpenAI, token: string): Promise<void> {
  let failure: unknown;

  try {
    await client.models.list();
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(OpenAIError);
  if (!(failure instanceof Error)) {
    throw new Error('Expected a sanitized workload-identity authentication failure.');
  }
  expect(failure.message).toBe(SAFE_ERROR);
  expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();
  expect(failure.message).not.toContain(token);
  expect(failure.stack ?? '').not.toContain(token);
}

for (const tokenType of ['jwt', 'id'] as const) {
  for (const byte of [0x80, 0xff]) {
    test(`Bun rejects ${tokenType} obs-text byte 0x${byte.toString(16)} before native dispatch or caching`, async () => {
      const token = `safe-${String.fromCodePoint(byte)}-token`;
      const { client, requests, server } = createLoopbackClient(token, tokenType);

      try {
        await expectPrivateRejection(client, token);
        expect([requests.exchange, requests.api, requests.provider]).toEqual([1, 0, 1]);
        expect(requests.authorization).toBeNull();

        await expectPrivateRejection(client, token);
        expect([requests.exchange, requests.api, requests.provider]).toEqual([2, 0, 2]);
      } finally {
        server.stop(true);
      }
    });
  }

  for (const { name, token } of [
    { name: 'ascii', token: 'safe-bun-ascii-token' },
    { name: 'internal HTTP space', token: 'safe bun ascii token' },
    { name: 'internal HTTP tab', token: 'safe\tbun\ttoken' },
  ]) {
    test(`Bun sends the exact ${tokenType} ${name} bearer through its native loopback transport`, async () => {
      const { client, requests, server } = createLoopbackClient(token, tokenType);

      try {
        await client.models.list();
        expect([requests.exchange, requests.api, requests.provider]).toEqual([1, 1, 1]);
        expect(requests.authorization).toBe(`Bearer ${token}`);
      } finally {
        server.stop(true);
      }
    });
  }
}
