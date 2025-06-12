import { createPathTagFunction, encodeURIPath } from 'openai/internal/utils/path';
import { inspect } from 'node:util';

describe('path template tag function', () => {
  test('validates input', () => {
    const testParams = ['', '.', '..', 'x', '%2e', '%2E', '%2e%2e', '%2E%2e', '%2e%2E', '%2E%2E'];
    const testCases = [
      ['/path_params/', '/a'],
      ['/path_params/', '/'],
      ['/path_params/', ''],
      ['', '/a'],
      ['', '/'],
      ['', ''],
      ['a'],
      [''],
      ['/path_params/', ':initiate'],
      ['/path_params/', '.json'],
      ['/path_params/', '?beta=true'],
      ['/path_params/', '.?beta=true'],
      ['/path_params/', '/', '/download'],
      ['/path_params/', '-', '/download'],
      ['/path_params/', '', '/download'],
      ['/path_params/', '.', '/download'],
      ['/path_params/', '..', '/download'],
      ['/plain/path'],
    ];

    function paramPermutations(len: number): string[][] {
      if (len === 0) return [];
      if (len === 1) return testParams.map((e) => [e]);
      const rest = paramPermutations(len - 1);
      return testParams.flatMap((e) => rest.map((r) => [e, ...r]));
    }

    // we need to test how %2E is handled so we use a custom encoder that does no escaping
    const rawPath = createPathTagFunction((s) => s);

    const results: {
      [pathParts: string]: {
        [params: string]: { valid: boolean; result?: string; error?: string };
      };
    } = {};

    for (const pathParts of testCases) {
      const pathResults: Record<string, { valid: boolean; result?: string; error?: string }> = {};
      results[JSON.stringify(pathParts)] = pathResults;
      for (const params of paramPermutations(pathParts.length - 1)) {
        const stringRaw = String.raw({ raw: pathParts }, ...params);
        const plainString = String.raw(
          { raw: pathParts.map((e) => e.replace(/\./g, 'x')) },
          ...params.map((e) => 'X'.repeat(e.length)),
        );
        const normalizedStringRaw = new URL(stringRaw, 'https://example.com').href;
        const normalizedPlainString = new URL(plainString, 'https://example.com').href;
        const pathResultsKey = JSON.stringify(params);
        try {
          const result = rawPath(pathParts, ...params);
          expect(result).toBe(stringRaw);
          // there are no special segments, so the length of the normalized path is
          // equal to the length of the normalized plain path.
          expect(normalizedStringRaw.length).toBe(normalizedPlainString.length);
          pathResults[pathResultsKey] = {
            valid: true,
            result,
          };
        } catch (e) {
          const error = String(e);
          expect(error).toMatch(/Path parameters result in path with invalid segment/);
          // there are special segments, so the length of the normalized path is
          // different than the length of the normalized plain path.
          expect(normalizedStringRaw.length).not.toBe(normalizedPlainString.length);
          pathResults[pathResultsKey] = {
            valid: false,
            error,
          };
        }
      }
    }

    expect(results).toMatchObject({
      '["/path_params/","/a"]': {
        '["x"]': { valid: true, result: '/path_params/x/a' },
        '[""]': { valid: true, result: '/path_params//a' },
        '["%2E%2e"]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/%2E%2e/a\n' +
            '             ^^^^^^',
        },
        '["%2E"]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/%2E/a\n' +
            '             ^^^',
        },
      },
      '["/path_params/","/"]': {
        '["x"]': { valid: true, result: '/path_params/x/' },
        '[""]': { valid: true, result: '/path_params//' },
        '["%2e%2E"]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/%2e%2E/\n' +
            '             ^^^^^^',
        },
        '["%2e"]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/%2e/\n' +
            '             ^^^',
        },
      },
      '["/path_params/",""]': {
        '[""]': { valid: true, result: '/path_params/' },
        '["x"]': { valid: true, result: '/path_params/x' },
        '["%2E"]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/%2E\n' +
            '             ^^^',
        },
        '["%2E%2e"]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/%2E%2e\n' +
            '             ^^^^^^',
        },
      },
      '["","/a"]': {
        '[""]': { valid: true, result: '/a' },
        '["x"]': { valid: true, result: 'x/a' },
        '["%2E"]': {
          valid: false,
          error: 'Error: Path parameters result in path with invalid segments:\n%2E/a\n^^^',
        },
        '["%2e%2E"]': {
          valid: false,
          error: 'Error: Path parameters result in path with invalid segments:\n' + '%2e%2E/a\n' + '^^^^^^',
        },
      },
      '["","/"]': {
        '["x"]': { valid: true, result: 'x/' },
        '[""]': { valid: true, result: '/' },
        '["%2E%2e"]': {
          valid: false,
          error: 'Error: Path parameters result in path with invalid segments:\n' + '%2E%2e/\n' + '^^^^^^',
        },
        '["."]': {
          valid: false,
          error: 'Error: Path parameters result in path with invalid segments:\n./\n^',
        },
      },
      '["",""]': {
        '[""]': { valid: true, result: '' },
        '["x"]': { valid: true, result: 'x' },
        '[".."]': {
          valid: false,
          error: 'Error: Path parameters result in path with invalid segments:\n..\n^^',
        },
        '["."]': {
          valid: false,
          error: 'Error: Path parameters result in path with invalid segments:\n.\n^',
        },
      },
      '["a"]': {},
      '[""]': {},
      '["/path_params/",":initiate"]': {
        '[""]': { valid: true, result: '/path_params/:initiate' },
        '["."]': { valid: true, result: '/path_params/.:initiate' },
      },
      '["/path_params/",".json"]': {
        '["x"]': { valid: true, result: '/path_params/x.json' },
        '["."]': { valid: true, result: '/path_params/..json' },
      },
      '["/path_params/","?beta=true"]': {
        '["x"]': { valid: true, result: '/path_params/x?beta=true' },
        '[""]': { valid: true, result: '/path_params/?beta=true' },
        '["%2E%2E"]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/%2E%2E?beta=true\n' +
            '             ^^^^^^',
        },
        '["%2e%2E"]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/%2e%2E?beta=true\n' +
            '             ^^^^^^',
        },
      },
      '["/path_params/",".?beta=true"]': {
        '[".."]': { valid: true, result: '/path_params/...?beta=true' },
        '["x"]': { valid: true, result: '/path_params/x.?beta=true' },
        '[""]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/.?beta=true\n' +
            '             ^',
        },
        '["%2e"]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/%2e.?beta=true\n' +
            '             ^^^^',
        },
      },
      '["/path_params/","/","/download"]': {
        '["",""]': { valid: true, result: '/path_params///download' },
        '["","x"]': { valid: true, result: '/path_params//x/download' },
        '[".","%2e"]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/./%2e/download\n' +
            '             ^ ^^^',
        },
        '["%2E%2e","%2e"]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/%2E%2e/%2e/download\n' +
            '             ^^^^^^ ^^^',
        },
      },
      '["/path_params/","-","/download"]': {
        '["","%2e"]': { valid: true, result: '/path_params/-%2e/download' },
        '["%2E",".."]': { valid: true, result: '/path_params/%2E-../download' },
      },
      '["/path_params/","","/download"]': {
        '["%2E%2e","%2e%2E"]': { valid: true, result: '/path_params/%2E%2e%2e%2E/download' },
        '["%2E",".."]': { valid: true, result: '/path_params/%2E../download' },
        '["","%2E"]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/%2E/download\n' +
            '             ^^^',
        },
        '["%2E","."]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/%2E./download\n' +
            '             ^^^^',
        },
      },
      '["/path_params/",".","/download"]': {
        '["%2e%2e",""]': { valid: true, result: '/path_params/%2e%2e./download' },
        '["","%2e%2e"]': { valid: true, result: '/path_params/.%2e%2e/download' },
        '["",""]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/./download\n' +
            '             ^',
        },
        '["","."]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/../download\n' +
            '             ^^',
        },
      },
      '["/path_params/","..","/download"]': {
        '["","%2E"]': { valid: true, result: '/path_params/..%2E/download' },
        '["","x"]': { valid: true, result: '/path_params/..x/download' },
        '["",""]': {
          valid: false,
          error:
            'Error: Path parameters result in path with invalid segments:\n' +
            '/path_params/../download\n' +
            '             ^^',
        },
      },
    });
  });
});

describe('encodeURIPath', () => {
  const testCases: string[] = [
    '',
    // Every ASCII character
    ...Array.from({ length: 0x7f }, (_, i) => String.fromCharCode(i)),
    // Unicode BMP codepoint
    'å',
    // Unicode supplementary codepoint
    '😃',
  ];

  for (const param of testCases) {
    test('properly encodes ' + inspect(param), () => {
      const encoded = encodeURIPath(param);
      const naiveEncoded = encodeURIComponent(param);
      // we should never encode more characters than encodeURIComponent
      expect(naiveEncoded.length).toBeGreaterThanOrEqual(encoded.length);
      expect(decodeURIComponent(encoded)).toBe(param);
    });
  }

  test("leaves ':' intact", () => {
    expect(encodeURIPath(':')).toBe(':');
  });

  test("leaves '@' intact", () => {
    expect(encodeURIPath('@')).toBe('@');
  });
});
