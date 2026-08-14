import { vi } from 'vitest';

import OpenAI from 'openai';
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
    ['a plain object', { replace: () => 'upload.txt' }],
    ['a boxed string', new Object('upload.txt')],
    ['a number', 42],
    ['a symbol', Symbol('upload.txt')],
    ['a boolean', true],
    ['null', null],
    ['undefined', undefined],
  ] as const)('rejects %s as a streaming filename without coercing it', (_, name) => {
    async function* chunks() {
      yield 'content';
    }

    expect(() => toStreamingFile(chunks(), name as any)).toThrow(TypeError);
    expect(() => toStreamingFile(chunks(), name as any)).toThrow(/file.?name/i);
  });

  test('rejects attacker-controlled filename methods without invoking them', () => {
    async function* chunks() {
      yield 'content';
    }

    const replace = vi.fn().mockReturnValue('attacker.txt');
    const toString = vi.fn().mockReturnValue('attacker.txt');

    expect(() => toStreamingFile(chunks(), { replace, toString } as any)).toThrow(TypeError);
    expect(replace).not.toHaveBeenCalled();
    expect(toString).not.toHaveBeenCalled();
  });

  test('accepts nonempty primitive Unicode filenames', () => {
    async function* chunks() {
      yield 'content';
    }

    expect(toStreamingFile(chunks(), 'résumé-東京🎵.wav').name).toBe('résumé-東京🎵.wav');
  });

  test.each([
    ['CRLF header injection', 'text/plain\r\nContent-Disposition: form-data; name="purpose"'],
    ['CR', 'text/plain\r'],
    ['LF', 'text/plain\n'],
    ['NUL', 'text/plain\0'],
    ['HTAB', 'text/plain\t'],
    ['C0 control', 'text/plain\u001F'],
    ['DEL', 'text/plain\u007F'],
  ] as const)('rejects %s in streaming content types synchronously', (_, type) => {
    async function* chunks() {
      yield 'content';
    }

    expect(() => toStreamingFile(chunks(), 'upload.txt', { type })).toThrow(TypeError);
    expect(() => toStreamingFile(chunks(), 'upload.txt', { type })).toThrow(/content.type/i);
  });

  test.each([
    'TEXT/PLAIN; charset=UTF-8',
    '  TEXT/PLAIN; charset=UTF-8  ',
    'text/x-café; note=こんにちは',
  ] as const)('preserves valid content types unchanged: %s', (type) => {
    async function* chunks() {
      yield 'content';
    }

    expect(toStreamingFile(chunks(), 'upload.txt', { type }).type).toBe(type);
  });

  test('reads streaming content type metadata only once', () => {
    async function* chunks() {
      yield 'content';
    }

    const getType = vi
      .fn()
      .mockReturnValueOnce('text/plain')
      .mockReturnValue('text/plain\r\nContent-Disposition: form-data; name="purpose"');
    const options = Object.defineProperty({}, 'type', { get: getType });

    expect(toStreamingFile(chunks(), 'upload.txt', options)).toHaveProperty('type', 'text/plain');
    expect(getType).toHaveBeenCalledTimes(1);
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

  test.each([
    [{ name: 'my-skill/SKILL.md' }, 'my-skill/SKILL.md'],
    [{ filename: 'my-skill/assets/data.json' }, 'my-skill/assets/data.json'],
    [{ name: 'my-skill\\SKILL.md' }, 'my-skill/SKILL.md'],
    [{ filename: 'my-skill\\assets\\data.json' }, 'my-skill/assets/data.json'],
    [{ url: 'https://example.com/private/remote.txt?signature=example#fragment' }, 'remote.txt'],
    [{ path: '/private/tmp/local.txt' }, 'local.txt'],
    [{ path: 'C:\\private\\nested\\local.txt' }, 'local.txt'],
  ] as const)('preserves only explicitly supplied filename paths', (value, expected) => {
    expect(getName(value, { stripFilename: false })).toBe(expected);
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

  test('preserves explicit nested file paths only when requested', async () => {
    const upload = new File(['manifest'], 'my-skill/SKILL.md');
    const defaultOptions = await maybeMultipartFormRequestOptions({ body: { nested: { upload } } }, fetch);
    const preservedOptions = await maybeMultipartFormRequestOptions({ body: { nested: { upload } } }, fetch, {
      stripFilenames: false,
    });

    expect(((defaultOptions.body as FormData).get('nested[upload]') as File).name).toBe('SKILL.md');
    expect(((preservedOptions.body as FormData).get('nested[upload]') as File).name).toBe(
      'my-skill/SKILL.md',
    );
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
    await expect(createForm({ value: 1n }, fetch)).rejects.toThrow('Invalid value given to form');
  });

  test('rejects fetch implementations that stringify FormData objects', async () => {
    class UnsupportedResponse {
      private readonly body: FormData;

      constructor(body: FormData) {
        this.body = body;
      }

      async text() {
        return this.body.toString();
      }
    }
    const unsupportedFetch = Object.assign(vi.fn(), { Response: UnsupportedResponse });

    await expect(createForm({}, unsupportedFetch as any)).rejects.toThrow(
      'fetch function does not support file uploads',
    );
    await expect(createForm({}, unsupportedFetch as any)).rejects.toThrow(
      'fetch function does not support file uploads',
    );
    expect(unsupportedFetch).not.toHaveBeenCalled();
  });

  test('consumes FormData capability probe responses and caches the result', async () => {
    const response = new Response('');
    const probingFetch = vi.fn().mockResolvedValue(response);

    await expect(createForm({}, probingFetch)).resolves.toBeInstanceOf(FormData);
    await expect(createForm({}, probingFetch)).resolves.toBeInstanceOf(FormData);

    expect(probingFetch).toHaveBeenCalledTimes(1);
    expect(probingFetch).toHaveBeenCalledWith('data:,');
    expect(response.bodyUsed).toBe(true);
  });

  test('treats failed FormData capability checks as supported and caches the result', async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error('capability probe failed'));
    const client = { fetch: failingFetch };

    await expect(createForm({}, client as any)).resolves.toBeInstanceOf(FormData);
    await expect(createForm({}, client as any)).resolves.toBeInstanceOf(FormData);
    expect(failingFetch).toHaveBeenCalledTimes(1);
    expect(failingFetch).toHaveBeenCalledWith('data:,');
  });
});

