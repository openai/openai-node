import fs from 'node:fs';

import {
  createForm,
  maybeMultipartFormRequestOptions,
  multipartFormRequestOptions,
  toStreamingFile,
} from 'openai/internal/uploads';
import { buildHeaders } from 'openai/internal/headers';
import { toFile } from 'openai/core/uploads';

describe('form data validation', () => {
  test('valid values do not error', async () => {
    await multipartFormRequestOptions(
      {
        body: {
          foo: 'foo',
          string: 1,
          bool: true,
          file: await toFile(Buffer.from('some-content')),
          blob: new Blob(['Some content'], { type: 'text/plain' }),
        },
      },
      fetch,
    );
  });

  test('null', async () => {
    await expect(() =>
      multipartFormRequestOptions(
        {
          body: {
            null: null,
          },
        },
        fetch,
      ),
    ).rejects.toThrow(TypeError);
  });

  test('undefined is stripped', async () => {
    const form = await createForm(
      {
        foo: undefined,
        bar: 'baz',
      },
      fetch,
    );
    expect(form.has('foo')).toBe(false);
    expect(form.get('bar')).toBe('baz');
  });

  test('nested undefined property is stripped', async () => {
    const form = await createForm(
      {
        bar: {
          baz: undefined,
        },
      },
      fetch,
    );
    expect([...form.entries()]).toEqual([]);

    const form2 = await createForm(
      {
        bar: {
          foo: 'string',
          baz: undefined,
        },
      },
      fetch,
    );
    expect([...form2.entries()]).toEqual([['bar[foo]', 'string']]);
  });

  test('nested undefined array item is stripped', async () => {
    const form = await createForm(
      {
        bar: [undefined, undefined],
      },
      fetch,
    );
    expect([...form.entries()]).toEqual([]);

    const form2 = await createForm(
      {
        bar: [undefined, 'foo'],
      },
      fetch,
    );
    expect([...form2.entries()]).toEqual([['bar[]', 'foo']]);
  });

  test('ignores inherited enumerable getters while detecting multipart uploads', async () => {
    let inheritedReads = 0;
    const prototype = Object.defineProperty({}, 'unserialized', {
      enumerable: true,
      get() {
        inheritedReads += 1;
        throw new Error('inherited getter was read');
      },
    });
    const plain = Object.assign(Object.create(prototype), { value: 'safe' });
    const unchanged = { body: { nested: plain } };

    await expect(maybeMultipartFormRequestOptions(unchanged, fetch)).resolves.toBe(unchanged);

    async function* chunks() {
      yield 'safe upload bytes';
    }

    const nested = Object.assign(Object.create(prototype), {
      upload: toStreamingFile(chunks(), 'safe.txt'),
    });
    const options = await multipartFormRequestOptions({ body: { nested } }, fetch);
    const encoded = await new Response(options.body as ReadableStream).text();

    expect(encoded).toContain('name="nested[upload]"; filename="safe.txt"');
    expect(encoded).toContain('safe upload bytes');
    expect(encoded).not.toContain('unserialized');
    expect(inheritedReads).toBe(0);
  });

  test('does not let inherited enumerable getters mutate earlier multipart uploads', async () => {
    async function* chunks(content: string) {
      yield content;
    }

    const earlier = toStreamingFile(chunks('original upload bytes'), 'original.txt');
    let inheritedReads = 0;
    const prototype = Object.defineProperty({}, 'unserialized', {
      enumerable: true,
      get() {
        inheritedReads += 1;
        Object.defineProperties(earlier, {
          data: { value: chunks('substituted upload bytes') },
          name: { value: 'substituted.txt' },
        });
        return 'poisoned';
      },
    });
    const later = Object.assign(Object.create(prototype), { value: 'safe' });
    const options = await multipartFormRequestOptions({ body: { earlier, later } }, fetch);
    const contentType = buildHeaders([options.headers]).values.get('content-type') ?? '';
    const form = await new Response(options.body as ReadableStream, {
      headers: { 'content-type': contentType },
    }).formData();
    const upload = form.get('earlier') as File;

    expect(upload.name).toBe('original.txt');
    await expect(upload.text()).resolves.toBe('original upload bytes');
    expect(form.get('later[value]')).toBe('safe');
    expect(form.has('later[unserialized]')).toBe(false);
    expect(inheritedReads).toBe(0);
  });

  test('streams multipart file content lazily', async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 3) {
          controller.enqueue(new TextEncoder().encode(`streamed-content-${pulls}`));
        } else {
          controller.close();
        }
      },
    });

    const options = await multipartFormRequestOptions(
      {
        body: {
          file: toStreamingFile(stream, 'audio.webm', { type: 'audio/webm' }),
          model: 'whisper-1',
        },
      },
      fetch,
    );

    expect(pulls).toBeLessThan(4);
    expect(options.body).toBeInstanceOf(ReadableStream);

    const headers = buildHeaders([options.headers]).values;
    const contentType = headers.get('content-type');
    expect(contentType).toMatch(/^multipart\/form-data; boundary=openai-/);

    const encoded = await new Response(options.body as ReadableStream).text();
    expect(pulls).toBe(4);
    expect(encoded).toContain('name="file"; filename="audio.webm"');
    expect(encoded).toContain('Content-Type: audio/webm');
    expect(encoded).toContain('streamed-content-1streamed-content-2streamed-content-3');
    expect(encoded).toContain('name="model"\r\n\r\nwhisper-1');
  });

  test('streams plain Blob chunks', async () => {
    async function* chunks() {
      yield new Blob(['blob-content']);
    }

    const options = await multipartFormRequestOptions(
      {
        body: {
          file: toStreamingFile(chunks(), 'audio.webm'),
        },
      },
      fetch,
    );

    const encoded = await new Response(options.body as ReadableStream).text();
    expect(encoded).toContain('blob-content');
  });

  test('file names strip path separators by default', async () => {
    const form = await createForm(
      {
        file: new File(['Some content'], 'my-skill/SKILL.md'),
      },
      fetch,
    );

    expect((form.get('file') as File).name).toBe('SKILL.md');
  });

  test('file names can preserve path separators for APIs that require directories', async () => {
    const form = await createForm(
      {
        files: [new File(['Some content'], 'my-skill/SKILL.md')],
      },
      fetch,
      { stripFilenames: false },
    );

    expect((form.get('files[]') as File).name).toBe('my-skill/SKILL.md');
  });

  test('path-preserving mode still strips inferred Response URL filenames', async () => {
    const response = new Response('Some content', { status: 200 });
    Object.defineProperty(response, 'url', { value: 'https://example.com/my-skill/SKILL.md' });

    const form = await createForm(
      {
        files: [response],
      },
      fetch,
      { stripFilenames: false },
    );

    expect((form.get('files[]') as File).name).toBe('SKILL.md');
  });

  test('path-preserving mode still strips inferred ReadStream paths', async () => {
    const form = await createForm(
      {
        files: [fs.createReadStream('tests/uploads.test.ts')],
      },
      fetch,
      { stripFilenames: false },
    );

    expect((form.get('files[]') as File).name).toBe('uploads.test.ts');
  });
});
