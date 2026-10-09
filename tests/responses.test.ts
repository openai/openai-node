import { APIPromise } from 'openai/api-promise';
import OpenAI from 'openai/index';
import { compareType } from './utils/typing';

const client = new OpenAI({ apiKey: 'example-api-key' });

describe('request id', () => {
  test('types', () => {
    compareType<Awaited<APIPromise<string>>, string>(true);
    compareType<Awaited<APIPromise<number>>, number>(true);
    compareType<Awaited<APIPromise<null>>, null>(true);
    compareType<Awaited<APIPromise<void>>, void>(true);
    compareType<Awaited<APIPromise<Response>>, Response>(true);
    compareType<Awaited<APIPromise<Response>>, Response>(true);
    compareType<Awaited<APIPromise<{ foo: string }>>, { foo: string } & { _request_id?: string | null }>(
      true,
    );
    compareType<Awaited<APIPromise<{ foo: string }[]>>, { foo: string }[]>(true);
  });

  test('withResponse', async () => {
    const client = new OpenAI({
      apiKey: 'dummy',
      fetch: async () =>
        Response.json(
          { id: 'bar' },
          {
            headers: { 'x-request-id': 'req_id_xxx', 'content-type': 'application/json' },
          },
        ),
    });

    const {
      data: completion,
      response,
      request_id,
    } = await client.chat.completions.create({ messages: [], model: 'gpt-4' }).withResponse();

    expect(request_id).toBe('req_id_xxx');
    expect(response.headers.get('x-request-id')).toBe('req_id_xxx');
    expect(completion.id).toBe('bar');
    expect(JSON.stringify(completion)).toBe('{"id":"bar"}');
  });

  test('object response', async () => {
    const client = new OpenAI({
      apiKey: 'dummy',
      fetch: async () =>
        Response.json(
          { id: 'bar' },
          {
            headers: { 'x-request-id': 'req_id_xxx', 'content-type': 'application/json' },
          },
        ),
    });

    const rsp = await client.chat.completions.create({ messages: [], model: 'gpt-4' });
    expect(rsp.id).toBe('bar');
    expect(rsp._request_id).toBe('req_id_xxx');
    expect(JSON.stringify(rsp)).toBe('{"id":"bar"}');
  });

  test('envelope response', async () => {
    const promise = new APIPromise<{ data: { foo: string } }>(
      client,
      Promise.resolve({
        response: Response.json(
          { data: { foo: 'bar' } },
          {
            headers: { 'x-request-id': 'req_id_xxx', 'content-type': 'application/json' },
          },
        ),
        // SAFETY: This response-parsing fixture never aborts or builds requests; the empty controller/options are inert constructor placeholders.
        controller: {} as any,
        // SAFETY: This response-parsing fixture never aborts or builds requests; the empty controller/options are inert constructor placeholders.
        options: {} as any,
        requestLogID: 'log_...',
        retryOfRequestLogID: undefined,
        startTime: Date.now(),
      }),
    )._thenUnwrap((d) => d.data);

    const rsp = await promise;
    expect(rsp.foo).toBe('bar');
    expect(rsp._request_id).toBe('req_id_xxx');
  });

  test('page response', async () => {
    const client = new OpenAI({
      apiKey: 'dummy',
      fetch: async () =>
        Response.json(
          { data: [{ foo: 'bar' }] },
          {
            headers: { 'x-request-id': 'req_id_xxx', 'content-type': 'application/json' },
          },
        ),
    });

    const page = await client.fineTuning.jobs.list();
    expect(page.data).toMatchObject([{ foo: 'bar' }]);
    // SAFETY: The assertion intentionally probes for absent _request_id on a page, array, or primitive; it does not treat that property as present.
    expect((page as any)._request_id).toBeUndefined();
  });

  test('array response', async () => {
    const promise = new APIPromise<{ foo: string }[]>(
      client,
      Promise.resolve({
        response: Response.json([{ foo: 'bar' }], {
          headers: { 'x-request-id': 'req_id_xxx', 'content-type': 'application/json' },
        }),
        // SAFETY: This response-parsing fixture never aborts or builds requests; the empty controller/options are inert constructor placeholders.
        controller: {} as any,
        // SAFETY: This response-parsing fixture never aborts or builds requests; the empty controller/options are inert constructor placeholders.
        options: {} as any,
        requestLogID: 'log_...',
        retryOfRequestLogID: undefined,
        startTime: Date.now(),
      }),
    );

    const rsp = await promise;
    expect(rsp.length).toBe(1);
    expect(rsp[0]).toMatchObject({ foo: 'bar' });
    // SAFETY: The assertion intentionally probes for absent _request_id on a page, array, or primitive; it does not treat that property as present.
    expect((rsp as any)._request_id).toBeUndefined();
  });

  test('string response', async () => {
    const promise = new APIPromise<string>(
      client,
      Promise.resolve({
        response: new Response('hello world', {
          headers: { 'x-request-id': 'req_id_xxx', 'content-type': 'application/text' },
        }),
        // SAFETY: This response-parsing fixture never aborts or builds requests; the empty controller/options are inert constructor placeholders.
        controller: {} as any,
        // SAFETY: This response-parsing fixture never aborts or builds requests; the empty controller/options are inert constructor placeholders.
        options: {} as any,
        requestLogID: 'log_...',
        retryOfRequestLogID: undefined,
        startTime: Date.now(),
      }),
    );

    const result = await promise;
    expect(result).toBe('hello world');
    // SAFETY: The assertion intentionally probes for absent _request_id on a page, array, or primitive; it does not treat that property as present.
    expect((result as any)._request_id).toBeUndefined();
  });
});
