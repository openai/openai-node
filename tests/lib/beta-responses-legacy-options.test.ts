import OpenAI from 'openai';
import type { APIPromise } from 'openai/core/api-promise';
import type { PagePromise } from 'openai/core/pagination';
import { Stream } from 'openai/core/streaming';
import type { BetaResponseItemsPage } from 'openai/resources/beta/responses/responses';
import { vi } from 'vitest';
import { compareType, expectType } from '../utils/typing';

function createClient() {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ id: 'resp_test', object: 'response', output: [], data: [], has_more: false }),
  );
  return { client: new OpenAI({ apiKey: 'synthetic', fetch }), fetch };
}

test('preserves typed request options in beta Responses GET calls', async () => {
  const { client, fetch } = createClient();
  const options: OpenAI.RequestOptions = { headers: { 'X-Test': 'legacy-options' } };
  const response = client.beta.responses.retrieve('resp_test', options);
  const page = client.beta.responses.inputItems.list('resp_test', options);
  compareType<
    typeof response,
    APIPromise<OpenAI.Beta.Responses.BetaResponse | Stream<OpenAI.Beta.Responses.BetaResponseStreamEvent>>
  >(true);
  compareType<typeof page, PagePromise<BetaResponseItemsPage, OpenAI.Beta.Responses.BetaResponseItem>>(true);
  await Promise.all([response, page]);

  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetch.mock.calls) {
    expect(new URL(String(url)).search).toBe('?beta=true');
    expect(new Headers(init?.headers).get('X-Test')).toBe('legacy-options');
  }
});

test.each([undefined, 'synthetic=v1', null])(
  'preserves beta headers and explicit override %s',
  async (beta) => {
    const { client, fetch } = createClient();
    const options: OpenAI.RequestOptions = {
      maxRetries: 0,
      headers: { 'OpenAI-Beta': beta, 'OpenAI-Project': 'proj_synthetic' },
    };
    await client.beta.responses.retrieve('resp_test', { betas: ['responses_multi_agent=v1'] }, options);
    await client.beta.responses.inputItems.list(
      'resp_test',
      { betas: ['responses_multi_agent=v1'], limit: 0 },
      options,
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [input, init] of fetch.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get('openai-beta')).toBe(beta === undefined ? 'responses_multi_agent=v1' : beta);
      expect(headers.get('openai-project')).toBe('proj_synthetic');
      expect(new URL(String(input)).searchParams.get('betas')).toBeNull();
    }
    expect(new URL(String(fetch.mock.calls[1]?.[0])).searchParams.get('limit')).toBe('0');
  },
);

test('retains legacy query options and headers across beta input-item pages', async () => {
  const { client, fetch } = createClient();
  fetch.mockResolvedValueOnce(Response.json({ data: [{ id: 'item_first' }], has_more: true }));
  const items = [];
  for await (const item of client.beta.responses.inputItems.list('resp_test', {
    query: { limit: 1, order: 'asc' },
    headers: { 'X-Test': 'pagination' },
  })) {
    items.push(item.id);
  }

  expect(items).toEqual(['item_first']);
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [input, init] of fetch.mock.calls) {
    const url = new URL(String(input));
    expect(url.pathname).toBe('/v1/responses/resp_test/input_items');
    expect(url.searchParams.get('beta')).toBe('true');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.get('order')).toBe('asc');
    expect(new Headers(init?.headers).get('X-Test')).toBe('pagination');
  }
  expect(new URL(String(fetch.mock.calls[1]?.[0])).searchParams.get('after')).toBe('item_first');
});

test.each([true, false, undefined])('preserves typed beta retrieval stream=%s', async (stream) => {
  const { client, fetch } = createClient();
  const event = { type: 'response.output_text.delta', delta: 'hello' };
  if (stream) {
    fetch.mockImplementation(
      async () =>
        new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    );
  }
  const options: OpenAI.RequestOptions = { stream };
  const pending = client.beta.responses.retrieve('resp_test', options);
  compareType<
    typeof pending,
    APIPromise<OpenAI.Beta.Responses.BetaResponse | Stream<OpenAI.Beta.Responses.BetaResponseStreamEvent>>
  >(true);
  const result = await pending;
  if (result instanceof Stream) {
    expect(stream).toBe(true);
    const literal = await client.beta.responses.retrieve('resp_test', { stream: true });
    await Promise.all(
      [result, literal].map(async (response) => {
        const events = [];
        for await (const item of response) {
          events.push(item);
        }
        expect(events).toEqual([event]);
      }),
    );
  } else {
    expect(stream).not.toBe(true);
    expect(result.id).toBe('resp_test');
  }
  expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get('stream')).toBe(
    stream === undefined ? null : String(stream),
  );
});

