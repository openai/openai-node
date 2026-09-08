import OpenAI from 'openai';
import { snapshotHeaders } from 'openai/internal/headers';
import { createTestClientOptions, createWorkloadIdentityTransport } from './workload-identity-fixtures';

const accessorRow = (read: () => string) => {
  const row = ['X-Custom', 'initial'];
  Object.defineProperty(row, 1, { get: read });
  return row;
};

test('rereads an accessor-backed tuple after every occurrence was removed', () => {
  let reads = 0;
  const row = accessorRow(() => String((reads += 1)));
  const headers = [row];
  const snapshot = snapshotHeaders(headers);

  expect(snapshot.snapshot.values.get('X-Custom')).toBe('1');
  headers.length = 0;
  expect(snapshot.refresh().values.get('X-Custom')).toBeNull();
  headers.push(row);
  expect(snapshot.refresh().values.get('X-Custom')).toBe('2');
});

test('keeps forked tuple occurrence caches independent when one fork observes absence', () => {
  let reads = 0;
  const row = accessorRow(() => String((reads += 1)));
  const headers = [row, row];
  const first = snapshotHeaders(headers);
  const second = first.fork();

  expect(first.snapshot.values.get('X-Custom')).toBe('1, 2');
  headers.length = 0;
  expect(first.refresh().values.get('X-Custom')).toBeNull();
  headers.push(row, row);
  expect(second.refresh().values.get('X-Custom')).toBe('1, 2');
  expect(reads).toBe(2);
});

test('evicts all duplicate tuple occurrences before reinsertion and reordering', () => {
  let reads = 0;
  const row = accessorRow(() => String((reads += 1)));
  const other = ['X-Other', 'stable'];
  const headers = [row, other, row];
  const snapshot = snapshotHeaders(headers);

  expect(snapshot.snapshot.values.get('X-Custom')).toBe('1, 2');
  headers.splice(0, 3, other);
  expect(snapshot.refresh().values.get('X-Custom')).toBeNull();
  headers.splice(0, 1, row, row, other);
  expect(snapshot.refresh().values.get('X-Custom')).toBe('3, 4');
  headers.reverse();
  expect(snapshot.refresh().values.get('X-Custom')).toBe('3, 4');
});

test('uses a reinserted accessor-backed tuple current value on retry', async () => {
  let current = 'first';
  const row = accessorRow(() => current);
  const headers = [row];
  const sent: (string | null)[] = [];
  const transport = createWorkloadIdentityTransport((_url, init) => {
    sent.push(new Headers(init?.headers).get('X-Custom'));
    if (sent.length === 1) {
      headers.length = 0;
    }
    if (sent.length === 2) {
      current = 'third';
      headers.push(row);
    }
    return sent.length < 3
      ? Response.json({ error: 'synthetic retry' }, { status: 500, headers: { 'retry-after-ms': '0' } })
      : Response.json({ data: [] });
  });
  const client = new OpenAI({
    ...createTestClientOptions(),
    apiKey: null,
    adminAPIKey: null,
    maxRetries: 2,
    fetch: transport.fetch,
  });

  await client.models.list({ headers });

  expect(sent).toEqual(['first', null, 'third']);
});
