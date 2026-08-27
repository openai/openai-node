import { vi } from 'vitest';

import { APIConnectionError, AzureOpenAI } from 'openai';
import type { RequestInit } from 'openai/internal/builtin-types';

const PRIVATE_CREDENTIAL = 'azure-private-credential-75da';
const PRIVATE_SUFFIX = 'private-patient-record-21f8';
const SAFE_ERROR = 'Azure OpenAI credential contains an invalid HTTP header value.';

class PostHookProxyAzure extends AzureOpenAI {
  suppliedHeaders: NonNullable<RequestInit['headers']> = [];

  protected override async prepareRequest(request: RequestInit): Promise<void> {
    request.headers = this.suppliedHeaders;
  }
}

describe('Azure post-hook proxy credential privacy', () => {
  test.each(
    (['get', 'post'] as const).flatMap((method) =>
      (['off', 'debug'] as const).flatMap((logLevel) =>
        (['api-key', 'Authorization'] as const).flatMap((header) =>
          (['direct value', 'array element', 'inherited array element'] as const).map((representation) => ({
            method,
            logLevel,
            header,
            representation,
          })),
        ),
      ),
    ),
  )(
    'sanitizes a protected $method $header tuple $representation accessor before $logLevel logging or dispatch',
    async ({ method, logLevel, header, representation }) => {
      const credential = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const fail = vi.fn(() => {
        throw Object.assign(new Error(credential), { cause: new Error(credential) });
      });
      const row: [string, string] = [header, 'placeholder'];
      if (representation === 'direct value') {
        Object.defineProperty(row, 1, { configurable: true, enumerable: true, get: fail });
      } else {
        const values = ['placeholder'];
        if (representation === 'inherited array element') {
          Reflect.deleteProperty(values, 0);
          const prototype = Object.create(Array.prototype) as object;
          Object.defineProperty(prototype, 0, { configurable: true, enumerable: true, get: fail });
          Object.setPrototypeOf(values, prototype);
        } else {
          Object.defineProperty(values, 0, { configurable: true, enumerable: true, get: fail });
        }
        Object.defineProperty(row, 1, { configurable: true, enumerable: true, value: values });
      }
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const fetch = vi.fn(async () => globalThis.Response.json({ ok: true }));
      const client = new PostHookProxyAzure({
        baseURL: 'https://azure-resource.example.com/openai',
        apiVersion: '2024-02-15-preview',
        apiKey: 'safe-configured-token',
        fetch,
        logger,
        logLevel,
        maxRetries: 0,
      });
      client.suppliedHeaders = [row];

      let failure: unknown;
      try {
        await client.request({
          method,
          path: '/models',
          ...(method === 'post' ? { body: { safe: true } } : {}),
        });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(APIConnectionError);
      if (!(failure instanceof APIConnectionError)) {
        throw new Error('Expected an Azure connection wrapper.');
      }
      const { cause } = failure as APIConnectionError & { cause?: unknown };
      expect(cause).toBeInstanceOf(TypeError);
      if (!(cause instanceof TypeError)) {
        throw new Error('Expected a sanitized Azure credential failure.');
      }
      expect(cause.message).toBe(SAFE_ERROR);
      expect((cause as TypeError & { cause?: unknown }).cause).toBeUndefined();
      const logs = JSON.stringify([
        ...logger.debug.mock.calls,
        ...logger.info.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
      ]);
      for (const diagnostic of [
        failure.message,
        failure.stack ?? '',
        cause.message,
        cause.stack ?? '',
        logs,
      ]) {
        expect(diagnostic).not.toContain(PRIVATE_CREDENTIAL);
        expect(diagnostic).not.toContain(PRIVATE_SUFFIX);
      }
      expect(fail).toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each(
    (['ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf'] as const).flatMap((operation) =>
      (['off', 'debug'] as const).flatMap((logLevel) =>
        (['api-key', 'Authorization'] as const).map((header) => ({ operation, logLevel, header })),
      ),
    ),
  )(
    'sanitizes $header thrown by $operation before $logLevel logging or dispatch',
    async ({ header, logLevel, operation }) => {
      const credential = `${PRIVATE_CREDENTIAL}\n${PRIVATE_SUFFIX}`;
      const fail = vi.fn(() => {
        throw Object.assign(new Error(credential), { cause: new Error(credential) });
      });
      const headers = new Proxy(
        { [header]: credential },
        {
          ownKeys(target) {
            return operation === 'ownKeys' ? fail() : Reflect.ownKeys(target);
          },
          getOwnPropertyDescriptor(target, property) {
            return operation === 'getOwnPropertyDescriptor' && property === header
              ? fail()
              : Reflect.getOwnPropertyDescriptor(target, property);
          },
          getPrototypeOf(target) {
            return operation === 'getPrototypeOf' ? fail() : Reflect.getPrototypeOf(target);
          },
        },
      );
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const fetch = vi.fn(async () => globalThis.Response.json({ ok: true }));
      const client = new PostHookProxyAzure({
        baseURL: 'https://azure-resource.example.com/openai',
        apiVersion: '2024-02-15-preview',
        apiKey: 'safe-configured-token',
        fetch,
        logger,
        logLevel,
        maxRetries: 0,
      });
      client.suppliedHeaders = headers;

      let failure: unknown;
      try {
        await client.request({ method: 'get', path: '/models' });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(APIConnectionError);
      if (!(failure instanceof APIConnectionError)) {
        throw new Error('Expected Azure authentication failures to retain their connection wrapper.');
      }
      const { cause } = failure as APIConnectionError & { cause?: unknown };
      expect(cause).toBeInstanceOf(TypeError);
      if (!(cause instanceof TypeError)) {
        throw new Error('Expected Azure proxy authentication failures to have a sanitized TypeError cause.');
      }

      expect(cause.message).toBe(SAFE_ERROR);
      expect((cause as TypeError & { cause?: unknown }).cause).toBeUndefined();
      const logs = JSON.stringify([
        ...logger.debug.mock.calls,
        ...logger.info.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
      ]);
      for (const diagnostic of [
        failure.message,
        failure.stack ?? '',
        cause.message,
        cause.stack ?? '',
        logs,
      ]) {
        expect(diagnostic).not.toContain(PRIVATE_CREDENTIAL);
        expect(diagnostic).not.toContain(PRIVATE_SUFFIX);
      }
      expect(fail).toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
