import OpenAI from 'openai';
import { vi } from 'vitest';
import {
  createTestClientOptions,
  createTestWorkloadIdentity,
  createWorkloadIdentityTransport,
} from './workload-identity-fixtures';

test.each([
  { layer: 'request', first: undefined, second: 'Bearer synthetic-independent' },
  { layer: 'default', first: 'Bearer synthetic-independent', second: undefined },
])('keeps a replacement getter local to the aliased $layer layer', async ({ first, second }) => {
  const initialRead = vi.fn<() => undefined>();
  const replacementRead = vi
    .fn<() => string | undefined>()
    .mockReturnValueOnce(first)
    .mockReturnValue(second);
  const row: (string | undefined)[] = ['Authorization', undefined];
  Object.defineProperty(row, 1, { configurable: true, get: initialRead });
  const headers = [row];
  const identity = createTestWorkloadIdentity();
  identity.provider.getToken = async () => {
    Object.defineProperty(row, 1, { get: replacementRead });
    return 'subject-token';
  };
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('Authorization'));
    return Response.json({ data: [] });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    workloadIdentity: identity,
    defaultHeaders: headers,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.models.list({ headers });

  expect(sent).toEqual(['Bearer synthetic-independent']);
  expect(initialRead).toHaveBeenCalledTimes(1);
  expect(replacementRead).toHaveBeenCalledTimes(2);
  expect(transport.exchanges).toBe(1);
});

test('shares only the initial tuple materialization across aliased layers and authentication retry', async () => {
  const read = vi.fn(() => 'synthetic-preserved');
  const row = ['X-Custom', ''];
  Object.defineProperty(row, 1, { get: read });
  const headers = [row];
  const sent: Headers[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers));
    return sent.length === 1
      ? Response.json({ error: 'synthetic unauthorized' }, { status: 401 })
      : Response.json({ data: [] });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    defaultHeaders: headers,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.models.list({ headers });

  expect(sent.map((entry) => entry.get('X-Custom'))).toEqual(['synthetic-preserved', 'synthetic-preserved']);
  expect(sent.map((entry) => entry.get('Authorization'))).toEqual([
    'Bearer access-token-1',
    'Bearer access-token-2',
  ]);
  expect(read).toHaveBeenCalledTimes(1);
  expect(transport.exchanges).toBe(2);
});

test('keeps an explicit null in aliased layers omitted without acquiring a workload token', async () => {
  const read = vi.fn(() => null);
  const row: (string | null)[] = ['Authorization', null];
  Object.defineProperty(row, 1, { get: read });
  const headers = [row];
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('Authorization'));
    return Response.json({ data: [] });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    defaultHeaders: headers,
    fetch: transport.fetch,
    maxRetries: 0,
  });

  await client.models.list({ headers });

  expect(sent).toEqual([null]);
  expect(read).toHaveBeenCalledTimes(1);
  expect(transport.exchanges).toBe(0);
});