test('rejects mixed beta parameters and legacy options before dispatch', () => {
  const { client, fetch } = createClient();
  expect(() =>
    // @ts-expect-error Beta header parameters and request options require separate arguments.
    client.beta.responses.retrieve('resp_test', { betas: ['responses_multi_agent=v1'], headers: {} }),
  ).toThrow(/separate arguments/u);
  expect(() =>
    // @ts-expect-error Streaming query parameters and request options require separate arguments.
    client.beta.responses.retrieve('resp_test', { stream: false, headers: {} }),
  ).toThrow(/separate arguments/u);
  expect(() =>
    // @ts-expect-error Pagination query parameters and request options require separate arguments.
    client.beta.responses.inputItems.list('resp_test', { limit: 1, headers: {} }),
  ).toThrow(/separate arguments/u);
  expect(() =>
    // @ts-expect-error Beta header parameters and request options require separate arguments.
    client.beta.responses.inputItems.list('resp_test', { betas: ['responses_multi_agent=v1'], headers: {} }),
  ).toThrow(/separate arguments/u);
  expect(fetch).not.toHaveBeenCalled();
});

test.each([true, false, 'true'])('rejects nested beta options.query.stream=%s', (stream) => {
  const { client, fetch } = createClient();
  expect(() => client.beta.responses.retrieve('resp_test', { query: { stream } })).toThrow(
    /Pass stream in the query argument/u,
  );
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  { kind: 'array', query: Object.assign([], { stream: true }) },
  { kind: 'callable', query: Object.assign(() => 'unused', { stream: true }) },
])('rejects stream from enumerable $kind beta query options', ({ query }) => {
  const { client, fetch } = createClient();
  expect(() => client.beta.responses.retrieve('resp_test', { query })).toThrow(
    /Pass stream in the query argument/u,
  );
  expect(fetch).not.toHaveBeenCalled();
});

test('sends the validated snapshot of nested beta query options', async () => {
  const { client, fetch } = createClient();
  let reads = 0;
  const query = {
    starting_after: 0,
    include_obfuscation: false,
    get stream() {
      reads += 1;
      return reads === 1 ? undefined : true;
    },
  };
  const pending = client.beta.responses.retrieve('resp_test', { query });
  query.starting_after = 1;
  await pending;
  expect(reads).toBe(1);
  expect(new URL(String(fetch.mock.calls[0]?.[0])).search).toBe(
    '?beta=true&starting_after=0&include_obfuscation=false',
  );
});

test.each([{ headers: { 'OpenAI-Project': 'proj_synthetic' } }, { maxRetries: 0 }])(
  'rejects restricted legacy beta options %j',
  (value) => {
    const { client, fetch } = createClient();
    const options: OpenAI.RequestOptions = value;
    expect(() => client.beta.responses.retrieve('resp_test', options)).toThrow(/explicit request options/u);
    expect(() => client.beta.responses.inputItems.list('resp_test', options)).toThrow(
      /explicit request options/u,
    );
    expect(fetch).not.toHaveBeenCalled();
  },
);

test('preserves beta retrieval overloads and utility-type consumers', () => {
  const { client } = createClient();
  const plain = () => client.beta.responses.retrieve('resp_test', { headers: {} });
  const streamed = () => client.beta.responses.retrieve('resp_test', { stream: true });
  const either = (stream: boolean) => client.beta.responses.retrieve('resp_test', { stream });
  compareType<ReturnType<typeof plain>, APIPromise<OpenAI.Beta.Responses.BetaResponse>>(true);
  compareType<ReturnType<typeof streamed>, APIPromise<Stream<OpenAI.Beta.Responses.BetaResponseStreamEvent>>>(
    true,
  );
  compareType<ReturnType<typeof either>, ReturnType<typeof client.beta.responses.retrieve>>(true);
  const bound = client.beta.responses.retrieve.bind(client.beta.responses, 'resp_test');
  compareType<Parameters<typeof bound>[0], Parameters<typeof client.beta.responses.retrieve>[1]>(true);
  expectType<Parameters<typeof client.beta.responses.retrieve>>([
    'resp_test',
    { stream: true, betas: ['responses_multi_agent=v1'] },
    { maxRetries: 0 },
  ]);
  expectType<Parameters<typeof client.beta.responses.inputItems.list>>([
    'resp_test',
    { limit: 1, betas: ['responses_multi_agent=v1'] },
    { maxRetries: 0 },
  ]);
});
