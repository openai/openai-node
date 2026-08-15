const steadyOrigin = 'http://127.0.0.1:4010';
const unknownPath = '/_stainless_unknown_path';

export function bufferSteadyMultipartUploads(
  fetchImplementation: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    if (!(init?.body instanceof FormData)) {
      return fetchImplementation(input, init);
    }

    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== steadyOrigin || url.pathname !== unknownPath) {
      return fetchImplementation(input, init);
    }

    // Steady returns 404 before consuming unknown-route uploads, which can cause EPIPE.
    const request = new Request(input, init);
    return fetchImplementation(input, {
      ...init,
      headers: request.headers,
      body: await request.arrayBuffer(),
    });
  };
}
