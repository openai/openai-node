import { vi } from 'vitest';
import OpenAI from 'openai';

function createLogger() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

describe('response debug logging', () => {
  test.each(['create', 'rotate'] as const)(
    'redacts the %s signing secret without changing the response',
    async (operation) => {
      const logger = createLogger();
      const body = {
        id: 'whe_synthetic',
        object: 'webhook_endpoint',
        name: 'Synthetic endpoint',
        url: 'https://example.com/webhook',
        created_at: 1,
        event_types: ['batch.completed'],
        signing_secret: 'whsec_synthetic_log_redaction',
      };
      const client = new OpenAI({
        apiKey: 'synthetic-api-key',
        logLevel: 'debug',
        logger,
        fetch: async () => Response.json(body, { headers: { 'x-request-id': 'req_synthetic' } }),
      });

      const request =
        operation === 'create'
          ? client.webhooks.create({ name: body.name, url: body.url, event_types: ['batch.completed'] })
          : client.webhooks.rotateSecret(body.id);
      const response = await request;

      expect(response).toEqual(body);
      expect(response.signing_secret).toBe(body.signing_secret);
      expect(response._request_id).toBe('req_synthetic');
      const dataAndResponse = await request.withResponse();
      expect(dataAndResponse.data).toBe(response);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('response parsed'),
        expect.objectContaining({ body: { ...body, signing_secret: '***' } }),
      );
      for (const log of Object.values(logger)) {
        expect(JSON.stringify(log.mock.calls)).not.toContain(body.signing_secret);
      }
    },
  );

  test('redacts credential fields in nested JSON without changing ordinary data', async () => {
    const logger = createLogger();
    const body = {
      data: [{ signing_secret: 'synthetic-nested-secret', count: 0, enabled: false }],
      credentials: { API_Key: 'synthetic-nested-key', password: 'synthetic-password' },
      empty: '',
      absent: null,
    };
    const client = new OpenAI({
      apiKey: 'synthetic-api-key',
      logLevel: 'debug',
      logger,
      fetch: async () => Response.json(body),
    });

    expect(await client.get('/example')).toEqual(body);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('response parsed'),
      expect.objectContaining({
        body: {
          data: [{ signing_secret: '***', count: 0, enabled: false }],
          credentials: { API_Key: '***', password: '***' },
          empty: '',
          absent: null,
        },
      }),
    );
    const logs = JSON.stringify(logger.debug.mock.calls);
    expect(logs).not.toContain('synthetic-nested-secret');
    expect(logs).not.toContain('synthetic-nested-key');
    expect(logs).not.toContain('synthetic-password');
  });

  test.each(['debug', 'off'] as const)(
    'accepts deeply nested response JSON with logging %s',
    async (logLevel) => {
      const logger = createLogger();
      const depth = 20_000;
      const json = `${'{"value":'.repeat(depth)}{"signing_secret":"synthetic-deep-secret"}${'}'.repeat(depth)}`;
      const client = new OpenAI({
        apiKey: 'synthetic-api-key',
        logLevel,
        logger,
        fetch: async () => new Response(json, { headers: { 'content-type': 'application/json' } }),
      });

      await expect(client.get('/example')).resolves.toBeDefined();
      if (logLevel === 'off') {
        expect(logger.debug).not.toHaveBeenCalled();
      }
    },
  );

  test('preserves own prototype-named properties in the redacted copy', async () => {
    const logger = createLogger();
    const json = '{"__proto__":{"signing_secret":"synthetic-prototype-secret"}}';
    const client = new OpenAI({
      apiKey: 'synthetic-api-key',
      logLevel: 'debug',
      logger,
      fetch: async () => new Response(json, { headers: { 'content-type': 'application/json' } }),
    });

    const response = await client.get('/example');
    expect(Object.getPrototypeOf(response)).toBe(Object.prototype);
    expect(response).toEqual(JSON.parse(json));
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('response parsed'),
      expect.objectContaining({ body: JSON.parse('{"__proto__":{"signing_secret":"***"}}') }),
    );
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('synthetic-prototype-secret');
    expect(Object.prototype).not.toHaveProperty('signing_secret');
  });

  test('keeps raw binary response objects unchanged', async () => {
    const logger = createLogger();
    const raw = new Response('synthetic binary data');
    const client = new OpenAI({
      apiKey: 'synthetic-api-key',
      logLevel: 'debug',
      logger,
      fetch: async () => raw,
    });

    expect(await client.get('/example', { __binaryResponse: true })).toBe(raw);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('response parsed'),
      expect.objectContaining({ body: raw }),
    );
    expect(raw.bodyUsed).toBe(false);
  });
});
