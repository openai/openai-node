import { vi } from 'vitest';

import OpenAI from 'openai';
import {
  maybeMultipartFormRequestOptions,
  multipartFormRequestOptions,
  toStreamingFile,
} from 'openai/internal/uploads';

interface RecordedRequest {
  body: RequestInit['body'];
}

function captureImageRequests() {
  const requests: RecordedRequest[] = [];
  const transport = Object.assign(
    async (_request: Request | URL | string, options?: RequestInit): Promise<Response> => {
      requests.push({ body: options?.body });
      return Response.json({ created: 0, data: [], text: 'transcribed' });
    },
    { Response },
  );

  return {
    client: new OpenAI({ apiKey: 'test-api-key', fetch: transport as typeof fetch }),
    requests,
    transport,
  };
}

function capturedForm(requests: RecordedRequest[], index = 0): FormData {
  const body = requests[index]?.body;
  if (!(body instanceof FormData)) {
    throw new Error('Expected a buffered multipart request');
  }
  return body;
}

function capturedStream(requests: RecordedRequest[], index = 0): ReadableStream {
  const body = requests[index]?.body;
  if (!(body instanceof ReadableStream)) {
    throw new Error('Expected a streaming multipart request');
  }
  return body;
}

describe('multipart Blob upload integrity', () => {
  test('preserves plain image Blobs, their order, and an actual public image-edit mask', async () => {
    const { client, requests } = captureImageRequests();
    const image = new Blob(['private intended base image'], { type: 'image/png' });
    const overlay = new File(['named overlay'], 'overlay.png', { type: 'image/png' });
    const mask = new Blob(['private intended edit mask'], { type: 'image/png' });

    await client.images.edit({
      model: 'gpt-image-1',
      prompt: 'Edit only the masked portion of the first image',
      image: [image, overlay],
      mask,
    });

    const form = capturedForm(requests);
    const images = form.getAll('image[]') as File[];
    expect(images.map((entry) => entry.name)).toEqual(['blob', 'overlay.png']);
    expect(images.map((entry) => entry.type)).toEqual(['image/png', 'image/png']);
    await expect(Promise.all(images.map((entry) => entry.text()))).resolves.toEqual([
      'private intended base image',
      'named overlay',
    ]);

    const uploadedMask = form.get('mask');
    expect(uploadedMask).toBeInstanceOf(File);
    expect((uploadedMask as File).name).toBe('blob');
    expect((uploadedMask as File).type).toBe('image/png');
    await expect((uploadedMask as File).text()).resolves.toBe('private intended edit mask');
  });

  test('detects nested plain Blobs for optional multipart requests without changing ordinary JSON', async () => {
    const image = new Blob(['nested image bytes'], { type: 'image/png' });
    const options = await maybeMultipartFormRequestOptions(
      { body: { nested: { images: [undefined, image], label: 'kept' } } },
      fetch,
    );

    expect(options.body).toBeInstanceOf(FormData);
    const form = options.body as FormData;
    const uploaded = form.get('nested[images][]') as File;
    expect(uploaded.name).toBe('blob');
    expect(uploaded.type).toBe('image/png');
    await expect(uploaded.text()).resolves.toBe('nested image bytes');
    expect(form.get('nested[label]')).toBe('kept');

    const ordinary = { body: { nested: { count: 2 } } };
    await expect(maybeMultipartFormRequestOptions(ordinary, fetch)).resolves.toBe(ordinary);
  });

  test('keeps Blob images and Blob masks alongside a lazy public streaming image upload', async () => {
    const { client, requests } = captureImageRequests();
    let completed = false;

    async function* streamedImage() {
      yield new TextEncoder().encode('streamed base image bytes');
      yield new TextEncoder().encode(' streamed final bytes');
      completed = true;
    }

    const overlay = new Blob(['plain overlay image bytes'], { type: 'image/png' });
    const mask = new Blob(['plain streaming edit mask bytes'], { type: 'image/png' });

    await client.images.edit({
      model: 'gpt-image-1',
      prompt: 'Preserve every source image and the mask',
      image: [toStreamingFile(streamedImage(), '/private/source/base.png', { type: 'image/png' }), overlay],
      mask,
    });

    expect(completed).toBe(false);
    const encoded = await new Response(capturedStream(requests)).text();
    expect(completed).toBe(true);
    expect(encoded).not.toContain('/private/source');
    expect(encoded).toContain('name="image[]"; filename="base.png"');
    expect(encoded).toContain('name="image[]"; filename="unknown_file"');
    expect(encoded).toContain('name="mask"; filename="unknown_file"');
    expect(encoded).toContain('streamed base image bytes streamed final bytes');
    expect(encoded).toContain('plain overlay image bytes');
    expect(encoded).toContain('plain streaming edit mask bytes');
    expect(encoded.match(/Content-Type: image\/png/gu)).toHaveLength(3);
    expect(encoded.indexOf('streamed base image bytes')).toBeLessThan(
      encoded.indexOf('plain overlay image bytes'),
    );
    expect(encoded.split('plain overlay image bytes')).toHaveLength(2);
    expect(encoded.split('plain streaming edit mask bytes')).toHaveLength(2);
  });

  test('preserves Response media types and safe inferred names in actual public image requests', async () => {
    const { client, requests } = captureImageRequests();
    const image = new Response('downloaded private image', {
      headers: { 'content-type': 'image/png' },
    });
    Object.defineProperty(image, 'url', {
      value: 'https://example.invalid/private/response-image.png',
    });

    await client.images.edit({
      model: 'gpt-image-1',
      prompt: 'Preserve the downloaded image format',
      image,
    });

    const uploaded = capturedForm(requests).get('image') as File;
    expect(uploaded.name).toBe('response-image.png');
    expect(uploaded.type).toBe('image/png');
    await expect(uploaded.text()).resolves.toBe('downloaded private image');
  });

  test('preserves Response audio formats through the actual public transcription client', async () => {
    const { client, requests } = captureImageRequests();
    const audio = new Response('downloaded audio bytes', {
      headers: { 'content-type': 'audio/wav' },
    });
    Object.defineProperty(audio, 'url', {
      value: 'https://example.invalid/private/recording.wav',
    });

    await client.audio.transcriptions.create({ model: 'whisper-1', file: audio });

    const uploaded = capturedForm(requests).get('file') as File;
    expect(uploaded.name).toBe('recording.wav');
    expect(uploaded.type).toBe('audio/wav');
    await expect(uploaded.text()).resolves.toBe('downloaded audio bytes');
  });

  test('retains custom Blob filenames, caller-selected path preservation, and anonymous browser defaults', async () => {
    const named = Object.assign(new Blob(['skill manifest'], { type: 'text/markdown' }), {
      name: 'my-skill/SKILL.md',
    });
    const anonymous = new Blob(['anonymous bytes'], { type: 'application/json' });

    const defaultOptions = await multipartFormRequestOptions({ body: { named, anonymous } }, fetch);
    const defaultForm = defaultOptions.body as FormData;
    expect((defaultForm.get('named') as File).name).toBe('SKILL.md');
    expect((defaultForm.get('anonymous') as File).name).toBe('blob');
    expect((defaultForm.get('anonymous') as File).type).toBe('application/json');

    const preservedOptions = await multipartFormRequestOptions({ body: { named, anonymous } }, fetch, {
      stripFilenames: false,
    });
    const preservedForm = preservedOptions.body as FormData;
    expect((preservedForm.get('named') as File).name).toBe('my-skill/SKILL.md');
    expect((preservedForm.get('anonymous') as File).name).toBe('blob');
  });

  test('keeps sparse asynchronous Response and plain Blob entries in their original order', async () => {
    const { client, requests } = captureImageRequests();
    const response = new Response('first delayed image', {
      headers: { 'content-type': 'image/png' },
    });
    Object.defineProperty(response, 'url', { value: 'https://example.invalid/first.png' });
    const originalBlob = response.blob.bind(response);
    vi.spyOn(response, 'blob').mockImplementation(async () => {
      await Promise.resolve();
      return originalBlob();
    });

    const images: (Blob | Response | undefined)[] = [];
    images[1] = response;
    images[3] = new Blob(['second anonymous image'], { type: 'image/png' });
    images.length = 5;

    await client.images.edit({
      model: 'gpt-image-1',
      prompt: 'Keep sparse and asynchronous upload order',
      image: images as (Blob | Response)[],
    });

    const uploaded = capturedForm(requests).getAll('image[]') as File[];
    expect(uploaded.map((entry) => entry.name)).toEqual(['first.png', 'blob']);
    expect(uploaded.map((entry) => entry.type)).toEqual(['image/png', 'image/png']);
    await expect(Promise.all(uploaded.map((entry) => entry.text()))).resolves.toEqual([
      'first delayed image',
      'second anonymous image',
    ]);
  });

  test('keeps missing Response content types and anonymous Blob content types unchanged', async () => {
    const { client, requests } = captureImageRequests();
    const image = new Response(new Uint8Array([1, 2, 3]));
    const overlay = new Blob([new Uint8Array([4, 5])]);

    await client.images.edit({
      model: 'gpt-image-1',
      prompt: 'Preserve absent content types',
      image: [image, overlay],
    });

    const uploaded = capturedForm(requests).getAll('image[]') as File[];
    expect(uploaded.map((entry) => entry.type)).toEqual(['', '']);
    expect(uploaded.map((entry) => entry.name)).toEqual(['unknown_file', 'blob']);
  });
});
