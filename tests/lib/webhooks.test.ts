import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { vi } from 'vitest';
import OpenAI, { InvalidWebhookSignatureError } from 'openai';
import type { ClientOptions } from 'openai';

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
  const readme = readFileSync('README.md', 'utf-8');
  const examples = [...readme.matchAll(/```(?:ts|typescript)\r?\n(?<source>[\s\S]*?)\r?\n```/gu)].map(
    (match) => match.groups?.['source'] ?? '',
  );
  const webhookExamples = examples
    .filter((source) => source.includes("from 'next/headers'") && source.includes('client.webhooks.'))
    .map((source) => ({
      source,
      method: source.includes('client.webhooks.unwrap') ? 'unwrap' : 'verifySignature',
    }));

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(timestamp * 1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('README awaits webhook verification before processing events', () => {
    expect(webhookExamples).toHaveLength(2);
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

  describe.each(webhookExamples)('README $method example', ({ source, method }) => {
    test.each([
      { headersMode: 'async', valid: true },
      { headersMode: 'async', valid: false },
      { headersMode: 'sync', valid: true },
      { headersMode: 'sync', valid: false },
    ])('handles $headersMode headers with valid signature=$valid', async ({ headersMode, valid }) => {
      const headerValues = makeHeaders(valid ? `v1,${signature}` : 'v1,not-valid-$$$');
      const headers = vi.fn(() => (headersMode === 'async' ? Promise.resolve(headerValues) : headerValues));
      const log = vi.fn();
      const error = vi.fn();
      const fetch = vi.fn(async () => {
        throw new Error('Webhook verification must not make a network request');
      });
      class OfflineOpenAI extends OpenAI {
        constructor(options: ClientOptions) {
          super({ ...options, apiKey: 'synthetic-test-key', fetch });
        }
      }
      const exported: { webhook?: (request: Request) => Promise<Response> } = {};
      const compiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true,
        },
      }).outputText;
      runInNewContext(compiled, {
        exports: exported,
        require(specifier: string) {
          if (specifier === 'openai') {
            return { __esModule: true, default: OfflineOpenAI };
          }
          if (specifier === 'next/headers') {
            return { headers };
          }
          throw new Error(`Unexpected README example import: ${specifier}`);
        },
        process: { env: { OPENAI_WEBHOOK_SECRET: secret } },
        console: { log, error },
        Response,
      });
      if (!exported.webhook) {
        throw new Error('The README example did not export its webhook handler');
      }

      const response = await exported.webhook(
        new Request('https://example.invalid/webhook', { method: 'POST', body: payload }),
      );

      expect(response.status).toBe(valid ? 200 : 400);
      expect(headers).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
      if (valid) {
        expect(await response.json()).toEqual({ message: 'ok' });
        expect(error).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
          method === 'unwrap' ? 'Response completed:' : 'Verified event:',
          method === 'unwrap' ? { id: 'resp_123' } : JSON.parse(payload),
        );
      } else {
        expect(await response.text()).toBe('Invalid signature');
        expect(log).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith(
          'Invalid webhook signature:',
          expect.any(InvalidWebhookSignatureError),
        );
      }
    });
  });
});
