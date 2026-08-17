import { vi } from 'vitest';

import { multipartFormRequestOptions, toStreamingFile } from 'openai/internal/uploads';

async function* chunks() {
  yield 'streamed contents';
}

describe('streaming upload filename security', () => {
  test.each([
    ['empty', ''],
    ['undefined', undefined],
    ['null', null],
    ['number', 123],
    ['boolean', true],
    ['object', {}],
    ['boxed string', new Object('upload.txt')],
    ['symbol', Symbol('upload.txt')],
  ] as const)('rejects %s filenames during construction', (_, name) => {
    expect(() => toStreamingFile(chunks(), name as any)).toThrow(TypeError);
    expect(() => toStreamingFile(chunks(), name as any)).toThrow(/file.?name/iu);
  });

  test('rejects malicious filename objects without invoking string coercion', () => {
    const coerce = vi.fn(() => 'attack.txt"\r\nInjected: yes');
    const name = { toString: coerce, valueOf: coerce, [Symbol.toPrimitive]: coerce };

    expect(() => toStreamingFile(chunks(), name as any)).toThrow(TypeError);
    expect(coerce).not.toHaveBeenCalled();
  });

  test.each([
    ['empty', ''],
    ['undefined', undefined],
    ['null', null],
    ['number', 123],
    ['boxed string', new Object('upload.txt')],
  ] as const)('rejects a mutated %s filename before emitting its part boundary', async (_, name) => {
    const upload = toStreamingFile(chunks(), 'upload.txt');
    Object.defineProperty(upload, 'name', { value: name });
    const options = await multipartFormRequestOptions({ body: { upload } }, fetch);

    await expect((options.body as ReadableStream).getReader().read()).rejects.toThrow(/file.?name/iu);
  });

  test('rejects mutated filename objects without coercion after earlier parts stream', async () => {
    const coerce = vi.fn(() => 'attack.txt"\r\nInjected: yes');
    const upload = toStreamingFile(chunks(), 'upload.txt');
    const options = await multipartFormRequestOptions({ body: { purpose: 'assistants', upload } }, fetch);
    Object.defineProperty(upload, 'name', { value: { toString: coerce, [Symbol.toPrimitive]: coerce } });
    const reader = (options.body as ReadableStream).getReader();
    let emitted = '';

    async function readRemaining(): Promise<void> {
      const result = await reader.read();
      if (!result.done) {
        emitted += new TextDecoder().decode(result.value);
        await readRemaining();
      }
    }

    await expect(readRemaining()).rejects.toThrow(/file.?name/iu);

    expect(emitted).toContain('name="purpose"\r\n\r\nassistants');
    expect(emitted.match(/--openai-/gu)).toHaveLength(1);
    expect(coerce).not.toHaveBeenCalled();
  });

  test('percent-escapes every C0 control, DEL, quote, and backslash in multipart headers', async () => {
    const controls = Array.from({ length: 32 }, (_, code) => String.fromCodePoint(code)).join('');
    const encodedControls = Array.from(
      { length: 32 },
      (_, code) => `%${code.toString(16).toUpperCase().padStart(2, '0')}`,
    ).join('');
    const unsafe = `${controls}\u007F"\\\r\nInjected: yes`;
    const escaped = `${encodedControls}%7F%22%5C%0D%0AInjected: yes`;
    const options = await multipartFormRequestOptions(
      { body: { [`field-${unsafe}`]: toStreamingFile(chunks(), `résumé-${unsafe}.txt`) } },
      fetch,
    );
    const body = await new Response(options.body as ReadableStream).text();

    expect(body).toContain(`name="field-${escaped}"; filename="%0D%0AInjected: yes.txt"`);
    expect(body).not.toContain('\r\nInjected: yes');
  });

  test('preserves ordinary Unicode field names and filenames', async () => {
    const filename = 'résumé-東京-📄.txt';
    const options = await multipartFormRequestOptions(
      { body: { '添付-📎': toStreamingFile(chunks(), filename) } },
      fetch,
    );

    await expect(new Response(options.body as ReadableStream).text()).resolves.toContain(
      `name="添付-📎"; filename="${filename}"`,
    );
  });

  test.each([
    ['default stripping', undefined, 'stream.txt', 'ordinary.txt'],
    ['preserved paths', { stripFilenames: false }, 'nested/stream.txt', 'nested/ordinary.txt'],
  ] as const)(
    'preserves existing filenames and fallback names with %s',
    async (_, formOptions, streaming, ordinary) => {
      const options = await multipartFormRequestOptions(
        {
          body: {
            stream: toStreamingFile(chunks(), 'nested\\stream.txt'),
            ordinary: new File(['buffered'], 'nested/ordinary.txt'),
            unnamed: chunks(),
          },
        },
        fetch,
        formOptions,
      );
      const body = await new Response(options.body as ReadableStream).text();

      expect(body).toContain(`filename="${streaming}"`);
      expect(body).toContain(`filename="${ordinary}"`);
      expect(body).toContain('filename="unknown_file"');
    },
  );

  test('consumes an async upload iterator lazily and exactly once', async () => {
    const iterate = vi.fn(async function* iterateChunks() {
      yield 'first';
      yield 'second';
    });
    const upload = toStreamingFile({ [Symbol.asyncIterator]: iterate }, 'upload.txt');
    const options = await multipartFormRequestOptions({ body: { upload } }, fetch);

    expect(iterate).not.toHaveBeenCalled();
    await expect(new Response(options.body as ReadableStream).text()).resolves.toContain('firstsecond');
    expect(iterate).toHaveBeenCalledTimes(1);
  });
});
