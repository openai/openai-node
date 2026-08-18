import { vi } from 'vitest';

import OpenAI from 'openai';
import { createForm, multipartFormRequestOptions, toStreamingFile } from 'openai/internal/uploads';

function imageResponse(name: string, contents = name): Response {
  const response = new Response(contents, { headers: { 'content-type': 'image/png' } });
  Object.defineProperty(response, 'url', { value: `https://example.invalid/${name}` });
  return response;
}

function formValues(form: FormData, name: string): string[] {
  return form.getAll(name).map((value) => (typeof value === 'string' ? value : value.name));
}

function pauseResponse(response: Response, name: string, started: string[], completed: string[]): () => void {
  let released = false;

  vi.spyOn(response, 'blob').mockImplementation(async () => {
    started.push(name);
    await vi.waitFor(() => {
      expect(released).toBe(true);
    });
    completed.push(name);
    return new Blob([name], { type: 'image/png' });
  });

  return () => {
    released = true;
  };
}

async function* imageChunks(): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode('streamed first image');
}

describe('buffered multipart array ordering', () => {
  test('keeps the mask attached to the first image in public image-edit requests', async () => {
    const requests: FormData[] = [];
    const transport = Object.assign(
      async (_request: Request | URL | string, options?: RequestInit): Promise<Response> => {
        requests.push(options?.body as FormData);
        return Response.json({ created: 0, data: [] });
      },
      { Response },
    );
    const client = new OpenAI({ apiKey: 'test-api-key', fetch: transport as typeof fetch });
    const base = imageResponse('base.png', 'intended base image');
    const overlay = new File(['overlay image'], 'overlay.png', { type: 'image/png' });
    const mask = new File(['mask for base'], 'mask.png', { type: 'image/png' });

    await client.images.edit({
      model: 'gpt-image-1',
      prompt: 'Edit only the first image with its mask',
      image: [base, overlay],
      mask,
    });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    if (!request) {
      throw new Error('Expected an image-edit request');
    }

    expect(formValues(request, 'image[]')).toEqual(['base.png', 'overlay.png']);
    expect((request.get('mask') as File).name).toBe('mask.png');
  });

  test('omits sparse image slots in public image-edit requests without moving the mask', async () => {
    const requests: FormData[] = [];
    const transport = Object.assign(
      async (_request: Request | URL | string, options?: RequestInit): Promise<Response> => {
        requests.push(options?.body as FormData);
        return Response.json({ created: 0, data: [] });
      },
      { Response },
    );
    const client = new OpenAI({ apiKey: 'test-api-key', fetch: transport as typeof fetch });
    const images: (File | Response)[] = [];
    images[1] = imageResponse('base.png');
    images[3] = new File(['overlay'], 'overlay.png', { type: 'image/png' });
    const mask = new File(['mask'], 'mask.png', { type: 'image/png' });

    await client.images.edit({
      model: 'gpt-image-1',
      prompt: 'Preserve sparse image order',
      image: images,
      mask,
    });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    if (!request) {
      throw new Error('Expected an image-edit request');
    }

    expect(formValues(request, 'image[]')).toEqual(['base.png', 'overlay.png']);
    expect((request.get('mask') as File).name).toBe('mask.png');
    expect(images).toHaveLength(4);
    expect(0 in images).toBe(false);
    expect(2 in images).toBe(false);
  });

  test('preserves asynchronous Response entries before synchronous File entries', async () => {
    const first = imageResponse('first.png', 'first');
    const second = new File(['second'], 'second.png', { type: 'image/png' });

    const form = await createForm({ images: [first, second] }, fetch);

    expect(formValues(form, 'images[]')).toEqual(['first.png', 'second.png']);
    await expect((form.getAll('images[]')[0] as File).text()).resolves.toBe('first');
    await expect((form.getAll('images[]')[1] as File).text()).resolves.toBe('second');
  });

  test('starts all Response reads concurrently but commits them in input order', async () => {
    const started: string[] = [];
    const completed: string[] = [];
    const first = imageResponse('first.png');
    const second = imageResponse('second.png');
    const releaseFirst = pauseResponse(first, 'first', started, completed);
    const releaseSecond = pauseResponse(second, 'second', started, completed);

    const pending = createForm({ images: [first, second] }, fetch);
    await vi.waitFor(() => {
      expect(started).toEqual(['first', 'second']);
    });

    releaseSecond();
    await vi.waitFor(() => {
      expect(completed).toEqual(['second']);
    });
    releaseFirst();

    expect(formValues(await pending, 'images[]')).toEqual(['first.png', 'second.png']);
    expect(completed).toEqual(['second', 'first']);
  });

  test('preserves nested array and object groups without changing their bracketed names', async () => {
    const first = imageResponse('first.png');
    const second = new File(['second'], 'second.png');
    const third = imageResponse('third.png');
    const fourth = new File(['fourth'], 'fourth.png');
    const input = [{ images: [first, second] }, { images: [third, fourth] }];

    const form = await createForm({ payload: { groups: input } }, fetch);

    expect(formValues(form, 'payload[groups][][images][]')).toEqual([
      'first.png',
      'second.png',
      'third.png',
      'fourth.png',
    ]);
    expect(input[0]?.images).toEqual([first, second]);
    expect(input[1]?.images).toEqual([third, fourth]);
  });

  test('omits undefined entries while preserving synchronous and asynchronous values', async () => {
    const first = imageResponse('first.png');
    const second = new File(['second'], 'second.png');

    const form = await createForm({ values: [first, undefined, 'between', second, undefined] }, fetch);

    expect(formValues(form, 'values[]')).toEqual(['first.png', 'between', 'second.png']);
  });

  test('omits leading, middle, and trailing sparse slots in nested upload arrays', async () => {
    const first: (File | Response | undefined)[] = [];
    first[1] = imageResponse('first.png');
    first[2] = undefined;
    first[4] = new File(['second'], 'second.png');
    const second: (File | Response | undefined)[] = [];
    second[2] = imageResponse('third.png');
    second.length = 4;
    const groups: { images: (File | Response | undefined)[] }[] = [];
    groups[1] = { images: first };
    groups[3] = { images: second };
    groups.length = 5;

    const form = await createForm({ payload: { groups } }, fetch);

    expect(formValues(form, 'payload[groups][][images][]')).toEqual(['first.png', 'second.png', 'third.png']);
    expect(0 in first).toBe(false);
    expect(2 in first).toBe(true);
    expect(3 in first).toBe(false);
    expect(0 in groups).toBe(false);
    expect(2 in groups).toBe(false);
    expect(4 in groups).toBe(false);
  });

  test('preserves explicit filename paths, file metadata, and ordinary buffered errors', async () => {
    const first = imageResponse('first.png');
    const second = new File(['second'], 'folder/second.png', {
      type: 'image/jpeg',
      lastModified: 123,
    });
    const input = [first, second];

    const form = await createForm({ images: input }, fetch, { stripFilenames: false });
    const values = form.getAll('images[]') as File[];

    expect(values.map((value) => value.name)).toEqual(['first.png', 'folder/second.png']);
    expect(values[1]?.type).toBe('image/jpeg');
    expect(values[1]?.lastModified).toBe(123);
    expect(input).toEqual([first, second]);
    await expect(createForm({ values: [new File(['first'], 'first.png'), null] }, fetch)).rejects.toThrow(
      'Received null for "values[]"',
    );
  });

  test('keeps lazy streaming multipart uploads in their original input order', async () => {
    const options = await multipartFormRequestOptions(
      {
        body: {
          images: [
            toStreamingFile(imageChunks(), 'first.png', { type: 'image/png' }),
            new File(['second'], 'second.png', { type: 'image/png' }),
          ],
        },
      },
      fetch,
    );

    expect(options.body).toBeInstanceOf(ReadableStream);
    const encoded = await new Response(options.body as ReadableStream).text();

    expect(encoded.indexOf('filename="first.png"')).toBeGreaterThanOrEqual(0);
    expect(encoded.indexOf('filename="second.png"')).toBeGreaterThan(encoded.indexOf('filename="first.png"'));
  });
});
