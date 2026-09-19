import OpenAI from 'openai';
import type { APIPromise } from 'openai/core/api-promise';
import type { Stream } from 'openai/core/streaming';
import { compareType } from '../utils/typing';

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
