import { vi } from 'vitest';

import OpenAI from 'openai';
import { buildHeaders } from 'openai/internal/headers';
import {
  maybeMultipartFormRequestOptions,
  multipartFormRequestOptions,
  toStreamingFile,
} from 'openai/internal/uploads';

async function* chunks(content = 'content') {
  yield content;
}

describe('streaming multipart filename and header security', () => {
  test.each([
    ['a plain object', { replace: () => 'upload.txt' }],
    ['a boxed string', new Object('upload.txt')],
    ['a number', 42],
    ['a symbol', Symbol('upload.txt')],
    ['a boolean', true],
    ['null', null],
    ['undefined', undefined],
  ] as const)('rejects %s as a streaming filename without coercing it', (_, name) => {
    expect(() => toStreamingFile(chunks(), name as any)).toThrow(TypeError);
    expect(() => toStreamingFile(chunks(), name as any)).toThrow(/file.?name/iu);
  });

  test('rejects attacker-controlled filename methods without invoking them', () => {
    const replace = vi.fn().mockReturnValue('attacker.txt');
    const toString = vi.fn().mockReturnValue('attacker.txt');

    expect(() => toStreamingFile(chunks(), { replace, toString } as any)).toThrow(TypeError);
    expect(replace).not.toHaveBeenCalled();
    expect(toString).not.toHaveBeenCalled();
  });

  test('accepts nonempty primitive Unicode filenames', () => {
    expect(toStreamingFile(chunks(), 'résumé-東京🎵.wav').name).toBe('résumé-東京🎵.wav');
  });

  test.each([
    ['an empty filename', ''],
    ['a boxed string', new Object('upload.txt')],
    ['a plain object', { replace: () => 'upload.txt', toString: () => 'upload.txt' }],
    ['a number', 42],
    ['a symbol', Symbol('upload.txt')],
    ['null', null],
    ['undefined', undefined],
  ] as const)('rejects a filename mutated to %s before emitting its multipart boundary', async (_, name) => {
    const upload = toStreamingFile(chunks('sensitive upload bytes'), 'safe.txt');
    Object.defineProperty(upload, 'name', { value: name });

    const options = await multipartFormRequestOptions({ body: { upload } }, fetch);
    const reader = (options.body as ReadableStream).getReader();

    await expect(reader.read()).rejects.toThrow(TypeError);
    await expect(reader.closed).rejects.toThrow(/file.?name/iu);
  });

  test('rejects a false-first branded async-iterable before optional multipart emits bytes', async () => {
    const emitted: Uint8Array[] = [];
    const incidentalIterator = vi.fn(() => chunks('incidental upload bytes'));
    const upload = toStreamingFile(chunks('authoritative upload bytes'), 'upload.png');
    Object.defineProperties(upload, {
      name: { value: { toString: vi.fn() } },
      [Symbol.asyncIterator]: { value: incidentalIterator },
    });

    let brandChecks = 0;
    const hostile = new Proxy(upload, {
      has(target, key) {
        if (typeof key === 'symbol' && key.description === 'brand.privateStreamingFile') {
          brandChecks += 1;
          return brandChecks > 1;
        }

        return Reflect.has(target, key);
      },
    });
    const options = await maybeMultipartFormRequestOptions(
      { body: { earlier: chunks('earlier stream bytes'), secret: 'sensitive metadata', upload: hostile } },
      fetch,
    );
    const reader = (options.body as ReadableStream<Uint8Array>).getReader();
    const firstRead = reader.read().then(({ done, value }) => {
      if (!done) {
        emitted.push(value);
      }
    });

    await expect(firstRead).rejects.toThrow(/file.?name/iu);
    expect(emitted).toEqual([]);
    expect(incidentalIterator).not.toHaveBeenCalled();
    expect(brandChecks).toBe(2);
  });

  test('upgrades a false-first branded async-iterable and streams its authoritative data', async () => {
    const incidentalIterator = vi.fn(() => chunks('incidental upload bytes'));
    const upload = toStreamingFile(chunks('authoritative upload bytes'), 'upload.png');
    Object.defineProperty(upload, Symbol.asyncIterator, { value: incidentalIterator });

    let brandChecks = 0;
    const hostile = new Proxy(upload, {
      has(target, key) {
        if (typeof key === 'symbol' && key.description === 'brand.privateStreamingFile') {
          brandChecks += 1;
          return brandChecks > 1;
        }

        return Reflect.has(target, key);
      },
    });
    const options = await maybeMultipartFormRequestOptions(
      { body: { earlier: chunks('earlier stream bytes'), upload: hostile } },
      fetch,
    );
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();
    const file = form.get('upload') as File;

    expect(file.name).toBe('upload.png');
    await expect(file.text()).resolves.toBe('authoritative upload bytes');
    expect(incidentalIterator).not.toHaveBeenCalled();
    expect(brandChecks).toBe(2);
  });

  test('snapshots earlier streaming metadata before reading later mutable filenames', async () => {
    const earlier = toStreamingFile(chunks('original earlier bytes'), 'earlier.png', {
      type: 'image/original',
    });
    const later = toStreamingFile(chunks('later bytes'), 'later.png');
    const getLaterFilename = vi.fn(() => {
      Object.defineProperties(earlier, {
        data: { value: chunks('substituted earlier bytes') },
        type: { value: 'image/substituted' },
      });
      return 'later.png';
    });
    Object.defineProperty(later, 'name', { get: getLaterFilename });

    const options = await multipartFormRequestOptions({ body: { files: [earlier, later] } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();
    const files = form.getAll('files[]') as File[];

    await expect(Promise.all(files.map((file) => file.text()))).resolves.toEqual([
      'original earlier bytes',
      'later bytes',
    ]);
    expect(files[0]?.type).toBe('image/original');
    expect(getLaterFilename).toHaveBeenCalledTimes(1);
  });

  test('snapshots streaming byte-source behavior before reading later filenames', async () => {
    const originalIterator = vi.fn(() => chunks('original earlier bytes'));
    const substitutedIterator = vi.fn(() => chunks('substituted earlier bytes'));
    const data = { [Symbol.asyncIterator]: originalIterator };
    const earlier = toStreamingFile(data, 'earlier.png');
    const later = toStreamingFile(chunks('later bytes'), 'later.png');
    Object.defineProperty(later, 'name', {
      get() {
        Object.defineProperty(data, Symbol.asyncIterator, { value: substitutedIterator });
        return 'later.png';
      },
    });

    const options = await multipartFormRequestOptions({ body: { files: [earlier, later] } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();
    const files = form.getAll('files[]') as File[];

    await expect(Promise.all(files.map((file) => file.text()))).resolves.toEqual([
      'original earlier bytes',
      'later bytes',
    ]);
    expect(originalIterator).toHaveBeenCalledTimes(1);
    expect(substitutedIterator).not.toHaveBeenCalled();
  });

  test('streams valid branded async-iterable files lazily using one filename snapshot per entry', async () => {
    const readChunk = vi.fn();
    const replace = vi.fn();
    const incidentalIterator = vi.fn(() => chunks('hostile incidental upload bytes'));

    async function* trackedChunks(content: string) {
      readChunk(content);
      yield content;
    }

    const first = toStreamingFile(trackedChunks('first upload bytes'), 'original-first.png');
    const second = toStreamingFile(trackedChunks('second upload bytes'), 'original-second.png');
    Object.defineProperty(second, Symbol.asyncIterator, { value: incidentalIterator });
    const getFirstFilename = vi.fn().mockReturnValueOnce('first.png').mockReturnValue({ replace });
    const getSecondFilename = vi.fn().mockReturnValueOnce('second.png').mockReturnValue({ replace });
    Object.defineProperty(first, 'name', { get: getFirstFilename });
    Object.defineProperty(second, 'name', { get: getSecondFilename });

    let form: FormData | undefined;
    const client = new OpenAI({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        expect(readChunk).not.toHaveBeenCalled();

        form = await new Response(init?.body as ReadableStream, {
          headers: { 'content-type': new Headers(init?.headers).get('content-type') ?? '' },
        }).formData();

        return Response.json({ created: 0 });
      },
    });

    await client.images.edit({ prompt: 'safe metadata', image: [first, second] });

    const files = (form?.getAll('image[]') ?? []) as File[];
    await expect(Promise.all(files.map((file) => file.text()))).resolves.toEqual([
      'first upload bytes',
      'second upload bytes',
    ]);
    expect(files.map((file) => file.name)).toEqual(['first.png', 'second.png']);
    expect(form?.get('prompt')).toBe('safe metadata');
    expect(readChunk).toHaveBeenCalledTimes(2);
    expect(getFirstFilename).toHaveBeenCalledTimes(1);
    expect(getSecondFilename).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(incidentalIterator).not.toHaveBeenCalled();
  });

  test.each([
    ['an absolute POSIX path', '/Users/alice/private/report.txt', 'report.txt'],
    ['an absolute Windows path', 'C:\\Users\\alice\\private\\report.txt', 'report.txt'],
    ['a drive-relative Windows path', 'C:private-report.txt', 'private-report.txt'],
    ['a nested relative path', 'private/nested/report.txt', 'report.txt'],
    ['mixed path separators', 'private\\nested/deeper\\report.txt', 'report.txt'],
    ['a plain filename', 'report.txt', 'report.txt'],
  ] as const)(
    'strips directories from %s in serialized streaming multipart headers',
    async (_, name, filename) => {
      const options = await multipartFormRequestOptions(
        { body: { upload: toStreamingFile(chunks(), name) } },
        fetch,
      );
      const body = await new Response(options.body as ReadableStream).text();

      expect(body).toContain(`Content-Disposition: form-data; name="upload"; filename="${filename}"\r\n`);
    },
  );

  test.each([
    ['POSIX separators', 'my-skill/assets/report.txt', 'my-skill/assets/report.txt'],
    ['Windows separators', 'my-skill\\assets\\report.txt', 'my-skill/assets/report.txt'],
    ['mixed separators', 'my-skill/assets\\nested\\report.txt', 'my-skill/assets/nested/report.txt'],
  ] as const)(
    'preserves normalized streaming filename paths with %s when explicitly requested',
    async (_, name, filename) => {
      const options = await multipartFormRequestOptions(
        { body: { upload: toStreamingFile(chunks(), name) } },
        fetch,
        { stripFilenames: false },
      );
      const body = await new Response(options.body as ReadableStream).text();

      expect(body).toContain(`Content-Disposition: form-data; name="upload"; filename="${filename}"\r\n`);
    },
  );

  test.each([
    ['NUL', '\0', '%00'],
    ['DEL', '\u007F', '%7F'],
  ] as const)('escapes %s in multipart field names and filenames', async (_, control, escaped) => {
    const field = `upload${control}field`;
    const options = await multipartFormRequestOptions(
      { body: { [field]: toStreamingFile(chunks('bytes'), `file${control}name.txt`) } },
      fetch,
    );
    const body = await new Response(options.body as ReadableStream).text();

    expect(body).toContain(`name="upload${escaped}field"; filename="file${escaped}name.txt"`);
    expect(body).not.toContain(control);
  });

  test('upgrades a cached named Blob when streaming behavior appears', async () => {
    const incidentalIterator = vi.fn(() => chunks('incidental bytes'));
    const upload = Object.assign(new Blob(['blob bytes']), { name: 'upload.txt' });
    let iteratorReads = 0;
    Object.defineProperty(upload, Symbol.asyncIterator, {
      get() {
        iteratorReads += 1;
        return iteratorReads === 1 ? undefined : incidentalIterator;
      },
    });

    const options = await maybeMultipartFormRequestOptions({ body: { upload } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();
    const file = form.get('upload') as File;

    expect(file.name).toBe('upload.txt');
    await expect(file.text()).resolves.toBe('blob bytes');
    expect(iteratorReads).toBe(2);
    expect(incidentalIterator).not.toHaveBeenCalled();
  });

  test('snapshots named Blob filenames before reading later streaming filenames', async () => {
    const earlier = Object.assign(new Blob(['earlier bytes']), { name: 'original.txt' });
    const later = toStreamingFile(chunks('later bytes'), 'later.txt');
    Object.defineProperty(later, 'name', {
      get() {
        Object.defineProperty(earlier, 'name', { value: 'substituted.txt' });
        return 'later.txt';
      },
    });

    const options = await multipartFormRequestOptions({ body: { files: [earlier, later] } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();
    const files = form.getAll('files[]') as File[];

    expect(files.map((file) => file.name)).toEqual(['original.txt', 'later.txt']);
    await expect(Promise.all(files.map((file) => file.text()))).resolves.toEqual([
      'earlier bytes',
      'later bytes',
    ]);
  });
});
