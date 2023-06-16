import { multipartFormRequestOptions } from '~/core';
import { Blob } from 'formdata-node';
import { fileFromPath } from 'formdata-node/file-from-path';

describe('form data validation', () => {
  test('valid values do not error', async () => {
    multipartFormRequestOptions({
      body: {
        foo: 'foo',
        string: 1,
        bool: true,
        file: await fileFromPath('README.md'),
        blob: new Blob(['Some content'], { type: 'text/plain' }),
      },
    });
  });

  test('null', async () => {
    expect(() =>
      multipartFormRequestOptions({
        body: {
          null: null,
        },
      }),
    ).toThrow(TypeError);
  });
});
