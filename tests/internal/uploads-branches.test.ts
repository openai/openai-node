import { buildHeaders } from 'openai/internal/headers';
import { toFile } from 'openai/internal/to-file';
import {
  checkFileSupport,
  createForm,
  getName,
  isAsyncIterable,
  makeFile,
  maybeMultipartFormRequestOptions,
  multipartFormRequestOptions,
  toStreamingFile,
} from 'openai/internal/uploads';

describe('streaming upload metadata', () => {
  test('requires a filename and preserves an explicit content type', () => {
    async function* chunks() {
      yield 'content';
    }

    expect(() => toStreamingFile(chunks(), '')).toThrow('requires a non-empty file name');
    expect(toStreamingFile(chunks(), 'audio.wav')).not.toHaveProperty('type');
    expect(toStreamingFile(chunks(), 'audio.wav', { type: 'audio/wav' })).toMatchObject({
      name: 'audio.wav',
      type: 'audio/wav',
    });
  });

  test.each([
    [{ name: '/tmp/named.jsonl' }, 'named.jsonl'],
    [{ url: 'https://example.com/files/audio.wav' }, 'audio.wav'],
    [{ filename: 'C:\\recordings\\audio.wav' }, 'audio.wav'],
    [{ path: '/tmp/stream.bin' }, 'stream.bin'],
    [{ name: '', path: '/tmp/fallback.bin' }, 'fallback.bin'],
    [{}, undefined],
    [null, undefined],
    ['filename.txt', undefined],
  ] as const)('extracts upload filenames from supported metadata', (value, expected) => {
    expect(getName(value)).toBe(expected);
  });

  test('detects async iterables without treating arbitrary objects as streams', () => {
    const iterable = {
      async *[Symbol.asyncIterator]() {
        yield 'content';
      },
    };

    expect(isAsyncIterable(iterable)).toBe(true);
    expect(isAsyncIterable(null)).toBe(false);
    expect(isAsyncIterable('content')).toBe(false);
    expect(isAsyncIterable({ [Symbol.asyncIterator]: true })).toBe(false);
  });

  test('uses a fallback filename when constructing files without one', async () => {
    const file = makeFile(['content'], undefined, { type: 'text/plain' });

    expect(file.name).toBe('unknown_file');
    expect(file.type).toBe('text/plain');
    await expect(file.text()).resolves.toBe('content');
  });

  test('explains how unsupported Node.js releases can provide the File global', () => {
    const fileDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'File')!;
    const nodeDescriptor = Object.getOwnPropertyDescriptor(process.versions, 'node')!;

    try {
      Object.defineProperty(globalThis, 'File', { configurable: true, value: undefined });
      Object.defineProperty(process.versions, 'node', { configurable: true, value: '18.20.0' });

      expect(() => checkFileSupport()).toThrow('Update to a supported Node.js LTS release');
    } finally {
      Object.defineProperty(process.versions, 'node', nodeDescriptor);
      Object.defineProperty(globalThis, 'File', fileDescriptor);
    }
  });
});

