import { vi } from 'vitest';

import { bufferSteadyMultipartUploads } from '../scripts/mock-server-fetch';

const unknownMockRoute = 'http://127.0.0.1:4010/_stainless_unknown_path';

function createMultipartBody(): FormData {
  const body = new FormData();
  body.append('default', 'true');
  body.append('files[]', new File([Uint8Array.from([0, 1, 2, 255])], 'README.md', { type: 'text/plain' }));
  return body;
}

describe('bufferSteadyMultipartUploads', () => {
  test('buffers multipart uploads to the local unknown route without changing their contents or options', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    const fetch = bufferSteadyMultipartUploads(fetchImplementation);
    const body = createMultipartBody();
    const controller = new AbortController();
    const init: RequestInit = {
      method: 'POST',
      body,
      headers: { authorization: 'Bearer test-key', 'x-custom': 'retained' },
      signal: controller.signal,
      redirect: 'manual',
      cache: 'no-store',
    };

    const response = await fetch(`${unknownMockRoute}?source=test`, init);

    expect(response.status).toBe(404);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [forwardedInput, forwardedInit] = fetchImplementation.mock.calls[0] ?? [];
    expect(forwardedInput).toBe(`${unknownMockRoute}?source=test`);
    expect(forwardedInit).toMatchObject({
      method: 'POST',
      signal: controller.signal,
      redirect: 'manual',
      cache: 'no-store',
    });
    expect(forwardedInit?.body).toBeInstanceOf(ArrayBuffer);

    const forwardedHeaders = new Headers(forwardedInit?.headers);
    expect(forwardedHeaders.get('authorization')).toBe('Bearer test-key');
    expect(forwardedHeaders.get('x-custom')).toBe('retained');
    expect(forwardedHeaders.get('content-type')).toMatch(/^multipart\/form-data; boundary=/u);

    const forwardedBody = await new Response(forwardedInit?.body, { headers: forwardedHeaders }).formData();
    expect(forwardedBody.get('default')).toBe('true');
    const file = forwardedBody.get('files[]') as File;
    expect(file.name).toBe('README.md');
    expect(file.type).toBe('text/plain');
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0, 1, 2, 255]);

    expect(init.body).toBe(body);
    expect(init.headers).toEqual({ authorization: 'Bearer test-key', 'x-custom': 'retained' });
  });

  test.each([
    ['valid local route', 'http://127.0.0.1:4010/skills'],
    ['different origin', 'https://example.com/_stainless_unknown_path'],
    ['different loopback hostname', 'http://localhost:4010/_stainless_unknown_path'],
    ['different port', 'http://127.0.0.1:4011/_stainless_unknown_path'],
  ])('forwards multipart uploads unchanged for a %s', async (_description, url) => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const fetch = bufferSteadyMultipartUploads(fetchImplementation);
    const init: RequestInit = { method: 'POST', body: createMultipartBody() };

    await fetch(url, init);

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [forwardedInput, forwardedInit] = fetchImplementation.mock.calls[0] ?? [];
    expect(forwardedInput).toBe(url);
    expect(forwardedInit).toBe(init);
  });

  test('forwards non-multipart requests to the unknown route unchanged', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    const fetch = bufferSteadyMultipartUploads(fetchImplementation);
    const init: RequestInit = {
      method: 'POST',
      body: '{"default":true}',
      headers: { 'content-type': 'application/json' },
    };

    await fetch(unknownMockRoute, init);

    expect(fetchImplementation).toHaveBeenCalledWith(unknownMockRoute, init);
    expect(fetchImplementation.mock.calls[0]?.[1]).toBe(init);
  });

  test('forwards data URLs unchanged', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(''));
    const fetch = bufferSteadyMultipartUploads(fetchImplementation);

    await fetch('data:,');

    expect(fetchImplementation).toHaveBeenCalledWith('data:,', undefined);
  });

  test('preserves Request inputs and their existing headers when buffering multipart bodies', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    const fetch = bufferSteadyMultipartUploads(fetchImplementation);
    const input = new Request(unknownMockRoute, {
      method: 'POST',
      headers: { 'x-request-header': 'retained' },
      redirect: 'manual',
    });
    const init: RequestInit = { body: createMultipartBody() };

    await fetch(input, init);

    const [forwardedInput, forwardedInit] = fetchImplementation.mock.calls[0] ?? [];
    expect(forwardedInput).toBe(input);
    expect(new Headers(forwardedInit?.headers).get('x-request-header')).toBe('retained');
    expect(forwardedInit?.body).toBeInstanceOf(ArrayBuffer);

    const forwardedRequest = new Request(input, forwardedInit);
    expect(forwardedRequest.method).toBe('POST');
    expect(forwardedRequest.redirect).toBe('manual');
  });
});
