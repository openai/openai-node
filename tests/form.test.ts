import { multipartFormRequestOptions, createForm } from 'openai/internal/uploads';
import { toFile } from 'openai/core/uploads';

describe('form data validation', () => {
  test('valid values do not error', async () => {
    await multipartFormRequestOptions(
      {
        body: {
          foo: 'foo',
          string: 1,
          bool: true,
          file: await toFile(Buffer.from('some-content')),
          blob: new Blob(['Some content'], { type: 'text/plain' }),
        },
      },
      fetch,
    );
  });

  test('null', async () => {
    await expect(() =>
      multipartFormRequestOptions(
        {
          body: {
            null: null,
          },
        },
        fetch,
      ),
    ).rejects.toThrow(TypeError);
  });

  test('undefined is stripped', async () => {
    const form = await createForm(
      {
        foo: undefined,
        bar: 'baz',
      },
      fetch,
    );
    expect(form.has('foo')).toBe(false);
    expect(form.get('bar')).toBe('baz');
  });

  test('nested undefined property is stripped', async () => {
    const form = await createForm(
      {
        bar: {
          baz: undefined,
        },
      },
      fetch,
    );
    expect(Array.from(form.entries())).toEqual([]);

    const form2 = await createForm(
      {
        bar: {
          foo: 'string',
          baz: undefined,
        },
      },
      fetch,
    );
    expect(Array.from(form2.entries())).toEqual([['bar[foo]', 'string']]);
  });

  test('nested undefined array item is stripped', async () => {
    const form = await createForm(
      {
        bar: [undefined, undefined],
      },
      fetch,
    );
    expect(Array.from(form.entries())).toEqual([]);

    const form2 = await createForm(
      {
        bar: [undefined, 'foo'],
      },
      fetch,
    );
    expect(Array.from(form2.entries())).toEqual([['bar[]', 'foo']]);
  });

  test('file names strip path separators by default', async () => {
    const form = await createForm(
      {
        file: new File(['Some content'], 'my-skill/SKILL.md'),
      },
      fetch,
    );

    expect((form.get('file') as File).name).toBe('SKILL.md');
  });

  test('file names can preserve path separators for APIs that require directories', async () => {
    const form = await createForm(
      {
        files: [new File(['Some content'], 'my-skill/SKILL.md')],
      },
      fetch,
      { stripFilenames: false },
    );

    expect((form.get('files[]') as File).name).toBe('my-skill/SKILL.md');
  });
});
