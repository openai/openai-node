import { vi } from 'vitest';

import fs from 'node:fs';
import type { ResponseLike } from 'openai/internal/to-file';
import { toFile } from 'openai/core/uploads';

class MyClass {
  name = 'foo';
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

  it('preserves the filename and MIME type of a non-native File-compatible input', async () => {
    const input = Object.assign(new Blob(['foreign contents'], { type: 'text/plain' }), {
      name: 'foreign.txt',
      lastModified: 123,
    });

    const file = await toFile(input);

    expect(file.name).toBe('foreign.txt');
    expect(file.type).toBe('text/plain');
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
