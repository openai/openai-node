import { setTimeout as delay } from 'node:timers/promises';

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

async function failAfterDelay(milliseconds: number, message: string): Promise<never> {
  await delay(milliseconds);
  throw new Error(message);
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

  test('reuses a native readable stream shared by multiple multipart entries', async () => {
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('shared stream bytes');
        controller.close();
      },
    });

    const options = await multipartFormRequestOptions({ body: { files: [stream, stream] } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();
    const files = form.getAll('files[]') as File[];

    await expect(Promise.all(files.map((file) => file.text()))).resolves.toEqual(['shared stream bytes', '']);
  });

  test('reuses a shared readable stream that only exposes its reader protocol', async () => {
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('shared reader bytes');
        controller.close();
      },
    });
    Object.defineProperty(stream, Symbol.asyncIterator, { value: undefined });

    const options = await multipartFormRequestOptions({ body: { files: [stream, stream] } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();
    const files = form.getAll('files[]') as File[];

    await expect(Promise.all(files.map((file) => file.text()))).resolves.toEqual(['shared reader bytes', '']);
  });

  test('reuses native readable data when a branded streaming file appears more than once', async () => {
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('shared streaming file bytes');
        controller.close();
      },
    });
    const upload = toStreamingFile(stream, 'shared.txt');

    const options = await multipartFormRequestOptions({ body: { files: [upload, upload] } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();
    const files = form.getAll('files[]') as File[];

    expect(files.map((file) => file.name)).toEqual(['shared.txt', 'shared.txt']);
    await expect(Promise.all(files.map((file) => file.text()))).resolves.toEqual([
      'shared streaming file bytes',
      '',
    ]);
  });

  test('reuses the readable body shared by separate multipart response uploads', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('shared response bytes'));
        controller.close();
      },
    });
    const first = new Response(stream);
    const second = new Response(stream);

    expect(first.body).toBe(second.body);

    const options = await multipartFormRequestOptions(
      { body: { files: [first, second], trigger: chunks('streaming trigger bytes') } },
      fetch,
    );
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();
    const files = form.getAll('files[]') as File[];

    await expect(Promise.all(files.map((file) => file.text()))).resolves.toEqual([
      'shared response bytes',
      '',
    ]);
  });

  test('captures a fresh iterator for each occurrence of a reusable async iterable', async () => {
    const createIterator = vi.fn(() => chunks('reusable iterable bytes'));
    const reusable = { [Symbol.asyncIterator]: createIterator };

    const options = await multipartFormRequestOptions({ body: { files: [reusable, reusable] } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();
    const files = form.getAll('files[]') as File[];

    await expect(Promise.all(files.map((file) => file.text()))).resolves.toEqual([
      'reusable iterable bytes',
      'reusable iterable bytes',
    ]);
    expect(createIterator).toHaveBeenCalledTimes(2);
  });

  test('streams all bytes for each occurrence of a reusable named blob', async () => {
    const blob = Object.assign(new Blob(['reusable blob bytes']), { name: 'reusable.txt' });

    const options = await multipartFormRequestOptions(
      { body: { files: [blob, blob], trigger: chunks('streaming trigger bytes') } },
      fetch,
    );
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();
    const files = form.getAll('files[]') as File[];

    expect(files.map((file) => file.name)).toEqual(['reusable.txt', 'reusable.txt']);
    await expect(Promise.all(files.map((file) => file.text()))).resolves.toEqual([
      'reusable blob bytes',
      'reusable blob bytes',
    ]);
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

  test('snapshots ordinary streaming uploads before reading later filenames', async () => {
    const originalIterator = vi.fn(() => chunks('original ordinary bytes'));
    const substitutedIterator = vi.fn(() => chunks('substituted ordinary bytes'));
    const earlier = { [Symbol.asyncIterator]: originalIterator };
    const later = toStreamingFile(chunks('later bytes'), 'later.png');
    Object.defineProperty(later, 'name', {
      get() {
        Object.defineProperty(earlier, Symbol.asyncIterator, { value: substitutedIterator });
        return 'later.png';
      },
    });

    const options = await multipartFormRequestOptions({ body: { earlier, later } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();

    await expect((form.get('earlier') as File).text()).resolves.toBe('original ordinary bytes');
    await expect((form.get('later') as File).text()).resolves.toBe('later bytes');
    expect(originalIterator).toHaveBeenCalledTimes(1);
    expect(substitutedIterator).not.toHaveBeenCalled();
  });

  test('captures the iterator selected from mutable source state before later filenames', async () => {
    let current = chunks('original state bytes');
    const source = {
      [Symbol.asyncIterator]() {
        return current[Symbol.asyncIterator]();
      },
    };
    const later = toStreamingFile(chunks('later bytes'), 'later.png');
    Object.defineProperty(later, 'name', {
      get() {
        current = chunks('substituted state bytes');
        return 'later.png';
      },
    });

    const options = await multipartFormRequestOptions({ body: { source, later } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();

    await expect((form.get('source') as File).text()).resolves.toBe('original state bytes');
    await expect((form.get('later') as File).text()).resolves.toBe('later bytes');
  });

  test('captures a filename before its iterator factory can mutate it', async () => {
    const state: { upload?: ReturnType<typeof toStreamingFile> } = {};
    const source = {
      [Symbol.asyncIterator]() {
        if (!state.upload) {
          throw new Error('upload was not initialized');
        }
        Object.defineProperty(state.upload, 'name', { value: 'substituted.txt' });
        return chunks('upload bytes')[Symbol.asyncIterator]();
      },
    };
    const upload = toStreamingFile(source, 'original.txt');
    state.upload = upload;

    const options = await multipartFormRequestOptions({ body: { upload } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();
    const file = form.get('upload') as File;

    expect(file.name).toBe('original.txt');
    await expect(file.text()).resolves.toBe('upload bytes');
  });

  test('prefers an async iterator when an upload also exposes getReader', async () => {
    const createIterator = vi.fn(() => chunks('iterator bytes')[Symbol.asyncIterator]());
    const getReader = vi.fn(() => new ReadableStream<string>({ start() {} }).getReader());
    const hybrid = { [Symbol.asyncIterator]: createIterator, getReader };

    const options = await multipartFormRequestOptions({ body: { hybrid } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();

    await expect((form.get('hybrid') as File).text()).resolves.toBe('iterator bytes');
    expect(createIterator).toHaveBeenCalledTimes(1);
    expect(getReader).not.toHaveBeenCalled();
  });

  test('recaptures reusable async iterators without reading incidental reader accessors', async () => {
    const createIterator = vi.fn(() => chunks('reusable hybrid bytes'));
    const getReader = vi.fn(() => {
      throw new Error('incidental reader accessor was read');
    });
    const hybrid = { [Symbol.asyncIterator]: createIterator };
    Object.defineProperty(hybrid, 'getReader', { get: getReader });

    const options = await multipartFormRequestOptions({ body: { files: [hybrid, hybrid] } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();
    const files = form.getAll('files[]') as File[];

    await expect(Promise.all(files.map((file) => file.text()))).resolves.toEqual([
      'reusable hybrid bytes',
      'reusable hybrid bytes',
    ]);
    expect(createIterator).toHaveBeenCalledTimes(2);
    expect(getReader).not.toHaveBeenCalled();
  });

  test('does not await unconsumed stream cleanup before reporting an invalid filename', async () => {
    const never = new ReadableStream<void>().getReader().closed;
    const cancel = vi.fn(() => never);
    const returnIterator = vi.fn(() => never);
    const stream = new ReadableStream<string>({ cancel });
    const source = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => ({ done: false as const, value: 'unused' }),
          return: returnIterator,
        };
      },
    };
    const later = toStreamingFile(chunks('later bytes'), 'later.txt');
    Object.defineProperty(later, 'name', { value: { toString: vi.fn() } });

    const options = await multipartFormRequestOptions({ body: { stream, source, later } }, fetch);
    const reader = (options.body as ReadableStream).getReader();
    await expect(Promise.race([reader.read(), failAfterDelay(100, 'cleanup timed out')])).rejects.toThrow(
      /file.?name/iu,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(returnIterator).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  test('preserves validation errors when upload cleanup accessors throw', async () => {
    const getReturn = vi.fn(() => {
      throw new Error('iterator cleanup accessor failed');
    });
    const getReleaseLock = vi.fn(() => {
      throw new Error('reader cleanup accessor failed');
    });
    const cleanupReader = { cancel: vi.fn() };
    Object.defineProperty(cleanupReader, 'releaseLock', { get: getReleaseLock });
    const stream = { getReader: () => cleanupReader } as unknown as ReadableStream<string>;
    const source = {
      [Symbol.asyncIterator]() {
        const iterator = {
          next: async () => ({ done: false as const, value: 'unused' }),
        } as AsyncIterator<string>;
        Object.defineProperty(iterator, 'return', { get: getReturn });
        return iterator;
      },
    };
    const later = toStreamingFile(chunks('later bytes'), 'later.txt');
    Object.defineProperty(later, 'name', { value: { toString: vi.fn() } });

    const options = await multipartFormRequestOptions({ body: { stream, source, later } }, fetch);
    const bodyReader = (options.body as ReadableStream).getReader();

    await expect(bodyReader.read()).rejects.toThrow(/file.?name/iu);
    expect(getReleaseLock).toHaveBeenCalledTimes(1);
    expect(getReturn).toHaveBeenCalledTimes(1);
  });

  test('releases preflight readers when a later filename is invalid', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<string>({ cancel });
    const earlier = toStreamingFile(stream, 'earlier.txt');
    const later = toStreamingFile(chunks('later bytes'), 'later.txt');
    Object.defineProperty(later, 'name', { value: { toString: vi.fn() } });

    const options = await multipartFormRequestOptions({ body: { earlier, later } }, fetch);
    const reader = (options.body as ReadableStream).getReader();

    await expect(reader.read()).rejects.toThrow(/file.?name/iu);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  test('disposes a shared preflight readable once when a later filename is invalid', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<string>({ cancel });
    const shared = toStreamingFile(stream, 'shared.txt');
    const later = toStreamingFile(chunks('later bytes'), 'later.txt');
    Object.defineProperty(later, 'name', { value: { toString: vi.fn() } });

    const options = await multipartFormRequestOptions(
      { body: { first: stream, second: shared, later } },
      fetch,
    );
    const reader = (options.body as ReadableStream).getReader();

    await expect(reader.read()).rejects.toThrow(/file.?name/iu);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  test('cancels unconsumed preflight readers when multipart serialization is canceled', async () => {
    const cancel = vi.fn();
    const laterStream = new ReadableStream<string>({ cancel });
    const options = await multipartFormRequestOptions(
      {
        body: {
          earlier: toStreamingFile(chunks('earlier bytes'), 'earlier.txt'),
          later: toStreamingFile(laterStream, 'later.txt'),
        },
      },
      fetch,
    );
    const reader = (options.body as ReadableStream).getReader();

    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await reader.cancel();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(laterStream.locked).toBe(false);
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

  test('snapshots named Blob filenames and bytes before reading later streaming filenames', async () => {
    const earlier = Object.assign(new Blob(['earlier bytes']), { name: 'original.txt' });
    const substitutedStream = vi.fn(() => new Blob(['substituted bytes']).stream());
    const later = toStreamingFile(chunks('later bytes'), 'later.txt');
    Object.defineProperty(later, 'name', {
      get() {
        Object.defineProperties(earlier, {
          name: { value: 'substituted.txt' },
          stream: { value: substitutedStream },
        });
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
    expect(substitutedStream).not.toHaveBeenCalled();
  });
});
