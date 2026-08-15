import { runInNewContext } from 'node:vm';

import { vi } from 'vitest';

import { buildHeaders } from 'openai/internal/headers';
import {
  maybeMultipartFormRequestOptions,
  multipartFormRequestOptions,
  toStreamingFile,
} from 'openai/internal/uploads';

async function* chunks(value = 'content') {
  yield value;
}

async function readForm(body: Record<string, unknown>, encode = multipartFormRequestOptions) {
  const options = await encode({ body }, fetch);
  return new Response(options.body as ReadableStream, {
    headers: { 'content-type': buildHeaders([options.headers]).values.get('content-type') ?? '' },
  }).formData();
}

const readable = (value = 'shared') => ReadableStream.from([value]);

describe('streaming multipart source security', () => {
  test.each([
    ['optional', maybeMultipartFormRequestOptions],
    ['required', multipartFormRequestOptions],
  ] as const)(
    'materializes cached named Blobs without rechecking their names in %s multipart requests',
    async (_, encode) => {
      const source = Object.assign(new Blob(['authoritative Blob bytes'], { type: 'text/plain' }), {
        name: 'original.txt',
      });
      const hasName = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
      const upload = new Proxy(source, {
        has(target, property) {
          return property === 'name' ? hasName() : Reflect.has(target, property);
        },
      });

      const options = await encode({ body: { upload } }, fetch);
      expect(options.body).toBeInstanceOf(FormData);
      const file = (options.body as FormData).get('upload');
      expect(file).toBeInstanceOf(File);
      expect(file).toMatchObject({ name: 'original.txt', type: 'text/plain' });
      await expect((file as File).text()).resolves.toBe('authoritative Blob bytes');
      expect(hasName).toHaveBeenCalledTimes(1);
    },
  );

  test.each(
    (['Blob', 'Response'] as const).flatMap((kind) =>
      (
        [
          ['optional', maybeMultipartFormRequestOptions],
          ['required', multipartFormRequestOptions],
        ] as const
      ).map(([mode, encode]) => [kind, mode, encode] as const),
    ),
  )('preserves cached %s bytes in mixed %s streaming multipart requests', async (kind, mode, encode) => {
    const type = kind === 'Blob' ? 'text/blob' : 'text/response';
    const source =
      kind === 'Blob'
        ? Object.assign(new Blob(['authoritative Blob bytes'], { type }), { name: 'original.txt' })
        : Object.assign(new Response('authoritative Response bytes', { headers: { 'content-type': type } }), {
            name: 'original.txt',
          });
    const protocol = mode === 'optional' ? Symbol.asyncIterator : 'getReader';
    const attacker = vi.fn(() =>
      protocol === Symbol.asyncIterator ? chunks('attacker bytes') : readable('attacker bytes').getReader(),
    );
    const getAttacker = vi.fn(() => attacker);
    Object.defineProperty(source, protocol, { get: getAttacker });
    let brandChecks = 0;
    let prototypeChecks = 0;
    const upload = new Proxy(source, {
      has(target, property) {
        if (typeof property === 'symbol' && property.description === 'brand.privateStreamingFile') {
          brandChecks += 1;
          return brandChecks > (mode === 'optional' ? 2 : 1);
        }
        return Reflect.has(target, property);
      },
      get(target, property) {
        return property === 'data' ? attacker() : Reflect.get(target, property, target);
      },
      getPrototypeOf(target) {
        prototypeChecks += 1;
        return kind === 'Blob' && prototypeChecks > 2 ? Response.prototype : Reflect.getPrototypeOf(target);
      },
    });

    const form = await readForm(
      { upload, sibling: toStreamingFile(chunks('sibling bytes'), 'sibling.txt') },
      encode,
    );

    expect(form.get('upload')).toMatchObject({ name: 'original.txt', type });
    await expect((form.get('upload') as File).text()).resolves.toBe(`authoritative ${kind} bytes`);
    await expect((form.get('sibling') as File).text()).resolves.toBe('sibling bytes');
    expect(getAttacker).not.toHaveBeenCalled();
    expect(attacker).not.toHaveBeenCalled();
    expect(brandChecks).toBe(1);
    expect(prototypeChecks).toBe(kind === 'Blob' ? 2 : 1);
  });

  test.each([
    ['optional', maybeMultipartFormRequestOptions],
    ['required', multipartFormRequestOptions],
  ] as const)(
    'preserves cached named Blob metadata in mixed %s streaming multipart requests',
    async (_, encode) => {
      const source = Object.assign(new Blob(['authoritative Blob bytes'], { type: 'text/plain' }), {
        name: 'original.txt',
      });
      const hasName = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
      const upload = new Proxy(source, {
        has(target, property) {
          return property === 'name' ? hasName() : Reflect.has(target, property);
        },
      });

      const form = await readForm(
        { upload, sibling: toStreamingFile(chunks('sibling bytes'), 'sibling.txt') },
        encode,
      );
      const file = form.get('upload');
      expect(file).toBeInstanceOf(File);
      expect(file).toMatchObject({ name: 'original.txt', type: 'text/plain' });
      await expect((file as File).text()).resolves.toBe('authoritative Blob bytes');
      await expect((form.get('sibling') as File).text()).resolves.toBe('sibling bytes');
      expect(hasName).toHaveBeenCalledTimes(1);
    },
  );

  test('ignores superseded legacy Blob readers while preserving unchanged deferred overrides', async () => {
    const first = Object.assign(new Blob(['original']), { name: 'first.bin', content: 'original' });
    const second = Object.assign(new Blob(['second']), { name: 'second.bin' });
    const firstRead = vi.fn(() => Promise.reject(new Error('superseded Blob reader was invoked')));
    const secondRead = vi.fn(Blob.prototype.arrayBuffer);
    const substitutedRead = vi.fn();
    Object.assign(first, {
      stream: undefined,
      arrayBuffer: firstRead,
      slice: vi.fn(() => new Blob(['attacker'])),
    });
    Object.assign(second, { stream: undefined, arrayBuffer: secondRead });
    const later = toStreamingFile(chunks('later'), 'later.txt');
    Object.defineProperty(later, 'name', {
      get() {
        first.content = 'attacker';
        Object.defineProperty(first, 'arrayBuffer', { value: substitutedRead });
        return 'later.txt';
      },
    });
    const options = await multipartFormRequestOptions({ body: { first, second, later } }, fetch);
    const reader = (options.body as ReadableStream<Uint8Array>).getReader();
    const readChunk = async () => {
      const chunk = await reader.read();
      return new TextDecoder().decode(chunk.value);
    };
    await readChunk();
    expect(await readChunk()).toContain('filename="first.bin"');
    expect(firstRead).not.toHaveBeenCalled();
    expect(secondRead).not.toHaveBeenCalled();
    expect(await readChunk()).toBe('original');
    expect(firstRead).not.toHaveBeenCalled();
    await readChunk();
    await readChunk();
    expect(await readChunk()).toContain('filename="second.bin"');
    expect(secondRead).not.toHaveBeenCalled();
    expect(await readChunk()).toBe('second');
    expect(secondRead.mock.contexts).toEqual([second]);
    expect(substitutedRead).not.toHaveBeenCalled();
    expect(first.slice).not.toHaveBeenCalled();
    await reader.cancel();
  });

  test('preserves authoritative legacy Blob arrayBuffer overrides in mixed streaming multipart bodies', async () => {
    const legacy = Object.assign(new Blob(['intrinsic Blob bytes']), { name: 'legacy.bin' });
    const readOverride = vi.fn(() =>
      Promise.resolve(new TextEncoder().encode('authoritative override bytes').buffer),
    );
    Object.assign(legacy, { stream: undefined, arrayBuffer: readOverride });

    const form = await readForm({
      legacy,
      metadata: 'preserved metadata',
      streamed: toStreamingFile(chunks('streamed bytes'), 'streamed.txt'),
    });

    await expect((form.get('legacy') as File).text()).resolves.toBe('authoritative override bytes');
    expect(form.get('metadata')).toBe('preserved metadata');
    await expect((form.get('streamed') as File).text()).resolves.toBe('streamed bytes');
    expect(readOverride.mock.contexts).toEqual([legacy]);
  });

  test.each(['stream', 'arrayBuffer'] as const)(
    'preserves bodyless Response bytes when later metadata replaces Blob.%s',
    async (method) => {
      const blob = new Blob(['original payload']);
      const readBlob = vi.fn(() => Promise.resolve(blob));
      const response = Object.assign(new Response(null, { headers: { 'content-type': 'text/original' } }), {
        name: 'response.txt',
        blob: readBlob,
      });
      const attacker = vi.fn(() =>
        method === 'stream'
          ? readable('attacker bytes')
          : Promise.resolve(new TextEncoder().encode('attacker bytes').buffer),
      );
      const later = toStreamingFile(chunks('later bytes'), 'later.txt');
      Object.defineProperty(later, method === 'stream' ? 'name' : 'type', {
        get() {
          Object.defineProperty(blob, method, { value: attacker });
          if (method === 'arrayBuffer') {
            Object.defineProperty(blob, 'stream', { value: undefined });
          }
          return method === 'stream' ? 'later.txt' : 'text/later';
        },
      });

      const formPromise = readForm({ response, metadata: 'preserved metadata', later });
      expect(readBlob).not.toHaveBeenCalled();
      expect(attacker).not.toHaveBeenCalled();
      const form = await formPromise;
      const file = form.get('response') as File;
      expect(file).toMatchObject({ name: 'response.txt', type: 'text/original' });
      await expect(file.text()).resolves.toBe('original payload');
      expect(form.get('metadata')).toBe('preserved metadata');
      expect(readBlob.mock.contexts).toEqual([response]);
      expect(attacker).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['native stream', () => [readable()]],
    ['reader-only stream', () => [Object.assign(readable(), { [Symbol.asyncIterator]: undefined })]],
    [
      'foreign-realm stream',
      () => [
        runInNewContext(
          'Object.setPrototypeOf(stream, Object.create(null, Object.getOwnPropertyDescriptors(Host.prototype)))',
          { Host: ReadableStream, stream: readable() },
        ),
      ],
    ],
    ['branded stream', () => [toStreamingFile(readable(), 'shared.txt')]],
    [
      'shared Response body',
      () => {
        const stream = readable();
        return [new Response(stream as any), new Response(stream as any)];
      },
    ],
    ['reusable iterable', () => [{ [Symbol.asyncIterator]: () => chunks('shared') }, true]],
    ['reusable reader', () => [{ getReader: () => readable().getReader() }, true]],
    [
      'reusable named Blob',
      () => {
        const blob = Object.assign(new Blob(['shared']), { name: 'shared.txt' });
        const incidental = vi.fn(() => chunks('attacker'));
        const getIterator = vi.fn().mockReturnValueOnce(null).mockReturnValue(incidental);
        Object.defineProperty(blob, Symbol.asyncIterator, { get: getIterator });
        return [blob, true, incidental, getIterator];
      },
    ],
  ] as const)('preserves native reuse and rejects unsafe repeated %s sources', async (kind, values) => {
    const [first, secondOrReusable, incidental, getIterator] = values();
    const reusable = secondOrReusable === true;
    const second = reusable || secondOrReusable === undefined ? first : secondOrReusable;
    if (kind === 'foreign-realm stream') {
      expect(first).not.toBeInstanceOf(ReadableStream);
    }
    const body = {
      files: [first, second],
      ...(kind === 'shared Response body' || kind === 'reusable named Blob'
        ? { trigger: chunks('trigger') }
        : {}),
    };
    if (kind === 'reusable iterable' || kind === 'reusable reader') {
      await expect(readForm(body, maybeMultipartFormRequestOptions)).rejects.toThrow(/reus|repeat/iu);
      return;
    }

    const form = await readForm(body, maybeMultipartFormRequestOptions);
    await expect(Promise.all((form.getAll('files[]') as File[]).map((file) => file.text()))).resolves.toEqual(
      ['shared', reusable ? 'shared' : ''],
    );
    if (kind === 'reusable named Blob') {
      expect(getIterator).not.toHaveBeenCalled();
      expect(incidental).not.toHaveBeenCalled();
    }
  });

  test.each(['validation failure', 'multipart cancellation'] as const)(
    'cancels and unlocks unused shared readers after %s',
    async (outcome) => {
      const cancel = vi.fn();
      const stream = new ReadableStream<string>({ cancel });
      const later = toStreamingFile(stream, 'later.txt');
      const unused = { next: vi.fn(), return: vi.fn().mockResolvedValue({ done: true, value: undefined }) };
      const body: Record<string, unknown> = {
        earlier: chunks('earlier'),
        stream,
        later,
        unused: { [Symbol.asyncIterator]: () => unused },
      };
      if (outcome === 'validation failure') {
        const invalid = toStreamingFile(chunks(), 'invalid.txt');
        Object.defineProperty(invalid, 'name', { value: undefined });
        body['invalid'] = invalid;
      }
      const options = await multipartFormRequestOptions({ body }, fetch);
      const reader = (options.body as ReadableStream).getReader();
      if (outcome === 'validation failure') {
        await expect(reader.read()).rejects.toThrow(/file.?name/iu);
      } else {
        await reader.read();
        await reader.cancel();
      }
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(stream.locked).toBe(false);
      expect(unused.next).not.toHaveBeenCalled();
      expect(unused.return.mock.contexts).toEqual([unused]);
    },
  );
});
