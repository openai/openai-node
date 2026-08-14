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

  test.each([
    ['default filename stripping', undefined],
    ['explicit path preservation', { stripFilenames: false }],
  ] as const)(
    'rejects mutated filename methods that forge duplicate multipart fields with %s',
    async (_, formOptions) => {
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
      const upload = toStreamingFile(chunks('sensitive upload bytes'), 'safe.txt');
      Object.defineProperty(upload, 'name', { value: { replace } });

      const options = await multipartFormRequestOptions(
        { body: { upload, purpose: 'assistants' } },
        fetch,
        formOptions,
      );
      const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
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
      expect(outcome).toHaveProperty('message', expect.stringMatching(/file.?name/iu));
      expect(replace).not.toHaveBeenCalled();
    },
  );

  test('reads a mutable streaming filename only once before escaping multipart headers', async () => {
    const replace = vi.fn().mockReturnValue('attacker.txt');
    const getFilename = vi.fn().mockReturnValueOnce('safe.txt').mockReturnValue({ replace });
    const upload = toStreamingFile(chunks('sensitive upload bytes'), 'original.txt');
    Object.defineProperty(upload, 'name', { get: getFilename });

    const options = await multipartFormRequestOptions({ body: { upload, purpose: 'assistants' } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();

    expect(getFilename).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(form.getAll('purpose')).toEqual(['assistants']);
    expect((form.get('upload') as File).name).toBe('safe.txt');
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
    const options = await multipartFormRequestOptions(
      { body: { upload: toStreamingFile(chunks(), '/Users/alice/private/résumé-東京🎵.wav') } },
      fetch,
    );
    const body = await new Response(options.body as ReadableStream).text();

    expect(body).toContain('Content-Disposition: form-data; name="upload"; filename="résumé-東京🎵.wav"\r\n');
    expect(body).not.toContain('/Users/alice/private/');
  });

  test('percent-encodes every C0 control and DEL while preserving existing escapes and Unicode', async () => {
    const controls = Array.from({ length: 32 }, (_, codePoint) => String.fromCodePoint(codePoint)).join('');
    const escapedControls = Array.from(
      { length: 32 },
      (_, codePoint) => `%${codePoint.toString(16).toUpperCase().padStart(2, '0')}`,
    ).join('');
    const fieldName = `field"${controls}\u007F\\résumé`;
    const filename = `résumé"${controls}\u007F東京🎵.txt`;

    const options = await multipartFormRequestOptions(
      { body: { [fieldName]: toStreamingFile(chunks('streamed contents'), filename) } },
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
      const fileField = `upload${control}résumé`;
      const metadataField = `note${control}東京`;
      const filename = `résumé${control}東京🎵.txt`;
      const options = await multipartFormRequestOptions(
        {
          body: {
            [fileField]: toStreamingFile(chunks('streamed contents'), filename),
            [metadataField]: 'safe metadata',
          },
        },
        fetch,
      );
      const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
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
      file: toStreamingFile(chunks('sensitive audio bytes'), '/Users/alice/private/medical.wav'),
      model: 'whisper-1',
    });

    expect(requestURL).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(requestContentType).toMatch(/^multipart\/form-data; boundary=openai-/u);
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
    ['a non-newline C0 control', '\u0001', '%01'],
    ['DEL', '\u007F', '%7F'],
  ] as const)(
    'serializes and parses %s in mixed native files, foreign named blobs, and streaming files',
    async (_, control, escaped) => {
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
              toStreamingFile(chunks('streamed contents'), `stream${control}🎵.txt`),
            ],
            [purposeField]: 'assistants',
          },
        },
        fetch,
      );
      const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
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

  test('preserves lone-surrogate replacement while escaping serialized multipart headers', async () => {
    const fileField = `upload\uD800"\0\uDC00\\🎵`;
    const metadataField = `note\uDC00\r\n\uD800東京`;
    const filename = `résumé\uD800"\u007F\uDC00🎵.txt`;
    const upload = toStreamingFile(chunks('streamed contents'), filename);

    expect(upload.name).toBe(filename);

    const options = await multipartFormRequestOptions(
      {
        body: {
          [fileField]: upload,
          [metadataField]: 'safe metadata',
        },
      },
      fetch,
    );
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const body = await new Response(options.body as ReadableStream).text();
    const escapedFileField = 'upload\uFFFD%22%00\uFFFD%5C🎵';
    const escapedFilename = 'résumé\uFFFD%22%7F\uFFFD🎵.txt';
    const escapedMetadataField = 'note\uFFFD%0D%0A\uFFFD東京';

    expect(body).toContain(
      `Content-Disposition: form-data; name="${escapedFileField}"; filename="${escapedFilename}"\r\n`,
    );
    expect(body).toContain(`name="${escapedMetadataField}"\r\n\r\nsafe metadata`);

    const form = await new Response(body, {
      headers: { 'content-type': contentType },
    }).formData();
    const parsedFileField = 'upload\uFFFD"%00\uFFFD%5C🎵';
    const parsedFilename = 'résumé\uFFFD"%7F\uFFFD🎵.txt';
    const parsedMetadataField = 'note\uFFFD\r\n\uFFFD東京';
    const uploaded = form.get(parsedFileField) as File;

    expect(uploaded.name).toBe(parsedFilename);
    await expect(uploaded.text()).resolves.toBe('streamed contents');
    expect(form.get(parsedMetadataField)).toBe('safe metadata');
  });
});
