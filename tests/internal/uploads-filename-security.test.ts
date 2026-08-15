import { vi } from 'vitest';

import OpenAI from 'openai';
import { buildHeaders } from 'openai/internal/headers';
import {
  maybeMultipartFormRequestOptions,
  multipartFormRequestOptions,
  toStreamingFile,
} from 'openai/internal/uploads';

async function* chunks(value = 'content', onRead?: () => void) {
  onRead?.();
  yield value;
}

async function readForm(body: Record<string, unknown>, encode = multipartFormRequestOptions) {
  const options = await encode({ body }, fetch);
  return new Response(options.body as ReadableStream, {
    headers: { 'content-type': buildHeaders([options.headers]).values.get('content-type') ?? '' },
  }).formData();
}

describe('streaming multipart filename security', () => {
  test.each([
    ['empty', ''],
    ['boxed', new Object('upload.txt')],
    ['object', { toString: vi.fn(), replace: vi.fn() }],
    ['number', 42],
    ['symbol', Symbol('upload')],
    ['null', null],
    ['undefined', undefined],
  ] as const)('rejects %s filenames without coercion or emitting bytes', async (_, name) => {
    expect(() => toStreamingFile(chunks(), name as any)).toThrow(/file.?name/iu);
    const upload = toStreamingFile(chunks('secret'), 'safe.txt');
    Object.defineProperty(upload, 'name', { value: name });
    const options = await multipartFormRequestOptions({ body: { secret: 'metadata', upload } }, fetch);
    await expect((options.body as ReadableStream).getReader().read()).rejects.toThrow(/file.?name/iu);
    if (name && typeof name === 'object' && 'replace' in name && vi.isMockFunction(name.replace)) {
      expect(name.toString).not.toHaveBeenCalled();
      expect(name.replace).not.toHaveBeenCalled();
    }
  });

  test.each([false, true])('upgrades false-first branded uploads (invalid filename: %s)', async (invalid) => {
    const incidental = vi.fn(() => chunks('attacker'));
    const upload = toStreamingFile(chunks('authoritative'), 'upload.txt');
    Object.defineProperty(upload, Symbol.asyncIterator, { value: incidental });
    if (invalid) {
      Object.defineProperty(upload, 'name', { value: { toString: vi.fn() } });
    }
    let checks = 0;
    const hostile = new Proxy(upload, {
      has(target, key) {
        if (typeof key === 'symbol' && key.description === 'brand.privateStreamingFile') {
          checks += 1;
          return checks > 1;
        }
        return Reflect.has(target, key);
      },
    });
    const body = { earlier: chunks('earlier'), secret: 'metadata', upload: hostile };
    if (invalid) {
      const options = await maybeMultipartFormRequestOptions({ body }, fetch);
      await expect((options.body as ReadableStream).getReader().read()).rejects.toThrow(/file.?name/iu);
    } else {
      const form = await readForm(body, maybeMultipartFormRequestOptions);
      await expect((form.get('upload') as File).text()).resolves.toBe('authoritative');
    }
    expect(incidental).not.toHaveBeenCalled();
    expect(checks).toBe(2);
  });

  test.each(['iterator', 'branded iterator', 'reader'] as const)(
    'captures the original %s method and receiver before later filenames',
    async (kind) => {
      const original = vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: 'original' })
        .mockResolvedValueOnce({ done: true });
      const substituted = vi.fn().mockResolvedValue({ done: false, value: 'attacker' });
      const receiver = { next: original, read: original, releaseLock: vi.fn(), cancel: vi.fn() };
      const source =
        kind === 'reader'
          ? { getReader: vi.fn(() => receiver) }
          : { [Symbol.asyncIterator]: vi.fn(() => receiver) };
      const earlier = kind === 'branded iterator' ? toStreamingFile(source as any, 'earlier.txt') : source;
      const later = toStreamingFile(chunks('later'), 'later.txt');
      Object.defineProperty(later, 'name', {
        get() {
          expect(original).not.toHaveBeenCalled();
          receiver[kind === 'reader' ? 'read' : 'next'] = substituted;
          return 'later.txt';
        },
      });
      const form = await readForm({ earlier, later });
      await expect((form.get('earlier') as File).text()).resolves.toBe('original');
      expect(original.mock.contexts).toEqual([receiver, receiver]);
      expect(substituted).not.toHaveBeenCalled();
      expect(receiver.releaseLock).toHaveBeenCalledTimes(kind === 'reader' ? 1 : 0);
    },
  );

  test.each(['array', 'object'] as const)('snapshots uploads before later %s accessors', async (kind) => {
    const earlier = toStreamingFile(chunks('original'), 'original.txt', { type: 'text/original' });
    const later = toStreamingFile(chunks('later'), 'later.txt');
    const entries = kind === 'array' ? [earlier, later] : { earlier, later };
    const getLater = vi.fn(() => {
      Object.assign(earlier, { name: 'attacker.txt', type: 'text/attacker', data: chunks('attacker') });
      return later;
    });
    Object.defineProperty(entries, kind === 'array' ? 1 : 'later', { get: getLater });
    const form = await readForm({ files: entries });
    const file = form.get(kind === 'array' ? 'files[]' : 'files[earlier]') as File;
    expect(file).toMatchObject({ name: 'original.txt', type: 'text/original' });
    await expect(file.text()).resolves.toBe('original');
    expect(getLater).toHaveBeenCalledTimes(1);
  });

  test('keeps canonical public uploads lazy and snapshots each filename once', async () => {
    const read = vi.fn();
    const upload = toStreamingFile(chunks('content', read), 'original.txt');
    const getName = vi.fn(() => 'résumé-東京🎵.txt');
    Object.defineProperty(upload, 'name', { get: getName });
    let form: FormData | undefined;
    const client = new OpenAI({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        expect(read).not.toHaveBeenCalled();
        expect(getName).not.toHaveBeenCalled();
        form = await new Response(init?.body as ReadableStream, {
          headers: { 'content-type': new Headers(init?.headers).get('content-type') ?? '' },
        }).formData();
        return Response.json({ created: 0 });
      },
    });
    await client.images.edit({ prompt: 'safe metadata', image: upload });
    const file = form?.get('image') as File;
    expect(file.name).toBe('résumé-東京🎵.txt');
    await expect(file.text()).resolves.toBe('content');
    expect(form?.get('prompt')).toBe('safe metadata');
    expect(getName).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['/private/nested/report.txt', 'report.txt'],
    ['C:\\private\\report.txt', 'report.txt'],
    ['C:private-report.txt', 'private-report.txt'],
    ['name\0file.txt', 'name%00file.txt'],
    ['name\u007Ffile.txt', 'name%7Ffile.txt'],
    ['quote"\r\nfile.txt', 'quote%22%0D%0Afile.txt'],
  ] as const)('sanitizes multipart filenames: %s', async (name, expected) => {
    const options = await multipartFormRequestOptions(
      { body: { 'field\0name': toStreamingFile(chunks(), name) } },
      fetch,
    );
    await expect(new Response(options.body as ReadableStream).text()).resolves.toContain(
      `name="field%00name"; filename="${expected}"`,
    );
  });
});
