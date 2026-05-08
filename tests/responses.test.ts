import { APIPromise } from 'openai/api-promise';
import OpenAI from 'openai/index';
import { compareType, expectType } from './utils/typing';

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
    compareType<Awaited<APIPromise<Array<{ foo: string }>>>, Array<{ foo: string }>>(true);
  });

  test('withResponse', async () => {
    const client = new OpenAI({
      apiKey: 'dummy',
      fetch: async () =>
        new Response(JSON.stringify({ id: 'bar' }), {
          headers: { 'x-request-id': 'req_id_xxx', 'content-type': 'application/json' },
        }),
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
        new Response(JSON.stringify({ id: 'bar' }), {
          headers: { 'x-request-id': 'req_id_xxx', 'content-type': 'application/json' },
        }),
    });

    const rsp = await client.chat.completions.create({ messages: [], model: 'gpt-4' });
    expect(rsp.id).toBe('bar');
    expect(rsp._request_id).toBe('req_id_xxx');
    expect(JSON.stringify(rsp)).toBe('{"id":"bar"}');
  });

  test('envelope response', async () => {
    const promise = new APIPromise<{ data: { foo: string } }>(
      client,
      (async () => {
        return {
          response: new Response(JSON.stringify({ data: { foo: 'bar' } }), {
            headers: { 'x-request-id': 'req_id_xxx', 'content-type': 'application/json' },
          }),
          controller: {} as any,
          options: {} as any,
          requestLogID: 'log_...',
          retryOfRequestLogID: undefined,
          startTime: Date.now(),
        };
      })(),
    )._thenUnwrap((d) => d.data);

    const rsp = await promise;
    expect(rsp.foo).toBe('bar');
    expect(rsp._request_id).toBe('req_id_xxx');
  });

  test('page response', async () => {
    const client = new OpenAI({
      apiKey: 'dummy',
      fetch: async () =>
        new Response(JSON.stringify({ data: [{ foo: 'bar' }] }), {
          headers: { 'x-request-id': 'req_id_xxx', 'content-type': 'application/json' },
        }),
    });

    const page = await client.fineTuning.jobs.list();
    expect(page.data).toMatchObject([{ foo: 'bar' }]);
    expect((page as any)._request_id).toBeUndefined();
  });

  test('array response', async () => {
    const promise = new APIPromise<Array<{ foo: string }>>(
      client,
      (async () => {
        return {
          response: new Response(JSON.stringify([{ foo: 'bar' }]), {
            headers: { 'x-request-id': 'req_id_xxx', 'content-type': 'application/json' },
          }),
          controller: {} as any,
          options: {} as any,
          requestLogID: 'log_...',
          retryOfRequestLogID: undefined,
          startTime: Date.now(),
        };
      })(),
    );

    const rsp = await promise;
    expect(rsp.length).toBe(1);
    expect(rsp[0]).toMatchObject({ foo: 'bar' });
    expect((rsp as any)._request_id).toBeUndefined();
  });

  test('string response', async () => {
    const promise = new APIPromise<string>(
      client,
      (async () => {
        return {
          response: new Response('hello world', {
            headers: { 'x-request-id': 'req_id_xxx', 'content-type': 'application/text' },
          }),
          controller: {} as any,
          options: {} as any,
          requestLogID: 'log_...',
          retryOfRequestLogID: undefined,
          startTime: Date.now(),
        };
      })(),
    );

    const result = await promise;
    expect(result).toBe('hello world');
    expect((result as any)._request_id).toBeUndefined();
  });
});

describe('responses stream typing', () => {
  test('hosted shell stream events are typed', () => {
    const commandAdded: Extract<
      OpenAI.Responses.ResponseStreamEvent,
      { type: 'response.shell_call_command.added' }
    > = {
      type: 'response.shell_call_command.added',
      command: '',
      command_index: 0,
      output_index: 0,
      sequence_number: 1,
    };
    expectType<string>(commandAdded.command);

    const commandDelta: Extract<
      OpenAI.Responses.ResponseStreamEvent,
      { type: 'response.shell_call_command.delta' }
    > = {
      type: 'response.shell_call_command.delta',
      command_index: 0,
      delta: 'python',
      obfuscation: '',
      output_index: 0,
      sequence_number: 2,
    };
    expectType<string>(commandDelta.delta);

    const commandDone: Extract<
      OpenAI.Responses.ResponseStreamEvent,
      { type: 'response.shell_call_command.done' }
    > = {
      type: 'response.shell_call_command.done',
      command: 'python main.py',
      command_index: 0,
      output_index: 0,
      sequence_number: 3,
    };
    expectType<string>(commandDone.command);

    const outputDelta: Extract<
      OpenAI.Responses.ResponseStreamEvent,
      { type: 'response.shell_call_output_content.delta' }
    > = {
      type: 'response.shell_call_output_content.delta',
      command_index: 0,
      delta: { stdout: '42' },
      item_id: 'item_1',
      output_index: 0,
      sequence_number: 4,
    };
    expectType<string | undefined>(outputDelta.delta.stdout);

    const outputDone: Extract<
      OpenAI.Responses.ResponseStreamEvent,
      { type: 'response.shell_call_output_content.done' }
    > = {
      type: 'response.shell_call_output_content.done',
      command_index: 0,
      item_id: 'item_1',
      output: [
        {
          stdout: '42',
          stderr: '',
          outcome: { type: 'exit', exit_code: 0 },
        },
      ],
      output_index: 0,
      sequence_number: 5,
    };
    expectType<Array<OpenAI.Responses.ResponseFunctionShellCallOutputContent>>(outputDone.output);

    expect(true).toBe(true);
  });
});

const unused = async () => {
  const stream = await client.responses.stream({
    model: 'gpt-5.1',
    input: 'Run a shell command.',
    tools: [{ type: 'shell' }],
  });

  stream.on('response.shell_call_command.delta', (event) => {
    expectType<string>(event.delta);
  });

  stream.on('response.shell_call_output_content.done', (event) => {
    expectType<Array<OpenAI.Responses.ResponseFunctionShellCallOutputContent>>(event.output);
  });
};
