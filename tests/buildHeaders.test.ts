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

  test('normalizes OpenAI headers with locale-invariant ASCII casing', () => {
    expect('OpenAI-Organization'.toLocaleLowerCase('tr-TR')).toBe('openaı-organization');
    expect('OpenAI-Project'.toLocaleLowerCase('tr-TR')).toBe('openaı-project');

    const result = buildHeaders([
      {
        'OpenAI-Organization': 'org_test',
        'OpenAI-Project': 'proj_test',
      },
    ]);

    const keys = [...result.values.keys()];
    expect(keys).toEqual(['openai-organization', 'openai-project']);
    expect(keys.every((key) => /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(key))).toBe(true);
  });

  test('rejects header names that lowercase into valid ASCII tokens', () => {
    expect('cooKie'.toLowerCase()).toBe('cookie');
    expect(() => buildHeaders([{ cooKie: 'value' }])).toThrow(
      'Header name must be a valid HTTP token ["cooKie"]',
    );
  });

  test('passes normalized OpenAI header names to Headers implementations', () => {
    const OriginalHeaders = globalThis.Headers;

    class LocaleSensitiveHeaders {
      #values = new Map<string, string>();

      append(name: string, value: string) {
        this.#values.set(normalizeHeaderName(name), value);
      }

      delete(name: string) {
        this.#values.delete(normalizeHeaderName(name));
      }

      entries() {
        return this.#values.entries();
      }

      keys() {
        return this.#values.keys();
      }
    }

    const normalizeHeaderName = (name: string) => {
      const normalized = name.toLocaleLowerCase('tr-TR');
      if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(normalized)) {
        throw new TypeError(`Header name must be a valid HTTP token ["${normalized}"]`);
      }
      return normalized;
    };

    globalThis.Headers = LocaleSensitiveHeaders as unknown as typeof Headers;
    try {
      const result = buildHeaders([
        {
          'OpenAI-Organization': 'org_test',
          'OpenAI-Project': 'proj_test',
        },
      ]);

      expect([...result.values.entries()]).toEqual([
        ['openai-organization', 'org_test'],
        ['openai-project', 'proj_test'],
      ]);
    } finally {
      globalThis.Headers = OriginalHeaders;
    }
  });
});
