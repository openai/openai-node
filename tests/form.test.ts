import { multipartFormRequestOptions, createForm } from 'martian-node/core';
import { Blob } from 'martian-node/_shims/index';
import { toFile } from 'martian-node';

describe('form data validation', () => {
  test('valid values do not error', async () => {
    await multipartFormRequestOptions({
      body: {
        foo: 'foo',
        string: 1,
        bool: true,
        file: await toFile(Buffer.from('some-content')),
        blob: new Blob(['Some content'], { type: 'text/plain' }),
      },
    });
  });

  test('null', async () => {
    await expect(() =>
      multipartFormRequestOptions({
        body: {
          null: null,
        },
      }),
    ).rejects.toThrow(TypeError);
  });

  test('undefined is stripped', async () => {
    const form = await createForm({
      foo: undefined,
      bar: 'baz',
    });
    expect(form.has('foo')).toBe(false);
    expect(form.get('bar')).toBe('baz');
  });

  test('nested undefined property is stripped', async () => {
    const form = await createForm({
      bar: {
        baz: undefined,
      },
    });
    expect(Array.from(form.entries())).toEqual([]);

    const form2 = await createForm({
      bar: {
        foo: 'string',
        baz: undefined,
      },
    });
    expect(Array.from(form2.entries())).toEqual([['bar[foo]', 'string']]);
  });

  test('nested undefined array item is stripped', async () => {
    const form = await createForm({
      bar: [undefined, undefined],
    });
    expect(Array.from(form.entries())).toEqual([]);

    const form2 = await createForm({
      bar: [undefined, 'foo'],
    });
    expect(Array.from(form2.entries())).toEqual([['bar[]', 'foo']]);
  });
});