describe('buffered multipart forms', () => {
  test('leaves requests without uploadable values unchanged', async () => {
    const options = { body: { nested: { count: 2, tags: ['first'] } } };

    await expect(maybeMultipartFormRequestOptions(options, fetch)).resolves.toBe(options);
  });

  test('creates buffered multipart forms for nested File values', async () => {
    const upload = new File(['file contents'], 'input.jsonl', { type: 'application/jsonl' });
    const options = await maybeMultipartFormRequestOptions(
      { body: { nested: { upload }, count: 2, enabled: false } },
      fetch,
    );

    expect(options.body).toBeInstanceOf(FormData);
    const form = options.body as FormData;
    expect(form.get('count')).toBe('2');
    expect(form.get('enabled')).toBe('false');
    expect(form.get('nested[upload]')).toBeInstanceOf(File);
  });

  test('serializes response bodies and async iterables into buffered File entries', async () => {
    async function* chunks() {
      yield new TextEncoder().encode('stream contents');
    }

    const form = await createForm({ response: new Response('response contents'), stream: chunks() }, fetch);

    const responseFile = form.get('response') as File;
    const streamFile = form.get('stream') as File;
    await expect(responseFile.text()).resolves.toBe('response contents');
    await expect(streamFile.text()).resolves.toBe('stream contents');
  });

  test('serializes nested arrays and skips undefined entries', async () => {
    const form = await createForm(
      {
        values: ['first', undefined, 3, false],
        nested: { value: 'nested', omitted: undefined },
      },
      fetch,
    );

    expect(form.getAll('values[]')).toEqual(['first', '3', 'false']);
    expect(form.get('nested[value]')).toBe('nested');
    expect(form.has('nested[omitted]')).toBe(false);
  });

  test('rejects null and unsupported primitive values', async () => {
    await expect(createForm({ value: null }, fetch)).rejects.toThrow('Received null for "value"');
    await expect(createForm({ value: BigInt(1) }, fetch)).rejects.toThrow('Invalid value given to form');
  });

  test('rejects fetch implementations that stringify FormData objects', async () => {
    class UnsupportedResponse {
      constructor(private readonly body: FormData) {}

      async text() {
        return this.body.toString();
      }
    }
    const unsupportedFetch = Object.assign(jest.fn(), { Response: UnsupportedResponse });

    await expect(createForm({}, unsupportedFetch as any)).rejects.toThrow(
      'fetch function does not support file uploads',
    );
    await expect(createForm({}, unsupportedFetch as any)).rejects.toThrow(
      'fetch function does not support file uploads',
    );
    expect(unsupportedFetch).not.toHaveBeenCalled();
  });

  test('treats failed FormData capability checks as supported and caches the result', async () => {
    const failingFetch = jest.fn().mockRejectedValue(new Error('capability probe failed'));
    const client = { fetch: failingFetch };

    await expect(createForm({}, client as any)).resolves.toBeInstanceOf(FormData);
    await expect(createForm({}, client as any)).resolves.toBeInstanceOf(FormData);
    expect(failingFetch).toHaveBeenCalledTimes(1);
    expect(failingFetch).toHaveBeenCalledWith('data:,');
  });
});

