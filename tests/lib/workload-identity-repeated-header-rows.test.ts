import OpenAI from 'openai';
import { snapshotHeaders } from 'openai/internal/headers';
import { vi } from 'vitest';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

describe.each(['name', 'value'] as const)('repeated row %s getter', (field) => {
  describe.each(['request', 'default', 'aliased'] as const)('%s headers', (layer) => {
    test.each([null, '', 'Bearer independent'] as const)(
      'preserves the later occurrence Authorization value %j',
      async (authorization) => {
        const row: (string | null | undefined)[] = ['Authorization', authorization];
        const read = vi.fn(() => {
          if (read.mock.calls.length > 2) {
            throw new Error('A repeated row occurrence was read twice');
          }
          if (field === 'name') {
            return read.mock.calls.length === 1 ? 'X-Custom' : 'Authorization';
          }
          return read.mock.calls.length === 1 ? undefined : authorization;
        });
        Object.defineProperty(row, field === 'name' ? 0 : 1, { get: read });
        const headers = [row, row];
        const sent: (string | null)[] = [];
        const transport = createWorkloadIdentityTransport((_url, init) => {
          sent.push(new Headers(init?.headers).get('Authorization'));
          return Response.json({ error: 'synthetic unauthorized' }, { status: 401 });
        });
        const client = new OpenAI({
          ...createTestClientOptions(),
          apiKey: null,
          adminAPIKey: null,
          ...(layer === 'request' ? {} : { defaultHeaders: headers }),
          fetch: transport.fetch,
          maxRetries: 0,
        });

        await expect(client.models.list(layer === 'default' ? {} : { headers })).rejects.toMatchObject({
          status: 401,
        });

        expect(sent).toEqual([authorization]);
        expect(read).toHaveBeenCalledTimes(2);
        expect(transport.exchanges).toBe(0);
      },
    );
  });
});

test('retains independent occurrence values while a later ordinary row remains live', () => {
  const read = vi.fn(() => String(read.mock.calls.length));
  const row = ['X-Repeated', 'initial'];
  Object.defineProperty(row, 1, { get: read });
  const ordinary = ['X-Ordinary', 'initial'];
  const snapshot = snapshotHeaders([row, row, ordinary]);

  ordinary[1] = 'updated';

  expect(snapshot.refresh().values.get('X-Repeated')).toBe('1, 2');
  expect(snapshot.refresh().values.get('X-Ordinary')).toBe('updated');
  expect(read).toHaveBeenCalledTimes(2);
});

test('validates a repeated occurrence before advancing to a later getter', () => {
  const read = vi.fn(() => (read.mock.calls.length === 1 ? 'valid' : 'invalid\nvalue'));
  const row = ['X-Custom', 'initial'];
  Object.defineProperty(row, 1, { get: read });
  const later = vi.fn(() => ['X-Later', 'unused']);
  const headers = [row, row, ['X-Later', 'unused']];
  Object.defineProperty(headers, 2, { get: later });

  expect(() => snapshotHeaders(headers)).toThrow(TypeError);

  expect(read).toHaveBeenCalledTimes(2);
  expect(later).not.toHaveBeenCalled();
});

test('forgets a removed occurrence before the row is appended again', () => {
  const read = vi.fn(() => String(read.mock.calls.length));
  const row = ['X-Repeated', 'initial'];
  Object.defineProperty(row, 1, { get: read });
  const headers = [row, row];
  const snapshot = snapshotHeaders(headers);
  expect(snapshot.snapshot.values.get('X-Repeated')).toBe('1, 2');

  headers.length = 1;
  expect(snapshot.refresh().values.get('X-Repeated')).toBe('1');
  headers.push(row);

  expect(snapshot.refresh().values.get('X-Repeated')).toBe('1, 3');
  expect(read).toHaveBeenCalledTimes(3);
});
