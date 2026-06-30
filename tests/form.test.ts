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

  test('strips file paths by default', async () => {
    const form = await createForm(
      {
        files: [new File(['Example data'], 'my-skill/SKILL.md')],
      },
      fetch,
    );

    expect((form.get('files[]') as File).name).toBe('SKILL.md');
  });

  test('preserves file paths when requested', async () => {
    const form = await createForm(
      {
        files: [new File(['Example data'], 'my-skill/SKILL.md')],
      },
      fetch,
      { preserveFilePaths: true },
    );

    expect((form.get('files[]') as File).name).toBe('my-skill/SKILL.md');
  });

  test('strips response URLs when preserving file paths', async () => {
    const response = new Response('Example data');
    Object.defineProperty(response, 'url', { value: 'https://cdn.example.com/my-skill/SKILL.md' });

    const form = await createForm(
      {
        files: [response],
      },
      fetch,
      { preserveFilePaths: true },
    );

    expect((form.get('files[]') as File).name).toBe('SKILL.md');
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
});
