import { multipartFormRequestOptions, createForm, toStreamingFile } from 'openai/internal/uploads';
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
    expect(Array.from(form.entries())).toEqual([]);

    const form2 = await createForm(
      {
        bar: {
          foo: 'string',
          baz: undefined,
        },
      },
      fetch,
    );
    expect(Array.from(form2.entries())).toEqual([['bar[foo]', 'string']]);
  });

  test('nested undefined array item is stripped', async () => {
    const form = await createForm(
      {
        bar: [undefined, undefined],
      },
      fetch,
    );
    expect(Array.from(form.entries())).toEqual([]);

    const form2 = await createForm(
      {
        bar: [undefined, 'foo'],
      },
      fetch,
    );
    expect(Array.from(form2.entries())).toEqual([['bar[]', 'foo']]);
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
});
