// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { stringifyQuery } from 'openai/internal/utils/query';

describe(stringifyQuery, () => {
  for (const [input, expected] of [
    [{ a: '1', b: 2, c: true }, 'a=1&b=2&c=true'],
    [{ a: null, b: false, c: undefined }, 'a=&b=false'],
    [{ 'a/b': 1.28341 }, `${encodeURIComponent('a/b')}=1.28341`],
    [
      { 'a/b': 'c/d', 'e=f': 'g&h' },
      `${encodeURIComponent('a/b')}=${encodeURIComponent('c/d')}&${encodeURIComponent(
        'e=f',
      )}=${encodeURIComponent('g&h')}`,
    ],
  ] as const) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      expect(stringifyQuery(input)).toEqual(expected);
    });
  }
});
