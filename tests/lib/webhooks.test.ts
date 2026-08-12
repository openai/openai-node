import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import OpenAI, { InvalidWebhookSignatureError } from 'openai';

const timestamp = 1_750_861_210;
const webhookID = 'wh_685c059ae39c8190af8c71ed1022a24d';
const payload =
  '{"id": "evt_685c059ae3a481909bdc86819b066fb6", "object": "event", "created_at": 1750861210, "type": "response.completed", "data": {"id": "resp_123"}}';
const signature = 'gUAg4R2hWouRZqRQG4uJypNS8YK885G838+EHb4nKBY=';
const secret = 'whsec_RdvaYFYUXuIFuEbvZHwMfYFhUf7aMYjYcmM24+Aj40c=';

function makeHeaders(signatureHeader = `v1,${signature}`): Headers {
  return new Headers({
    'webhook-signature': signatureHeader,
    'webhook-timestamp': timestamp.toString(),
    'webhook-id': webhookID,
  });
}

async function withoutBuffer<T>(run: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
  Object.defineProperty(globalThis, 'Buffer', { configurable: true, value: undefined });

  try {
    return await run();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'Buffer', descriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'Buffer');
    }
  }
}

describe('portable webhook verification', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(timestamp * 1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('verifies prefixed webhook secrets without a Node Buffer global', async () => {
    const client = new OpenAI({ apiKey: 'test-key' });
    const headers = makeHeaders();

    await withoutBuffer(async () => {
      await expect(client.webhooks.verifySignature(payload, headers, secret)).resolves.toBeUndefined();
    });
  });

  test('verifies and unwraps webhook events without a Node Buffer global', async () => {
    const client = new OpenAI({ apiKey: 'test-key', webhookSecret: secret });
    const headers = makeHeaders();

    await withoutBuffer(async () => {
      await expect(client.webhooks.unwrap(payload, headers)).resolves.toMatchObject({
        type: 'response.completed',
        data: { id: 'resp_123' },
      });
    });
  });

  test('verifies UTF-8 webhook secrets and payloads without a Node Buffer global', async () => {
    const client = new OpenAI({ apiKey: 'test-key' });
    const unicodeSecret = 'sëcret-✓-🔑';
    const unicodePayload = '{"city":"Zürich","key":"🔑"}';
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(unicodeSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signed = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`${webhookID}.${timestamp}.${unicodePayload}`),
    );
    const signedBase64 = Buffer.from(signed).toString('base64');
    const headers = makeHeaders(`v1,${signedBase64}`);

    await withoutBuffer(async () => {
      await expect(
        client.webhooks.verifySignature(unicodePayload, headers, unicodeSecret),
      ).resolves.toBeUndefined();
    });
  });

  test('continues past malformed signatures when another signature is valid', async () => {
    const client = new OpenAI({ apiKey: 'test-key' });
    const headers = makeHeaders(`v1,not-valid-$$$ v1,${signature}`);

    await withoutBuffer(async () => {
      await expect(client.webhooks.verifySignature(payload, headers, secret)).resolves.toBeUndefined();
    });
  });

  test('rejects malformed signatures with the existing typed verification error', async () => {
    const client = new OpenAI({ apiKey: 'test-key' });
    const headers = makeHeaders('v1,not-valid-$$$');

    await withoutBuffer(async () => {
      await expect(client.webhooks.verifySignature(payload, headers, secret)).rejects.toThrow(
        InvalidWebhookSignatureError,
      );
    });
  });

  test('reports an actionable error when no base64 decoder is available', async () => {
    const client = new OpenAI({ apiKey: 'test-key' });
    const headers = makeHeaders();
    const atobDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'atob');

    await withoutBuffer(async () => {
      Object.defineProperty(globalThis, 'atob', { configurable: true, value: undefined });

      try {
        await expect(client.webhooks.verifySignature(payload, headers, secret)).rejects.toThrow(
          'Cannot decode base64 string; Expected `Buffer` or `atob` to be defined',
        );
      } finally {
        if (atobDescriptor) {
          Object.defineProperty(globalThis, 'atob', atobDescriptor);
        } else {
          Reflect.deleteProperty(globalThis, 'atob');
        }
      }
    });
  });
});

describe('webhook documentation', () => {
  test('README awaits webhook verification before processing events', () => {
    const readme = readFileSync('README.md', 'utf-8');
    const examples = readme.match(/```(?:ts|typescript)\r?\n[\s\S]*?\r?\n```/gu) ?? [];
    const calls = examples.flatMap((example) => [
      ...example.matchAll(/(?:await\s+)?client\.webhooks\.(?<method>unwrap|verifySignature)\s*\(/gu),
    ]);

    expect(calls.map((call) => call.groups?.['method'])).toEqual(
      expect.arrayContaining(['unwrap', 'verifySignature']),
    );

    for (const [call] of calls) {
      expect(call).toMatch(/^await\s+/u);
    }
  });
});
