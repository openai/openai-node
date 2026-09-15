import { runInNewContext } from 'node:vm';
import OpenAI, { toFile, toStreamingFile } from 'openai';
import type { Fetch } from 'openai/internal/builtin-types';

interface BufferCase {
  name: string;
  make: () => ArrayBuffer | Uint8Array | DataView;
  expected: number[];
}

const cases: BufferCase[] = [
  {
    name: 'foreign ArrayBuffer',
    make: () => runInNewContext('new Uint8Array([0, 1, 127, 255]).buffer') as ArrayBuffer,
    expected: [0, 1, 127, 255],
  },
  {
    name: 'empty foreign ArrayBuffer',
    make: () => runInNewContext('new ArrayBuffer(0)') as ArrayBuffer,
    expected: [],
  },
  {
    name: 'native ArrayBuffer',
    make: () => new Uint8Array([0, 1, 127, 255]).buffer,
    expected: [0, 1, 127, 255],
  },
  {
    name: 'foreign typed-array slice',
    make: () =>
      runInNewContext('new Uint8Array(new Uint8Array([0, 1, 127, 255]).buffer, 1, 2)') as Uint8Array,
    expected: [1, 127],
  },
  {
    name: 'foreign DataView slice',
    make: () => runInNewContext('new DataView(new Uint8Array([0, 1, 127, 255]).buffer, 1, 2)') as DataView,
    expected: [1, 127],
  },
];

function uploadClient() {
  const files: File[] = [];
  const transport: Fetch = async (_input, init) => {
    const form = await new Response(init?.body, { headers: new Headers(init?.headers) }).formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new Error('Expected a multipart file');
    }
    expect(form.get('purpose')).toBe('assistants');
    files.push(file);
    return Response.json({ id: 'file_test', object: 'file' });
  };
  return {
    files,
    client: new OpenAI({
      apiKey: 'synthetic-test-key',
      baseURL: 'https://example.test',
      fetch: Object.assign(transport, { Response }),
      maxRetries: 0,
    }),
  };
}

describe.each(cases)('$name upload bytes', ({ make, expected }) => {
  test.each(['direct', 'chunked'])('buffers %s input with toFile', async (mode) => {
    const value = make();
    const chunks = {
      async *[Symbol.asyncIterator]() {
        yield value;
      },
    };
    const file = await toFile(mode === 'direct' ? value : chunks, 'bytes.bin', {
      type: 'application/octet-stream',
      lastModified: 123,
    });

    expect(file.name).toBe('bytes.bin');
    expect(file.type).toBe('application/octet-stream');
    expect(file.lastModified).toBe(123);
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual(expected);
  });

  test.each(['wrapped', 'iterable', 'readable'] as const)(
    'streams %s input through files.create',
    async (mode) => {
      const value = make();
      const chunks = {
        name: 'bytes.bin',
        async *[Symbol.asyncIterator]() {
          yield value;
        },
      };
      const inputs = {
        wrapped: () => toStreamingFile(chunks, 'bytes.bin'),
        iterable: () => chunks,
        readable: () =>
          Object.assign(
            new ReadableStream({
              start(controller) {
                controller.enqueue(value);
                controller.close();
              },
            }),
            { name: 'bytes.bin' },
          ),
      };
      const { client, files } = uploadClient();
      const input = inputs[mode]();
      await expect(client.files.create({ file: input, purpose: 'assistants' })).resolves.toHaveProperty(
        'id',
        'file_test',
      );

      expect(files).toHaveLength(1);
      const [uploaded] = files;
      if (!uploaded) {
        throw new Error('The transport did not receive an uploaded file');
      }
      expect(uploaded.name).toBe('bytes.bin');
      expect([...new Uint8Array(await uploaded.arrayBuffer())]).toEqual(expected);
    },
  );
});

test.each([
  { name: 'a string-tag lookalike', value: { byteLength: 4, [Symbol.toStringTag]: 'ArrayBuffer' } },
  { name: 'a SharedArrayBuffer', value: new SharedArrayBuffer(4) },
])('does not accept $name as an ArrayBuffer', async ({ value }) => {
  // @ts-expect-error Neither input is a supported ArrayBuffer upload part.
  await expect(toFile(value, 'invalid.bin')).rejects.toThrow('Unexpected data type');

  const chunks = {
    async *[Symbol.asyncIterator]() {
      yield value;
    },
  };
  const { client, files } = uploadClient();
  // @ts-expect-error Invalid chunks are deliberately supplied to the public streaming boundary.
  const file = toStreamingFile(chunks, 'invalid.bin');
  await expect(client.files.create({ file, purpose: 'assistants' })).rejects.toHaveProperty(
    'cause.message',
    expect.stringContaining('Invalid streaming file chunk'),
  );
  expect(files).toHaveLength(0);
});
