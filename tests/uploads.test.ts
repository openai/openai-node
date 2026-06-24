import fs from 'fs';
import type { ResponseLike } from 'openai/internal/to-file';
import { toFile } from 'openai/core/uploads';

class MyClass {
  name: string = 'foo';
}

class ForeignFileLike {
  readonly name = 'foreign.jsonl';
  readonly type = 'application/jsonl';
  readonly lastModified = 1234;
  readonly size = 2;

  async arrayBuffer() {
    return new Uint8Array([1, 2]).buffer;
  }

  async text() {
    return '12';
  }

  slice() {
    return new Blob([]);
  }
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
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Unexpected data type: object; constructor: Object; props: ["foo"]"`,
    );

    await expect(
      // @ts-expect-error intentionally mismatched type
      toFile(new MyClass()),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Unexpected data type: object; constructor: MyClass; props: ["name"]"`,
    );
  });

  it('disallows string at the type-level', async () => {
    // @ts-expect-error we intentionally do not type support for `string`
    // to help people avoid passing a file path
    const file = await toFile('contents');
    expect(file.text()).resolves.toEqual('contents');
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
    await expect(toFile(input, undefined, { type: undefined, lastModified: undefined })).resolves.toBe(input);
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
    const file = await toFile(new ForeignFileLike());
    expect(file.name).toEqual('foreign.jsonl');
    expect(file.type).toEqual('application/jsonl');
    expect(file.lastModified).toEqual(1234);
    await expect(file.arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2]).buffer);
  });

  it('allows File-like metadata to be overridden', async () => {
    const file = await toFile(new ForeignFileLike(), 'override.jsonl', {
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
    void file, blob;
  });
});

describe('missing File error message', () => {
  let prevGlobalFile: unknown;
  let prevNodeFile: unknown;
  beforeEach(() => {
    // The file shim captures the global File object when it's first imported.
    // Reset modules before each test so we can test the error thrown when it's undefined.
    jest.resetModules();
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
    require('node:buffer').File = prevNodeFile;
    jest.resetModules();
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
