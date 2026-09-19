import OpenAI from 'openai';
import type { APIPromise } from 'openai/core/api-promise';
import type { Stream } from 'openai/core/streaming';
import { compareType } from '../utils/typing';

test('accepts reusable RequestOptions in supported legacy GET calls', async () => {
  const requests: { url: URL; headers: Headers }[] = [];
  const client = new OpenAI({
    apiKey: 'synthetic',
    fetch: async (input, init) => {
      requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
      return Response.json({ object: 'response', id: 'resp_test', output: [], data: [], has_more: false });
    },
  });
  const options: OpenAI.RequestOptions = { headers: { 'x-legacy-test': 'preserved' }, maxRetries: 0 };
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
