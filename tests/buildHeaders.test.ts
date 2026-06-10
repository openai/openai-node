import { inspect } from 'node:util';
import { buildHeaders, type HeadersLike, type NullableHeaders } from 'openai/internal/headers';

function inspectNullableHeaders(headers: NullableHeaders) {
  return `NullableHeaders {${[
    ...[...headers.values.entries()].map(([name, value]) => ` ${inspect(name)}: ${inspect(value)}`),
    ...[...headers.nulls].map((name) => ` ${inspect(name)}: null`),
  ].join(', ')} }`;
}

describe('buildHeaders', () => {
  const cases: [HeadersLike[], string][] = [
    [[new Headers({ 'content-type': 'text/plain' })], `NullableHeaders { 'content-type': 'text/plain' }`],
    [
      [
        {
          'content-type': 'text/plain',
        },
        {
          'Content-Type': undefined,
        },
      ],
      `NullableHeaders { 'content-type': 'text/plain' }`,
    ],
    [
      [
        {
          'content-type': 'text/plain',
        },
        {
          'Content-Type': null,
        },
      ],
      `NullableHeaders { 'content-type': null }`,
    ],
    [
      [
        {
          cookie: 'name1=value1',
          Cookie: 'name2=value2',
        },
      ],
      `NullableHeaders { 'cookie': 'name2=value2' }`,
    ],
    [
      [
        {
          cookie: 'name1=value1',
          Cookie: undefined,
        },
      ],
      `NullableHeaders { 'cookie': 'name1=value1' }`,
    ],
    [
      [
        {
          cookie: ['name1=value1', 'name2=value2'],
        },
      ],
      `NullableHeaders { 'cookie': 'name1=value1; name2=value2' }`,
    ],
    [
      [
        {
          'x-foo': ['name1=value1', 'name2=value2'],
        },
      ],
      `NullableHeaders { 'x-foo': 'name1=value1, name2=value2' }`,
    ],
    [
      [
        [
          ['cookie', 'name1=value1'],
          ['cookie', 'name2=value2'],
          ['Cookie', 'name3=value3'],
        ],
      ],
      `NullableHeaders { 'cookie': 'name1=value1; name2=value2; name3=value3' }`,
    ],
    [[undefined], `NullableHeaders { }`],
    [[null], `NullableHeaders { }`],
  ];
  for (const [input, expected] of cases) {
    test(expected, () => {
      expect(inspectNullableHeaders(buildHeaders(input))).toEqual(expected);
    });
  }

  // Regression for https://github.com/openai/openai-node/issues/1928
  test('lowercases header names with ASCII rules even under a Turkish process locale', () => {
    const originalLowerCase = String.prototype.toLowerCase;
    // Simulate the Turkish locale's casing rule that maps uppercase `I` to the
    // dotless `ı`. This is what V8 actually does on Turkish Windows / Linux
    // installs, but we monkey-patch it here so the test is locale-independent.
    String.prototype.toLowerCase = function turkishToLowerCase(this: string): string {
      return this.replace(/I/g, 'ı').replace(/[A-HJ-Z]/g, (c) => c.charCodeAt(0) === 73 ? c : String.fromCharCode(c.charCodeAt(0) | 0x20));
    };
    try {
      const result = buildHeaders([{ 'OpenAI-Organization': 'org_test' }]);
      // The canonical key must be ASCII-only — no dotless `ı`.
      const keys = [...result.values.keys()];
      expect(keys).toContain('openai-organization');
      expect(keys.every((k) => /^[\x00-\x7F]*$/.test(k))).toBe(true);
    } finally {
      String.prototype.toLowerCase = originalLowerCase;
    }
  });
});
