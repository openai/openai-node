import { vi } from 'vitest';

import fs from 'node:fs';
import type { ResponseLike } from 'openai/internal/to-file';
import { toFile } from 'openai/core/uploads';

class MyClass {
  name = 'foo';
}

function foreignFileLike(): Blob & { name: string; lastModified: number } {
  return Object.assign(new Blob([new Uint8Array([1, 2])], { type: 'application/jsonl' }), {
    name: 'foreign.jsonl',
    lastModified: 1234,
  });
}

function foreignBlobLike(
  contents: string,
  type: string,
): Pick<Blob, 'size' | 'type' | 'text' | 'slice' | 'arrayBuffer'> {
  const blob = new Blob([contents], { type });

  return {
    size: blob.size,
    type: blob.type,
    text: blob.text.bind(blob),
    slice: blob.slice.bind(blob),
    arrayBuffer: blob.arrayBuffer.bind(blob),
  };
}

function mockResponse({ url, content }: { url: string; content?: Blob }): ResponseLike {
  return {
    url,
    blob: async () => content || new Blob([]),
  };
}

describe('toFile', () => {
  it('throws a helpful error for mismatched types', async () => {
    await expect(
      // @ts-expect-error intentionally mismatched type
      toFile({ foo: 'string' }),
    ).rejects.toThrow('Unexpected data type: object; constructor: Object; props: ["foo"]');

    await expect(
      // @ts-expect-error intentionally mismatched type
      toFile(new MyClass()),
    ).rejects.toThrow('Unexpected data type: object; constructor: MyClass; props: ["name"]');
  });

  it('disallows string at the type-level', async () => {
    // @ts-expect-error we intentionally do not type support for `string`
    // to help people avoid passing a file path
    const file = await toFile('contents');
    await expect(file.text()).resolves.toEqual('contents');
  });

  it('extracts a file name from a Response', async () => {
    const response = mockResponse({ url: 'https://example.com/my/audio.mp3' });
    const file = await toFile(response);
    expect(file.name).toEqual('audio.mp3');
  });

  it('falls back to unknown_file when a Response has no URL', async () => {
    const file = await toFile(new Response('audio contents'));
    expect(file.name).toEqual('unknown_file');
    await expect(file.text()).resolves.toEqual('audio contents');
  });

  it('falls back to unknown_file when a Response URL has no path segment', async () => {
    const response = mockResponse({ url: 'https://example.com/' });
    const file = await toFile(response);
    expect(file.name).toEqual('unknown_file');
  });

  it('infers the MIME type from a Response body', async () => {
    const response = mockResponse({
      url: 'https://example.com/my/audio.mp3',
      content: new Blob(['audio contents'], { type: 'audio/mpeg' }),
    });

    const file = await toFile(response);

    expect(file.name).toBe('audio.mp3');
    expect(file.type).toBe('audio/mpeg');
    await expect(file.text()).resolves.toBe('audio contents');
  });

  it('prefers an explicit MIME type over a Response body type', async () => {
    const response = mockResponse({
      url: 'https://example.com/my/audio.mp3',
      content: new Blob(['audio contents'], { type: 'audio/mpeg' }),
    });

    const file = await toFile(response, 'override.wav', { type: 'audio/wav' });

    expect(file.name).toBe('override.wav');
    expect(file.type).toBe('audio/wav');
  });

  it('allows an explicit empty MIME type to override a Response body type', async () => {
    const response = mockResponse({
      url: 'https://example.com/my/audio.mp3',
      content: new Blob(['audio contents'], { type: 'audio/mpeg' }),
    });

    const file = await toFile(response, undefined, { type: '' });

    expect(file.name).toBe('audio.mp3');
    expect(file.type).toBe('');
  });

  it('extracts a file name from a File', async () => {
    const input = new File(['foo'], 'input.jsonl');
    const file = await toFile(input);
    expect(file.name).toEqual('input.jsonl');
  });

  it('infers the MIME type of a Blob when creating a File', async () => {
    const input = new Blob(['contents'], { type: 'text/plain' });

    const file = await toFile(input, 'contents.txt');

    expect(file.name).toBe('contents.txt');
    expect(file.type).toBe('text/plain');
    await expect(file.text()).resolves.toBe('contents');
  });

  it('infers the MIME type of a non-native Blob-compatible input', async () => {
    const input = foreignBlobLike('foreign contents', 'application/foreign');

    const file = await toFile(input, 'foreign.bin');

    expect(file.name).toBe('foreign.bin');
    expect(file.type).toBe('application/foreign');
    await expect(file.text()).resolves.toBe('foreign contents');
  });

  it('honors explicit MIME overrides for non-native Blob-compatible inputs', async () => {
    const input = foreignBlobLike('foreign contents', 'application/foreign');

    const override = await toFile(input, 'foreign.bin', { type: 'application/custom' });
    const empty = await toFile(input, 'foreign.bin', { type: '' });

    expect(override.type).toBe('application/custom');
    expect(empty.type).toBe('');
  });

  it('prefers an explicit MIME type over the input Blob type', async () => {
    const input = new Blob(['contents'], { type: 'text/plain' });

    const file = await toFile(input, 'contents.txt', { type: 'application/custom' });

    expect(file.type).toBe('application/custom');
  });

  it('allows an explicit empty MIME type to override the input Blob type', async () => {
    const input = new Blob(['contents'], { type: 'text/plain' });

    const file = await toFile(input, 'contents.txt', { type: '' });

    expect(file.type).toBe('');
  });

  it('infers the input Blob MIME type when no type is provided', async () => {
    const input = new Blob(['contents'], { type: 'text/plain' });

    const file = await toFile(input, 'contents.txt', { lastModified: 42 });

    expect(file.type).toBe('text/plain');
    expect(file.lastModified).toBe(42);
  });

  it('infers a MIME type from typed Blob chunks in an async stream', async () => {
    const chunks = {
      async *[Symbol.asyncIterator]() {
        yield new Uint8Array([65]);
        yield new Blob(['B'], { type: 'text/plain' });
      },
    };

    const file = await toFile(chunks, 'chunks.txt');

    expect(file.name).toBe('chunks.txt');
    expect(file.type).toBe('text/plain');
    await expect(file.text()).resolves.toBe('AB');
  });

  it('infers a MIME type from non-native Blob-compatible chunks in an async stream', async () => {
    const foreignChunk = foreignBlobLike('foreign contents', 'application/foreign');
    const chunks = {
      async *[Symbol.asyncIterator]() {
        yield new Uint8Array([65]);
        yield foreignChunk;
      },
    };

    const file = await toFile(chunks, 'foreign.bin');

    expect(file.name).toBe('foreign.bin');
    expect(file.type).toBe('application/foreign');
    await expect(file.text()).resolves.toBe('Aforeign contents');
  });

  it('preserves the filename and MIME type of a non-native File-compatible input', async () => {
    const input = Object.assign(new Blob(['foreign contents'], { type: 'text/plain' }), {
      name: 'foreign.txt',
      lastModified: 123,
    });

    const file = await toFile(input);

    expect(file.name).toBe('foreign.txt');
    expect(file.type).toBe('text/plain');
    expect(file.lastModified).toBe(123);
    await expect(file.text()).resolves.toBe('foreign contents');
  });

  it('applies filename and metadata overrides to non-native File-compatible inputs', async () => {
    const input = Object.assign(new Blob(['foreign contents'], { type: 'text/plain' }), {
      name: 'foreign.txt',
      lastModified: 123,
    });

    const file = await toFile(input, 'override.txt', {
      type: 'application/custom',
      lastModified: 42,
    });

    expect(file.name).toBe('override.txt');
    expect(file.type).toBe('application/custom');
    expect(file.lastModified).toBe(42);
  });

  it('allows an explicit empty MIME type to override a non-native File-compatible input', async () => {
    const input = Object.assign(new Blob(['foreign contents'], { type: 'text/plain' }), {
      name: 'foreign.txt',
      lastModified: 123,
    });

    const file = await toFile(input, 'override.txt', { type: '', lastModified: 42 });

    expect(file.name).toBe('override.txt');
    expect(file.type).toBe('');
    expect(file.lastModified).toBe(42);
  });

  it('infers a non-native File-compatible MIME type when no type is provided', async () => {
    const input = Object.assign(new Blob(['foreign contents'], { type: 'text/plain' }), {
      name: 'foreign.txt',
      lastModified: 123,
    });

    const file = await toFile(input, undefined, { lastModified: 42 });

    expect(file.name).toBe('foreign.txt');
    expect(file.type).toBe('text/plain');
    expect(file.lastModified).toBe(42);
  });

  it('extracts a file name from a ReadStream', async () => {
    const input = fs.createReadStream('tests/uploads.test.ts');
    const file = await toFile(input);
    expect(file.name).toEqual('uploads.test.ts');
  });

  it('does not copy File objects', async () => {
    const input = new File(['foo'], 'input.jsonl', { type: 'jsonl' });
    const file = await toFile(input);
    expect(file).toBe(input);
    expect(file.name).toEqual('input.jsonl');
    expect(file.type).toBe('jsonl');
  });

  it('does not copy File objects for empty options', async () => {
    const input = new File(['foo'], 'input.jsonl', { type: 'jsonl', lastModified: 1234 });

    await expect(toFile(input, undefined, {})).resolves.toBe(input);
    await expect(toFile(input, null, {})).resolves.toBe(input);
  });

  it('does not copy native File objects when their filename and metadata are unchanged', async () => {
    const input = new File(['foo'], 'input.jsonl', { type: 'application/jsonl', lastModified: 1234 });

    await expect(toFile(input, 'input.jsonl')).resolves.toBe(input);
    await expect(toFile(input, undefined, { type: 'application/jsonl' })).resolves.toBe(input);
    await expect(
      toFile(input, 'input.jsonl', { type: 'application/jsonl', lastModified: 1234 }),
    ).resolves.toBe(input);
  });

  it.each([
    { label: 'filename', name: 'my-skill/SKILL.md', options: undefined },
    { label: 'MIME type', name: undefined, options: { type: 'application/x-ndjson' } },
    { label: 'modification time', name: undefined, options: { lastModified: 5678 } },
    {
      label: 'filename and metadata',
      name: 'my-skill/SKILL.md',
      options: { type: 'application/x-ndjson', lastModified: 5678 },
    },
  ])('updates a native File $label without buffering its contents', async ({ name, options }) => {
    const input = new File(['manifest'], 'SKILL.md', { type: 'text/markdown', lastModified: 1234 });
    const arrayBuffer = vi
      .spyOn(input, 'arrayBuffer')
      .mockRejectedValue(new Error('Native File contents must not be buffered'));

    const file = await toFile(input, name, options);

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(file.name).toBe(name ?? 'SKILL.md');
    expect(file.type).toBe(options?.type ?? 'text/markdown');
    expect(file.lastModified).toBe(options?.lastModified ?? 1234);
    await expect(file.text()).resolves.toBe('manifest');
  });

  it('renames native File objects while preserving their MIME type and modification time', async () => {
    const input = new File(['manifest'], 'SKILL.md', { type: 'text/markdown', lastModified: 1234 });

    const file = await toFile(input, 'my-skill/SKILL.md');

    expect(file).not.toBe(input);
    expect(file.name).toBe('my-skill/SKILL.md');
    expect(file.type).toBe('text/markdown');
    expect(file.lastModified).toBe(1234);
    await expect(file.text()).resolves.toBe('manifest');
  });

  it('applies native File MIME overrides without changing its filename or modification time', async () => {
    const input = new File(['foo'], 'input.jsonl', { type: 'application/jsonl', lastModified: 1234 });

    const file = await toFile(input, undefined, { type: 'application/x-ndjson' });

    expect(file).not.toBe(input);
    expect(file.name).toBe('input.jsonl');
    expect(file.type).toBe('application/x-ndjson');
    expect(file.lastModified).toBe(1234);
  });

  it('honors empty MIME and zero modification-time overrides for native File objects', async () => {
    const input = new File(['foo'], 'input.jsonl', { type: 'application/jsonl', lastModified: 1234 });

    const file = await toFile(input, undefined, { type: '', lastModified: 0 });

    expect(file).not.toBe(input);
    expect(file.name).toBe('input.jsonl');
    expect(file.type).toBe('');
    expect(file.lastModified).toBe(0);
  });

  it('copies File objects when metadata overrides are requested', async () => {
    const input = new File(['foo'], 'input.jsonl', { type: 'jsonl', lastModified: 1234 });
    const file = await toFile(input, 'override.jsonl', {
      type: 'application/x-ndjson',
      lastModified: 5678,
    });
    expect(file).not.toBe(input);
    expect(file.name).toEqual('override.jsonl');
    expect(file.type).toEqual('application/x-ndjson');
    expect(file.lastModified).toEqual(5678);
    await expect(file.text()).resolves.toEqual('foo');
  });

  it('preserves metadata from File-like objects', async () => {
    const file = await toFile(foreignFileLike());
    expect(file.name).toEqual('foreign.jsonl');
    expect(file.type).toEqual('application/jsonl');
    expect(file.lastModified).toEqual(1234);
    await expect(file.arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2]).buffer);
  });

  it('continues buffering structural non-native File-compatible objects', async () => {
    const input = foreignFileLike();
    const arrayBuffer = vi.spyOn(input, 'arrayBuffer');

    const file = await toFile(input, 'renamed.jsonl');

    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(file.name).toBe('renamed.jsonl');
    expect(file.type).toBe('application/jsonl');
    expect(file.lastModified).toBe(1234);
    await expect(file.arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2]).buffer);
  });

  it('allows File-like metadata to be overridden', async () => {
    const file = await toFile(foreignFileLike(), 'override.jsonl', {
      type: 'application/x-ndjson',
      lastModified: 5678,
    });
    expect(file.name).toEqual('override.jsonl');
    expect(file.type).toEqual('application/x-ndjson');
    expect(file.lastModified).toEqual(5678);
  });

  it('is assignable to File and Blob', async () => {
    const input = new File(['foo'], 'input.jsonl', { type: 'jsonl' });
    const result = await toFile(input);
    const file: File = result;
    const blob: Blob = result;
    void file;
    void blob;
  });
});

describe('missing File error message', () => {
  let prevGlobalFile: unknown;
  let prevNodeFile: unknown;
  beforeEach(() => {
    // The file shim captures the global File object when it's first imported.
    // Reset modules before each test so we can test the error thrown when it's undefined.
    vi.resetModules();
    // oxlint-disable-next-line node/global-require -- Resetting modules requires loading this fresh for each test.
    const buffer = require('node:buffer');
    // @ts-ignore
    prevGlobalFile = globalThis.File;
    prevNodeFile = buffer.File;
    // @ts-ignore
    globalThis.File = undefined;
    buffer.File = undefined;
  });
  afterEach(() => {
    // Clean up
    // @ts-ignore
    globalThis.File = prevGlobalFile;
    // oxlint-disable-next-line node/global-require -- Resetting modules requires restoring the freshly loaded module.
    require('node:buffer').File = prevNodeFile;
    vi.resetModules();
  });

  test('is thrown', async () => {
    const uploads = await import('openai/core/uploads');
    await expect(
      uploads.toFile(mockResponse({ url: 'https://example.com/my/audio.mp3' })),
    ).rejects.toMatchInlineSnapshot(
      `[Error: \`File\` is not defined as a global, which is required for file uploads.]`,
    );
  });
});
