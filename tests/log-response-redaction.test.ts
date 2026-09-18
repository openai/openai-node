import { expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { compiledFixture } from './utils/compiled-fixtures';
import OpenAI from 'openai';
import type { WebhookCreateParams } from 'openai/resources/webhooks/webhooks';

function createLogger() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

describe('response debug logging', () => {
  test.each([null, false, 0, '', 'synthetic-secret', [0, false, null], { value: 'synthetic-secret' }])(
    'summarizes JSON response %j without changing its value',
    async (body) => {
      const logger = createLogger();
      const json = JSON.stringify(body);
      const client = new OpenAI({
        apiKey: 'synthetic-api-key',
        logLevel: 'debug',
        logger,
        fetch: async () => new Response(json, { headers: { 'content-type': 'application/json' } }),
      });
      expect(await client.get('/example')).toEqual(body);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('response parsed'),
        expect.objectContaining({ body: { type: 'json', length: json.length } }),
      );
      expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('synthetic-secret');
    },
  );

  test.each(['array', 'object'])('logs wide JSON %s bodies within a bounded heap', (container) => {
    const result = spawnSync(
      process.execPath,
      [
        '--max-old-space-size=128',
        '-e',
        `
          const assert = require('node:assert/strict');
          const OpenAI = require(process.argv[1]).default;
          const count = 250_000;
          const values = process.argv[2] === 'array' ? Array(count).fill(0) : {};
          if (!Array.isArray(values)) {
            for (let index = 0; index < count; index++) values[index] = 0;
          }
          const body = { values, signing_secret: 'synthetic-secret', url: 'https://example.com/hook' };
          const json = JSON.stringify(body);
          let requests = 0;
          let responses = 0;
          const logger = {
            error() {}, warn() {}, info() {},
            debug(message, details) {
              if (message.includes('sending request')) {
                assert.deepEqual(details.options.body, { type: 'string', length: json.length });
                requests++;
                return;
              }
              const logged = details.body;
              if (!logged) return;
              assert.deepEqual(logged, { type: 'json', length: json.length });
              if (message.includes('response parsed')) responses++;
            },
          };
          const client = new OpenAI({
            apiKey: 'synthetic-api-key', logLevel: 'debug', logger,
            fetch: async (_url, options) => {
              assert.equal(options.body, json);
              return new Response(json, { headers: { 'content-type': 'application/json' } });
            },
          });
          client.post('/example', { body }).then(response => {
            assert.equal(JSON.stringify(response), json);
            assert.equal(body.signing_secret, 'synthetic-secret');
            assert.equal(requests, 1);
            assert.equal(responses, 1);
          }).catch(error => { console.error(error); process.exitCode = 1; });
        `,
        compiledFixture('src', 'index.ts'),
        container,
      ],
      { encoding: 'utf-8', timeout: 15_000, env: { ...process.env, NODE_OPTIONS: '' } },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
  });

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
        expect.objectContaining({ body: { type: 'json', length: JSON.stringify(body).length } }),
      );
      expect(JSON.stringify(logger.debug.mock.calls)).not.toContain(body.signing_secret);
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
        body: { type: 'json', length: JSON.stringify(body).length },
      }),
    );
    const logs = JSON.stringify(logger.debug.mock.calls);
    expect(logs).not.toContain('synthetic-nested-secret');
    expect(logs).not.toContain('synthetic-nested-key');
    expect(logs).not.toContain('synthetic-password');
  });

  test.each(['create', 'retrieve'] as const)(
    'redacts credentials in %s endpoint URL diagnostics',
    async (operation) => {
      const logger = createLogger();
      const url =
        'https://synthetic-user:synthetic-password@example.com/webhook?token=synthetic-query-token&view=summary#synthetic-fragment';
      const body = {
        id: 'whe_synthetic',
        object: 'webhook_endpoint',
        name: 'Synthetic endpoint',
        url,
        created_at: 1,
        event_types: ['batch.completed'],
        signing_secret: 'synthetic-signing-secret',
      };
      const fetch = vi.fn(async () => Response.json(body));
      const client = new OpenAI({ apiKey: 'synthetic-api-key', logLevel: 'debug', logger, fetch });

      const response =
        operation === 'create'
          ? await client.webhooks.create({ name: body.name, url, event_types: ['batch.completed'] })
          : await client.webhooks.retrieve(body.id);
      expect(response.url).toBe(url);
      if (operation === 'create') {
        expect(fetch).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            body: JSON.stringify({ name: body.name, url, event_types: ['batch.completed'] }),
          }),
        );
      }
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('response parsed'),
        expect.objectContaining({
          body: { type: 'json', length: JSON.stringify(body).length },
        }),
      );
      const diagnostics = JSON.stringify(logger.debug.mock.calls);
      for (const secret of [
        'synthetic-user',
        'synthetic-password',
        'synthetic-query-token',
        'synthetic-fragment',
      ]) {
        expect(diagnostics).not.toContain(secret);
      }
    },
  );

  test.each(['class', 'custom prototype', 'cross realm'] as const)(
    'redacts serialized %s request parameters without changing the request',
    async (kind) => {
      const logger = createLogger();
      const body = {
        name: 'Synthetic endpoint',
        url: 'https://example.com/webhook?token=synthetic-prototype-token',
        event_types: ['batch.completed'] satisfies WebhookCreateParams['event_types'],
        signing_secret: 'synthetic-prototype-signing-secret',
      };
      let params: WebhookCreateParams;
      if (kind === 'class') {
        params = new (class {
          name = body.name;
          url = body.url;
          event_types = body.event_types;
          signing_secret = body.signing_secret;
        })();
      } else if (kind === 'custom prototype') {
        params = Object.setPrototypeOf({ ...body }, { inherited: 'not serialized' });
      } else {
        params = runInNewContext('({ ...body })', { body });
      }
      const fetch = vi.fn(async () => Response.json({ id: 'whe_synthetic', url: body.url }));
      const client = new OpenAI({ apiKey: 'synthetic-api-key', logLevel: 'debug', logger, fetch });

      await client.webhooks.create(params);

      expect(fetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ body: JSON.stringify(body) }),
      );
      expect(params.url).toBe(body.url);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('sending request'),
        expect.objectContaining({
          options: expect.objectContaining({
            body: { type: 'string', length: JSON.stringify(body).length },
          }),
        }),
      );
      const diagnostics = JSON.stringify(logger.debug.mock.calls);
      expect(diagnostics).not.toContain('synthetic-prototype-token');
      expect(diagnostics).not.toContain(body.signing_secret);
    },
  );

  test('summarizes the serialized request without invoking toJSON again', async () => {
    const logger = createLogger();
    let serializations = 0;
    const params = {
      name: 'Synthetic endpoint',
      url: 'https://example.com/webhook',
      event_types: ['batch.completed'] satisfies WebhookCreateParams['event_types'],
      toJSON() {
        serializations += 1;
        return { ...this, url: 'https://example.com/webhook?token=synthetic-serialized-token' };
      },
    };
    const client = new OpenAI({
      apiKey: 'synthetic-api-key',
      logLevel: 'debug',
      logger,
      fetch: async () => Response.json({ id: 'whe_synthetic' }),
    });

    await client.webhooks.create(params);

    expect(serializations).toBe(1);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('sending request'),
      expect.objectContaining({
        options: expect.objectContaining({
          body: { type: 'string', length: expect.any(Number) },
        }),
      }),
    );
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('synthetic-serialized-token');
    expect(serializations).toBe(1);
  });

  test.each([
    ['application/json', '{"signing_secret":"synthetic-secret"}'],
    ['text/plain', '{"signing_secret":"synthetic-secret"}'],
    ['text/plain', 'synthetic plain text'],
  ])('summarizes a raw string request with content type %s', async (contentType, body) => {
    const logger = createLogger();
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = new OpenAI({ apiKey: 'synthetic-api-key', logLevel: 'debug', logger, fetch });

    await client.post('/example', { body, headers: { 'content-type': contentType } });

    expect(fetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ body }));
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('sending request'),
      expect.objectContaining({
        options: expect.objectContaining({ body: { type: 'string', length: body.length } }),
      }),
    );
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('synthetic-secret');
  });

  test('keeps non-JSON request bodies unchanged', async () => {
    const logger = createLogger();
    const body = new FormData();
    body.set('ordinary', 'synthetic multipart content');
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    const client = new OpenAI({ apiKey: 'synthetic-api-key', logLevel: 'debug', logger, fetch });

    await client.post('/example', { body });

    expect(fetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ body }));
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('sending request'),
      expect.objectContaining({ options: expect.objectContaining({ body }) }),
    );
    expect(body.get('ordinary')).toBe('synthetic multipart content');
  });

  test('masks malformed URL strings in diagnostics without changing the response', async () => {
    const logger = createLogger();
    const body = { url: 'not a valid URL', text: 'ordinary response text' };
    const client = new OpenAI({
      apiKey: 'synthetic-api-key',
      logLevel: 'debug',
      logger,
      fetch: async () => Response.json(body),
    });

    expect(await client.get('/example')).toEqual(body);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('response parsed'),
      expect.objectContaining({ body: { type: 'json', length: JSON.stringify(body).length } }),
    );
  });

  test.each(['create', 'retrieve', 'list'] as const)(
    'masks the complete %s endpoint URL in JSON diagnostics',
    async (operation) => {
      const logger = createLogger();
      const url = 'https://hooks.example.com/services/account/synthetic-capability-token';
      const endpoint = {
        id: 'whe_synthetic',
        object: 'webhook_endpoint',
        name: 'Synthetic endpoint',
        url,
        created_at: 1,
        event_types: ['batch.completed'] satisfies WebhookCreateParams['event_types'],
      };
      const body = operation === 'list' ? { object: 'list', data: [endpoint], has_more: false } : endpoint;
      const fetch = vi.fn(async () => Response.json(body));
      const client = new OpenAI({ apiKey: 'synthetic-api-key', logLevel: 'debug', logger, fetch });
      const params = { name: endpoint.name, url, event_types: endpoint.event_types };
      const requests = {
        create: () => client.webhooks.create(params),
        retrieve: () => client.webhooks.retrieve(endpoint.id),
        list: () => client.webhooks.list(),
      };

      const response = await requests[operation]();
      const returned = 'data' in response ? response.data[0] : response;

      expect(returned?.url).toBe(url);
      expect(params.url).toBe(url);
      if (operation === 'create') {
        expect(fetch).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ body: JSON.stringify(params) }),
        );
      }
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('response parsed'),
        expect.objectContaining({
          body: { type: 'json', length: JSON.stringify(body).length },
        }),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('sending request'),
        expect.objectContaining({
          url: `${client.baseURL}/webhook_endpoints${operation === 'retrieve' ? `/${endpoint.id}` : ''}`,
        }),
      );
      expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('synthetic-capability-token');
    },
  );

  test('does not invoke request-body accessors again when preparing diagnostics', async () => {
    const logger = createLogger();
    const url = 'https://example.com/webhook?token=synthetic-accessor-token';
    let reads = 0;
    const client = new OpenAI({
      apiKey: 'synthetic-api-key',
      logLevel: 'debug',
      logger,
      fetch: async () => Response.json({ id: 'whe_synthetic', url }),
    });

    const response = await client.webhooks.create({
      name: 'Synthetic endpoint',
      event_types: ['batch.completed'],
      get url() {
        reads += 1;
        if (reads > 1) {
          throw new Error('request URL accessor was re-evaluated');
        }
        return url;
      },
    });

    expect(reads).toBe(1);
    expect(response.url).toBe(url);
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('synthetic-accessor-token');
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

  test('preserves own prototype-named properties in the response', async () => {
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
      expect.objectContaining({ body: { type: 'json', length: json.length } }),
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
