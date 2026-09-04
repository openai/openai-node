import { fromBase64, toBase64, toFloat32Array } from 'openai/internal/utils/base64';

const incompleteVectors = [1, 2, 3, 5, 6, 7].map((byteLength) => ({
  byteLength,
  encoded: Buffer.alloc(byteLength).toString('base64'),
}));
const alignedVectors = [[], [1.25], [1.25, -2.5]].map((values) => ({
  byteLength: values.length * Float32Array.BYTES_PER_ELEMENT,
  encoded: Buffer.from(new Float32Array(values).buffer).toString('base64'),
  values,
}));

describe.each(['Buffer', 'atob'])('with %s', (mode) => {
  let originalBuffer: BufferConstructor;
  beforeAll(() => {
    if (mode === 'atob') {
      originalBuffer = globalThis.Buffer;
      // @ts-expect-error Can't assign undefined to BufferConstructor
      delete globalThis.Buffer;
    }
  });
  afterAll(() => {
    if (mode === 'atob') {
      globalThis.Buffer = originalBuffer;
    }
  });
  test.each(incompleteVectors)('toFloat32Array rejects $byteLength decoded bytes', ({ encoded }) => {
    expect(() => toFloat32Array(encoded)).toThrow(RangeError);
  });

  test.each(alignedVectors)('toFloat32Array preserves $byteLength decoded bytes', ({ encoded, values }) => {
    expect(toFloat32Array(encoded)).toEqual(values);
  });

  test('toBase64', () => {
    const testCases = [
      {
        input: 'hello world',
        expected: 'aGVsbG8gd29ybGQ=',
      },
      {
        input: new Uint8Array([104, 101, 108, 108, 111, 32, 119, 111, 114, 108, 100]),
        expected: 'aGVsbG8gd29ybGQ=',
      },
      {
        input: undefined,
        expected: '',
      },
      {
        input: new Uint8Array([
          229, 102, 215, 230, 65, 22, 46, 87, 243, 176, 99, 99, 31, 174, 8, 242, 83, 142, 169, 64, 122, 123,
          193, 71,
        ]),
        expected: '5WbX5kEWLlfzsGNjH64I8lOOqUB6e8FH',
      },
      {
        input: '✓',
        expected: '4pyT',
      },
      {
        input: new Uint8Array([226, 156, 147]),
        expected: '4pyT',
      },
    ];

    for (const { input, expected } of testCases) {
      expect(toBase64(input)).toBe(expected);
    }
  });

  test('fromBase64', () => {
    const testCases = [
      {
        input: 'aGVsbG8gd29ybGQ=',
        expected: new Uint8Array([104, 101, 108, 108, 111, 32, 119, 111, 114, 108, 100]),
      },
      {
        input: '',
        expected: new Uint8Array([]),
      },
      {
        input: '5WbX5kEWLlfzsGNjH64I8lOOqUB6e8FH',
        expected: new Uint8Array([
          229, 102, 215, 230, 65, 22, 46, 87, 243, 176, 99, 99, 31, 174, 8, 242, 83, 142, 169, 64, 122, 123,
          193, 71,
        ]),
      },
      {
        input: '4pyT',
        expected: new Uint8Array([226, 156, 147]),
      },
    ];

    for (const { input, expected } of testCases) {
      expect(fromBase64(input)).toEqual(expected);
    }
  });
});