describe('lazy multipart stream encoding', () => {
  test('encodes mixed chunk formats and nested form fields without buffering', async () => {
    async function* nestedChunks() {
      yield new Uint8Array([69]);
    }

    async function* chunks() {
      yield 'A';
      yield new Uint8Array([66]);
      yield new DataView(new Uint8Array([67]).buffer);
      yield new Uint8Array([68]).buffer;
      yield nestedChunks() as any;
      yield new Response('F');
      yield new Response(null);
      yield new Blob(['G']);
    }

    const options = await multipartFormRequestOptions(
      {
        body: {
          upload: toStreamingFile(chunks() as any, 'quote"\\\r\n.wav', { type: 'audio/custom' }),
          values: ['first', 2, false],
          metadata: { enabled: true, omitted: undefined },
        },
      },
      fetch,
    );

    const body = await new Response(options.body as ReadableStream).text();

    expect(body).toContain('filename="quote%22%5C%0D%0A.wav"');
    expect(body).toContain('Content-Type: audio/custom');
    expect(body).toContain('ABCDEFG');
    expect(body).toContain('name="values[]"\r\n\r\nfirst');
    expect(body).toContain('name="values[]"\r\n\r\n2');
    expect(body).toContain('name="values[]"\r\n\r\nfalse');
    expect(body).toContain('name="metadata[enabled]"\r\n\r\ntrue');
    expect(body).not.toContain('metadata[omitted]');
  });

  test('encodes nested streaming files, named blobs, and response bodies', async () => {
    async function* stream() {
      yield 'streamed';
    }

    const options = await maybeMultipartFormRequestOptions(
      {
        body: {
          nested: [{ stream: toStreamingFile(stream(), 'stream.txt') }],
          named: new File(['named contents'], 'named.json', { type: 'application/json' }),
          response: new Response('response contents', { headers: { 'content-type': 'text/plain' } }),
          readable: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('readable contents'));
              controller.close();
            },
          }),
        },
        headers: { 'x-upload': 'yes' },
      },
      fetch,
    );

    const body = await new Response(options.body as ReadableStream).text();
    const headers = buildHeaders([options.headers]).values;

    expect(headers.get('x-upload')).toBe('yes');
    expect(headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=openai-/);
    expect(body).toContain('name="nested[][stream]"; filename="stream.txt"');
    expect(body).toContain('filename="named.json"');
    expect(body).toContain('Content-Type: application/json');
    expect(body).toContain('Content-Type: text/plain');
    expect(body).toContain('filename="unknown_file"');
    expect(body).toContain('streamed');
    expect(body).toContain('named contents');
    expect(body).toContain('response contents');
    expect(body).toContain('readable contents');
  });

  test('handles Blob implementations that do not expose stream()', async () => {
    const legacyBlob = new Blob(['legacy blob']);
    Object.defineProperty(legacyBlob, 'stream', { value: undefined });

    const options = await multipartFormRequestOptions(
      {
        body: {
          upload: toStreamingFile(
            (async function* () {
              yield legacyBlob;
            })(),
            'legacy.bin',
          ),
        },
      },
      fetch,
    );

    await expect(new Response(options.body as ReadableStream).text()).resolves.toContain('legacy blob');
  });

  test('reports null form fields and invalid stream chunks during consumption', async () => {
    async function* validChunks() {
      yield 'valid';
    }

    async function* invalidChunks() {
      yield 42 as any;
    }

    const invalidField = await multipartFormRequestOptions(
      { body: { upload: toStreamingFile(validChunks(), 'valid.bin'), value: null } },
      fetch,
    );
    await expect(new Response(invalidField.body as ReadableStream).text()).rejects.toThrow(
      'Received null for "value"',
    );

    const invalidChunk = await multipartFormRequestOptions(
      { body: { upload: toStreamingFile(invalidChunks(), 'invalid.bin') } },
      fetch,
    );
    await expect(new Response(invalidChunk.body as ReadableStream).text()).rejects.toThrow(
      'Invalid streaming file chunk: 42',
    );
  });

  test('reports unsupported streaming form field values', async () => {
    async function* chunks() {
      yield 'valid';
    }

    const options = await multipartFormRequestOptions(
      { body: { upload: toStreamingFile(chunks(), 'audio.wav'), invalid: BigInt(1) } },
      fetch,
    );

    await expect(new Response(options.body as ReadableStream).text()).rejects.toThrow(
      'Invalid value given to form',
    );
  });
});

describe('toFile input normalization', () => {
  test('resolves promised byte arrays and preserves explicit metadata', async () => {
    const file = await toFile(Promise.resolve(new Uint8Array([65, 66])), 'bytes.txt', { type: 'text/plain' });

    expect(file.name).toBe('bytes.txt');
    expect(file.type).toBe('text/plain');
    await expect(file.text()).resolves.toBe('AB');
  });

  test('converts compatible File-like objects to native File instances', async () => {
    const original = new Blob(['file-like']);
    const fileLike = {
      name: 'compatible.txt',
      lastModified: 1,
      size: original.size,
      type: original.type,
      text: original.text.bind(original),
      slice: original.slice.bind(original),
      arrayBuffer: original.arrayBuffer.bind(original),
    };

    const file = await toFile(fileLike);

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('compatible.txt');
    await expect(file.text()).resolves.toBe('file-like');
  });

  test('uses explicit response filenames and declared MIME types', async () => {
    const response = {
      url: 'https://example.com/original.wav',
      blob: async () => new Blob(['response'], { type: 'audio/wav' }),
    };

    const file = await toFile(response, 'override.wav', { type: 'audio/custom' });

    expect(file.name).toBe('override.wav');
    expect(file.type).toBe('audio/custom');
    await expect(file.text()).resolves.toBe('response');
  });

  test('recursively consumes mixed async iterable file chunks', async () => {
    async function* chunks() {
      yield new Uint8Array([65]);
      yield new DataView(new Uint8Array([66]).buffer);
      yield new Uint8Array([67]).buffer;
      yield new Blob(['D']);
    }

    const file = await toFile(chunks(), 'mixed.bin');

    await expect(file.text()).resolves.toBe('ABCD');
  });

  test('describes invalid null and primitive file inputs', async () => {
    await expect(toFile(null as any)).rejects.toThrow('Unexpected data type: object');
    await expect(toFile(123 as any)).rejects.toThrow('Unexpected data type: number');
  });
});