describe('lazy multipart stream encoding', () => {
  test.each([
    ['an empty filename', ''],
    ['a boxed string', new Object('upload.txt')],
    ['a plain object', { replace: () => 'upload.txt', toString: () => 'upload.txt' }],
    ['a number', 42],
    ['a symbol', Symbol('upload.txt')],
    ['null', null],
    ['undefined', undefined],
  ] as const)('rejects a filename mutated to %s before emitting its multipart boundary', async (_, name) => {
    async function* chunks() {
      yield 'sensitive upload bytes';
    }

    const upload = toStreamingFile(chunks(), 'safe.txt');
    Object.defineProperty(upload, 'name', { value: name });

    const options = await multipartFormRequestOptions({ body: { upload } }, fetch);
    const reader = (options.body as ReadableStream).getReader();

    await expect(reader.read()).rejects.toThrow(TypeError);
    await expect(reader.closed).rejects.toThrow(/file.?name/i);
  });

  test.each([
    ['default filename stripping', undefined],
    ['explicit path preservation', { stripFilenames: false }],
  ] as const)(
    'rejects mutated filename methods that forge duplicate multipart fields with %s',
    async (_, formOptions) => {
      async function* chunks() {
        yield 'sensitive upload bytes';
      }

      let boundary = '';
      let normalized = false;
      const replace = vi.fn().mockImplementation(() => {
        if (formOptions?.stripFilenames === false && !normalized) {
          normalized = true;
          return { replace };
        }

        return (
          'ok.txt"\r\n\r\nspoof\r\n' +
          `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nattacker\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="upload"; filename="ok.txt`
        );
      });
      const upload = toStreamingFile(chunks(), 'safe.txt');
      Object.defineProperty(upload, 'name', { value: { replace } });

      const options = await multipartFormRequestOptions(
        { body: { upload, purpose: 'assistants' } },
        fetch,
        formOptions,
      );
      const contentType = buildHeaders([options.headers]).values.get('content-type')!;
      boundary = contentType.split('boundary=')[1]?.split(';')[0] ?? '';

      const outcome = await new Response(options.body as ReadableStream, {
        headers: { 'content-type': contentType },
      })
        .formData()
        .then(
          (form) => ({ hasUpload: form.has('upload'), purposes: form.getAll('purpose') }),
          (error: unknown) => error,
        );

      expect(boundary).not.toBe('');
      expect(outcome).toBeInstanceOf(TypeError);
      expect(outcome).toHaveProperty('message', expect.stringMatching(/file.?name/i));
      expect(replace).not.toHaveBeenCalled();
    },
  );

  test('reads a mutable streaming filename only once before escaping multipart headers', async () => {
    async function* chunks() {
      yield 'sensitive upload bytes';
    }

    const replace = vi.fn().mockReturnValue('attacker.txt');
    const getFilename = vi.fn().mockReturnValueOnce('safe.txt').mockReturnValue({ replace });
    const upload = toStreamingFile(chunks(), 'original.txt');
    Object.defineProperty(upload, 'name', { get: getFilename });

    const options = await multipartFormRequestOptions({ body: { upload, purpose: 'assistants' } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type')!;
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();

    expect(getFilename).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(form.getAll('purpose')).toEqual(['assistants']);
    expect((form.get('upload') as File).name).toBe('safe.txt');
  });

  test('rejects mutated content types instead of injecting duplicate form parameters', async () => {
    async function* chunks() {
      yield 'sensitive upload bytes';
    }

    const upload = toStreamingFile(chunks(), 'secret.txt', { type: 'text/plain' });
    Object.defineProperty(upload, 'type', {
      value: 'text/plain\r\nContent-Disposition: form-data; name="purpose"',
    });

    const options = await multipartFormRequestOptions({ body: { upload, purpose: 'assistants' } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type')!;
    const outcome = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    })
      .formData()
      .then(
        (form) => ({ hasUpload: form.has('upload'), purposes: form.getAll('purpose') }),
        (error: unknown) => error,
      );

    expect(outcome).toBeInstanceOf(TypeError);
    expect(outcome).toHaveProperty('message', expect.stringMatching(/content.type/i));
  });

  test('rejects a mutated content type before emitting its multipart boundary', async () => {
    async function* chunks() {
      yield 'sensitive upload bytes';
    }

    const upload = toStreamingFile(chunks(), 'secret.txt', { type: 'text/plain' });
    Object.defineProperty(upload, 'type', {
      value: 'text/plain\r\nContent-Disposition: form-data; name="purpose"',
    });

    const options = await multipartFormRequestOptions({ body: { upload } }, fetch);
    const reader = (options.body as ReadableStream).getReader();

    await expect(reader.read()).rejects.toThrow(/content.type/i);
  });

  test('rejects mutable content types that inject headers through string coercion', async () => {
    async function* chunks() {
      yield 'sensitive upload bytes';
    }

    const upload = toStreamingFile(chunks(), 'secret.txt', { type: 'text/plain' });
    Object.defineProperty(upload, 'type', {
      value: {
        length: 0,
        toString: () => 'text/plain\r\nContent-Disposition: form-data; name="purpose"',
      },
    });

    const options = await multipartFormRequestOptions({ body: { upload, purpose: 'assistants' } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type')!;
    const outcome = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    })
      .formData()
      .then(
        (form) => ({ hasUpload: form.has('upload'), purposes: form.getAll('purpose') }),
        (error: unknown) => error,
      );

    expect(outcome).toBeInstanceOf(TypeError);
    expect(outcome).toHaveProperty('message', expect.stringMatching(/content.type/i));
  });

  test('rejects malicious File content types in mixed streaming forms before emitting a boundary', async () => {
    const maliciousFile = new File(['sensitive upload bytes'], 'secret.txt');
    Object.defineProperty(maliciousFile, 'type', {
      get: () => 'text/plain\r\nContent-Disposition: form-data; name="purpose"',
    });

    async function* chunks() {
      yield 'safe stream';
    }

    const options = await maybeMultipartFormRequestOptions(
      {
        body: {
          upload: maliciousFile,
          stream: toStreamingFile(chunks(), 'safe.txt'),
          purpose: 'assistants',
        },
      },
      fetch,
    );
    const reader = (options.body as ReadableStream).getReader();

    await expect(reader.read()).rejects.toThrow(/content.type/i);
  });

  test('reads File content types only once while encoding mixed streaming forms', async () => {
    const upload = new File(['sensitive upload bytes'], 'secret.txt');
    const getType = vi
      .fn()
      .mockReturnValueOnce('text/plain')
      .mockReturnValue('text/plain\r\nContent-Disposition: form-data; name="purpose"');
    Object.defineProperty(upload, 'type', { get: getType });

    async function* chunks() {
      yield 'safe stream';
    }

    const options = await maybeMultipartFormRequestOptions(
      {
        body: {
          upload,
          stream: toStreamingFile(chunks(), 'safe.txt'),
          purpose: 'assistants',
        },
      },
      fetch,
    );
    const contentType = buildHeaders([options.headers]).values.get('content-type')!;
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();

    expect(getType).toHaveBeenCalledTimes(1);
    expect(form.getAll('purpose')).toEqual(['assistants']);
    expect(form.get('upload')).toBeInstanceOf(File);
  });

  test('preserves content type case and parameters while encoding streaming files', async () => {
    async function* chunks() {
      yield 'content';
    }

    const options = await multipartFormRequestOptions(
      {
        body: {
          upload: toStreamingFile(chunks(), 'upload.txt', { type: 'TEXT/PLAIN; charset=UTF-8' }),
        },
      },
      fetch,
    );

    await expect(new Response(options.body as ReadableStream).text()).resolves.toContain(
      'Content-Type: TEXT/PLAIN; charset=UTF-8',
    );
  });

  test('retains the default content type for streaming files', async () => {
    async function* chunks() {
      yield 'content';
    }

    const options = await multipartFormRequestOptions(
      { body: { upload: toStreamingFile(chunks(), 'upload.bin') } },
      fetch,
    );

    await expect(new Response(options.body as ReadableStream).text()).resolves.toContain(
      'Content-Type: application/octet-stream',
    );
  });

  test.each([
    ['an absolute POSIX path', '/Users/alice/private/report.txt', 'report.txt'],
    ['an absolute Windows path', 'C:\\Users\\alice\\private\\report.txt', 'report.txt'],
    ['a nested relative path', 'private/nested/report.txt', 'report.txt'],
    ['mixed path separators', 'private\\nested/deeper\\report.txt', 'report.txt'],
    ['a plain filename', 'report.txt', 'report.txt'],
  ] as const)(
    'strips directories from %s in serialized streaming multipart headers',
    async (_, name, filename) => {
      async function* chunks() {
        yield 'content';
      }

      const options = await multipartFormRequestOptions(
        { body: { upload: toStreamingFile(chunks(), name) } },
        fetch,
      );
      const body = await new Response(options.body as ReadableStream).text();

      expect(body).toContain(`Content-Disposition: form-data; name="upload"; filename="${filename}"\r\n`);
    },
  );

  test.each([
    ['conditional multipart', maybeMultipartFormRequestOptions],
    ['required multipart', multipartFormRequestOptions],
  ] as const)('strips private streaming filename paths from %s headers', async (_, encodeRequest) => {
    async function* chunks() {
      yield 'content';
    }

    const options = await encodeRequest(
      { body: { upload: toStreamingFile(chunks(), 'C:\\Users\\alice\\private\\report.txt') } },
      fetch,
    );
    const body = await new Response(options.body as ReadableStream).text();

    expect(body).toContain('Content-Disposition: form-data; name="upload"; filename="report.txt"\r\n');
    expect(body).not.toContain('alice');
    expect(body).not.toContain('private');
  });

  test('preserves Unicode streaming filenames while stripping private directory names', async () => {
    async function* chunks() {
      yield 'content';
    }

    const options = await multipartFormRequestOptions(
      { body: { upload: toStreamingFile(chunks(), '/Users/alice/private/résumé-東京🎵.wav') } },
      fetch,
    );
    const body = await new Response(options.body as ReadableStream).text();

    expect(body).toContain('Content-Disposition: form-data; name="upload"; filename="résumé-東京🎵.wav"\r\n');
    expect(body).not.toContain('/Users/alice/private/');
  });

  test('percent-encodes every C0 control and DEL while preserving existing escapes and Unicode', async () => {
    async function* chunks() {
      yield 'streamed contents';
    }

    const controls = Array.from({ length: 32 }, (_, codePoint) => String.fromCodePoint(codePoint)).join('');
    const escapedControls = Array.from(
      { length: 32 },
      (_, codePoint) => `%${codePoint.toString(16).toUpperCase().padStart(2, '0')}`,
    ).join('');
    const fieldName = `field"${controls}\u007F\\résumé`;
    const filename = `résumé"${controls}\u007F東京🎵.txt`;

    const options = await multipartFormRequestOptions(
      { body: { [fieldName]: toStreamingFile(chunks(), filename) } },
      fetch,
    );
    const body = await new Response(options.body as ReadableStream).text();

    expect(body).toContain(
      `Content-Disposition: form-data; name="field%22${escapedControls}%7F%5Crésumé"; filename="résumé%22${escapedControls}%7F東京🎵.txt"\r\n`,
    );
  });

  test.each([
    ['NUL', '\0', '%00'],
    ['a non-newline C0 control', '\u0001', '%01'],
    ['HTAB', '\t', '%09'],
    ['the highest C0 control', '\u001F', '%1F'],
    ['DEL', '\u007F', '%7F'],
  ] as const)(
    'serializes and parses branded streaming filenames and field names containing %s',
    async (_, control, escaped) => {
      async function* chunks() {
        yield 'streamed contents';
      }

      const fileField = `upload${control}résumé`;
      const metadataField = `note${control}東京`;
      const filename = `résumé${control}東京🎵.txt`;
      const options = await multipartFormRequestOptions(
        {
          body: {
            [fileField]: toStreamingFile(chunks(), filename),
            [metadataField]: 'safe metadata',
          },
        },
        fetch,
      );
      const contentType = buildHeaders([options.headers]).values.get('content-type')!;
      const body = await new Response(options.body as ReadableStream).text();

      expect(body).toContain(
        `Content-Disposition: form-data; name="upload${escaped}résumé"; filename="résumé${escaped}東京🎵.txt"\r\n`,
      );
      expect(body).toContain(`name="note${escaped}東京"\r\n\r\nsafe metadata`);
      expect(body).not.toContain(control);

      const form = await new Response(body, {
        headers: { 'content-type': contentType },
      }).formData();
      const uploaded = form.get(`upload${escaped}résumé`) as File;

      expect(uploaded.name).toBe(`résumé${escaped}東京🎵.txt`);
      await expect(uploaded.text()).resolves.toBe('streamed contents');
      expect(form.get(`note${escaped}東京`)).toBe('safe metadata');
    },
  );

  test('sends only the streaming filename basename through the public transcription API', async () => {
    async function* chunks() {
      yield 'sensitive audio bytes';
    }

    let requestURL = '';
    let requestBody = '';
    let requestContentType: string | null = null;
    const client = new OpenAI({
      apiKey: 'test-key',
      fetch: async (url, init) => {
        requestURL = String(url);
        requestContentType = new Headers(init?.headers).get('content-type');
        requestBody = await new Response(init?.body as ReadableStream).text();

        return Response.json({ text: 'transcribed' });
      },
    });

    await client.audio.transcriptions.create({
      file: toStreamingFile(chunks(), '/Users/alice/private/medical.wav'),
      model: 'whisper-1',
    });

    expect(requestURL).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(requestContentType).toMatch(/^multipart\/form-data; boundary=openai-/);
    expect(requestBody).toContain('Content-Disposition: form-data; name="file"; filename="medical.wav"\r\n');
    expect(requestBody).toContain('name="model"\r\n\r\nwhisper-1');
    expect(requestBody).not.toContain('/Users/alice/private/');
  });

  test.each([
    ['POSIX separators', 'my-skill/assets/report.txt', 'my-skill/assets/report.txt'],
    ['Windows separators', 'my-skill\\assets\\report.txt', 'my-skill/assets/report.txt'],
    ['mixed separators', 'my-skill/assets\\nested\\report.txt', 'my-skill/assets/nested/report.txt'],
  ] as const)(
    'preserves normalized streaming filename paths with %s when explicitly requested',
    async (_, name, filename) => {
      async function* chunks() {
        yield 'content';
      }

      const options = await multipartFormRequestOptions(
        { body: { upload: toStreamingFile(chunks(), name) } },
        fetch,
        { stripFilenames: false },
      );
      const body = await new Response(options.body as ReadableStream).text();

      expect(body).toContain(`Content-Disposition: form-data; name="upload"; filename="${filename}"\r\n`);
    },
  );

  test('continues stripping ordinary File paths when streaming is enabled', async () => {
    async function* chunks() {
      yield 'streamed';
    }

    const options = await maybeMultipartFormRequestOptions(
      {
        body: {
          files: [new File(['manifest'], 'my-skill/SKILL.md'), toStreamingFile(chunks(), 'stream.txt')],
        },
      },
      fetch,
    );
    const body = await new Response(options.body as ReadableStream).text();

    expect(body).toContain('filename="SKILL.md"');
    expect(body).toContain('filename="stream.txt"');
    expect(body).not.toContain('my-skill/SKILL.md');
  });

  test.each([
    ['NUL', '\0', '%00'],
    ['a non-newline C0 control', '\u0001', '%01'],
    ['DEL', '\u007F', '%7F'],
  ] as const)(
    'serializes and parses %s in mixed native files, foreign named blobs, and streaming files',
    async (_, control, escaped) => {
      async function* chunks() {
        yield 'streamed contents';
      }

      const filesField = `files${control}`;
      const purposeField = `purpose${control}`;
      const foreignBlob = Object.assign(new Blob(['foreign contents']), {
        name: `foreign${control}東京.txt`,
      });
      const options = await maybeMultipartFormRequestOptions(
        {
          body: {
            [filesField]: [
              new File(['native contents'], `native${control}résumé.txt`),
              foreignBlob,
              toStreamingFile(chunks(), `stream${control}🎵.txt`),
            ],
            [purposeField]: 'assistants',
          },
        },
        fetch,
      );
      const contentType = buildHeaders([options.headers]).values.get('content-type')!;
      const body = await new Response(options.body as ReadableStream).text();

      expect(body).toContain(`name="files${escaped}[]"; filename="native${escaped}résumé.txt"`);
      expect(body).toContain(`name="files${escaped}[]"; filename="foreign${escaped}東京.txt"`);
      expect(body).toContain(`name="files${escaped}[]"; filename="stream${escaped}🎵.txt"`);
      expect(body).toContain(`name="purpose${escaped}"\r\n\r\nassistants`);
      expect(body).not.toContain(control);

      const form = await new Response(body, {
        headers: { 'content-type': contentType },
      }).formData();
      const files = form.getAll(`files${escaped}[]`) as File[];

      expect(files.map((file) => file.name)).toEqual([
        `native${escaped}résumé.txt`,
        `foreign${escaped}東京.txt`,
        `stream${escaped}🎵.txt`,
      ]);
      await expect(Promise.all(files.map((file) => file.text()))).resolves.toEqual([
        'native contents',
        'foreign contents',
        'streamed contents',
      ]);
      expect(form.get(`purpose${escaped}`)).toBe('assistants');
    },
  );

  test.each([
    ['conditional multipart', maybeMultipartFormRequestOptions],
    ['required multipart', multipartFormRequestOptions],
  ] as const)('preserves explicit paths but never inferred paths in %s streams', async (_, encodeRequest) => {
    const response = new Response('downloaded');
    Object.defineProperty(response, 'url', {
      value: 'https://example.com/private/remote.txt?signature=example#fragment',
    });

    async function* chunks() {
      yield 'streamed';
    }

    const filesystemStream = Object.assign(chunks(), { path: '/private/tmp/local.txt' });
    const options = await encodeRequest(
      {
        body: {
          files: [
            new File(['manifest'], 'my-skill/SKILL.md'),
            toStreamingFile(chunks(), 'my-skill/assets/data.txt'),
            response,
            filesystemStream,
          ],
        },
      },
      fetch,
      { stripFilenames: false },
    );
    const body = await new Response(options.body as ReadableStream).text();

    expect(body).toContain('filename="my-skill/SKILL.md"');
    expect(body).toContain('filename="my-skill/assets/data.txt"');
    expect(body).toContain('filename="remote.txt"');
    expect(body).toContain('filename="local.txt"');
    expect(body).not.toContain('/private/');
    expect(body).not.toContain('signature=example');
  });

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
          upload: toStreamingFile(chunks() as any, 'folder\\quote"\r\n.wav', { type: 'audio/custom' }),
          values: ['first', 2, false],
          metadata: { enabled: true, omitted: undefined },
        },
      },
      fetch,
    );

    const body = await new Response(options.body as ReadableStream).text();

    expect(body).toContain('filename="quote%22%0D%0A.wav"');
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
            (async function* upload() {
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
      { body: { upload: toStreamingFile(chunks(), 'audio.wav'), invalid: 1n } },
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
