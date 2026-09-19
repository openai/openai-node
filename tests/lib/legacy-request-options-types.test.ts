import OpenAI from 'openai';
import type { APIPromise } from 'openai/core/api-promise';
import type { Stream } from 'openai/core/streaming';
import { compareType, expectType } from '../utils/typing';

test('accepts reusable RequestOptions in supported legacy GET calls', async () => {
  const requests: { url: URL; headers: Headers }[] = [];
  const client = new OpenAI({
    apiKey: 'synthetic',
    fetch: async (input, init) => {
      requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
      return Response.json({ object: 'response', id: 'resp_test', output: [], data: [], has_more: false });
    },
  });
  const options: OpenAI.RequestOptions = { headers: { 'x-legacy-test': 'preserved' } };
  const response = client.responses.retrieve('resp_test', options);
  compareType<typeof response, APIPromise<OpenAI.Responses.Response>>(true);

  await Promise.all([
    response,
    client.files.list(options),
    client.beta.assistants.list(options),
    client.conversations.items.list('conv_test', options),
    client.webhooks.list(options),
  ]);

  expect(requests).toHaveLength(5);
  for (const { url, headers } of requests) {
    expect(url.search).toBe('');
    expect(headers.get('x-legacy-test')).toBe('preserved');
  }
});

test('preserves the query overload return types', () => {
  const client = new OpenAI({ apiKey: 'synthetic' });
  const retrieve = () => client.responses.retrieve('resp_test', { stream: false });
  const retrieveStream = () => client.responses.retrieve('resp_test', { stream: true });
  const retrieveEither = (stream: boolean) => client.responses.retrieve('resp_test', { stream });

  compareType<ReturnType<typeof retrieve>, APIPromise<OpenAI.Responses.Response>>(true);
  compareType<ReturnType<typeof retrieveStream>, APIPromise<Stream<OpenAI.Responses.ResponseStreamEvent>>>(
    true,
  );
  compareType<
    ReturnType<typeof retrieveEither>,
    APIPromise<OpenAI.Responses.Response | Stream<OpenAI.Responses.ResponseStreamEvent>>
  >(true);
});

test('preserves query parameters for utility-type wrappers and apply', async () => {
  const requests: URL[] = [];
  const client = new OpenAI({
    apiKey: 'synthetic',
    fetch: async (input) => {
      requests.push(new URL(String(input)));
      return Response.json({ data: [], has_more: false });
    },
  });
  const options: OpenAI.RequestOptions = { maxRetries: 0 };
  const fileArgs: Parameters<typeof client.files.list> = [{ limit: 2 }, options];
  const itemArgs: Parameters<typeof client.conversations.items.list> = ['conv_test', { limit: 3 }, options];
  const listFiles = (...args: Parameters<typeof client.files.list>) => client.files.list(...args);

  await listFiles(...fileArgs);
  // eslint-disable-next-line prefer-spread -- Exercise the public overload selected by Function.apply.
  await client.conversations.items.list.apply(client.conversations.items, itemArgs);

  expect(requests.map((url) => url.searchParams.get('limit'))).toEqual(['2', '3']);
});

test('preserves the broad streaming method type for utility-type consumers', () => {
  const client = new OpenAI({ apiKey: 'synthetic' });
  const query: OpenAI.Responses.ResponseRetrieveParams = { stream: true };
  expectType<Parameters<typeof client.responses.retrieve>>(['resp_test', query, { maxRetries: 0 }]);
  const retrieve = (...parameters: Parameters<typeof client.responses.retrieve>) =>
    client.responses.retrieve(...parameters);
  const retrieveBound = client.responses.retrieve.bind(client.responses, 'resp_test');

  compareType<
    ReturnType<typeof client.responses.retrieve>,
    APIPromise<OpenAI.Responses.Response | Stream<OpenAI.Responses.ResponseStreamEvent>>
  >(true);
  compareType<ReturnType<typeof retrieve>, ReturnType<typeof client.responses.retrieve>>(true);
  compareType<Parameters<typeof retrieveBound>[0], Parameters<typeof client.responses.retrieve>[1]>(true);
  expectType<Parameters<typeof retrieveBound>>([query, { maxRetries: 0 }]);
});
