import OpenAI from 'openai';
import type { FinalRequestOptions } from 'openai/internal/request-options';
import { isObj } from 'openai/internal/utils/values';
import { standardTextFormat } from 'openai/helpers/standard-schema';
import { zodTextFormat } from 'openai/helpers/zod';
import { expect, test } from 'vitest';
import { z as z3 } from 'zod/v3';
import { z } from 'zod/v4';
import { compareType } from '../utils/typing';

const shortAnswer = zodTextFormat(z.object({ answer: z.string() }), 'short_answer');
const withEvidence = zodTextFormat(z.object({ evidence: z.array(z.string()) }), 'with_evidence');

function clientWithPreparation(prepare: (options: FinalRequestOptions) => void): typeof OpenAI {
  return class extends OpenAI {
    protected override async prepareOptions(options: FinalRequestOptions) {
      await super.prepareOptions(options);
      prepare(options);
    }
  };
}

function clientReturning(
  text: string,
  inspect?: (request: Request, body: unknown) => void,
  toolCall?: OpenAI.Responses.ResponseFunctionToolCall,
  Client: typeof OpenAI = OpenAI,
) {
  const response = {
    id: 'resp_test',
    object: 'response',
    status: 'completed',
    output: [
      {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
      ...(toolCall ? [toolCall] : []),
    ],
  };
  return new Client({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: async (url, init) => {
      const request = new Request(url, init);
      const body: unknown = request.method === 'GET' ? undefined : await request.json();
      inspect?.(request, body);
      if (
        request.method !== 'GET' &&
        !(typeof body === 'object' && body !== null && 'stream' in body && body.stream)
      ) {
        return Response.json(response);
      }
      const events = [
        {
          type: 'response.created',
          sequence_number: 0,
          response: { ...response, status: 'in_progress', output: [] },
        },
        { type: 'response.completed', sequence_number: 1, response },
      ];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
}

test.each([
  ['Zod 4', withEvidence],
  ['Zod 3', zodTextFormat(z3.object({ evidence: z3.array(z3.string()) }), 'evidence_v3')],
  ['Standard Schema', standardTextFormat(z.object({ evidence: z.array(z.string()) }), 'evidence_standard')],
] as const)('%s uses the last format update for JSON and SSE', async (_name, format) => {
  const client = clientReturning('{"evidence":["source"]}');
  const input = [
    { type: 'configuration_update', text: { format: shortAnswer } },
    { type: 'configuration_update', text: { format } },
    { type: 'configuration_update', reasoning: { effort: 'low' } },
  ] satisfies OpenAI.Responses.ResponseInput;
  for (const response of [
    await client.responses.parse({ model: 'gpt-test', text: { format: shortAnswer }, input }),
    await client.responses
      .stream({ model: 'gpt-test', text: { format: shortAnswer }, input })
      .finalResponse(),
  ]) {
    expect(response.output_parsed).toEqual({ evidence: ['source'] });
    expect(response.output[0]).toMatchObject({ content: [{ parsed: response.output_parsed }] });
  }
});

test('an inline update infers its parser even when the top-level format differs', async () => {
  const client = clientReturning('{"evidence":[]}');
  const parsed = await client.responses.parse({
    text: { format: shortAnswer },
    input: [
      { type: 'configuration_update', text: { format: shortAnswer } },
      { type: 'configuration_update', text: { format: withEvidence } },
      { type: 'configuration_update', reasoning: { effort: 'low' } },
    ],
  });
  const streamed = await client.responses
    .stream({
      input: [{ type: 'configuration_update', text: { format: withEvidence } }],
    })
    .finalResponse();
  compareType<typeof parsed.output_parsed, { evidence: string[] } | null>(true);
  compareType<typeof streamed.output_parsed, { evidence: string[] } | null>(true);
  expect([parsed.output_parsed, streamed.output_parsed]).toEqual([{ evidence: [] }, { evidence: [] }]);
});

test('a raw schema parses JSON and a plain-text update turns parsing off', async () => {
  const format = { type: 'json_schema', name: 'raw', schema: { type: 'object' } } as const;
  const raw = await clientReturning('{"raw":42}').responses.parse({
    text: { format: shortAnswer },
    input: [{ type: 'configuration_update', text: { format } }],
  });
  compareType<typeof raw.output_parsed, unknown>(true);
  expect(raw.output_parsed).toEqual({ raw: 42 });

  const reset = await clientReturning('ordinary text')
    .responses.stream({
      text: { format: shortAnswer },
      input: [
        { type: 'configuration_update', text: { format: withEvidence } },
        { type: 'configuration_update', text: { format: { type: 'text' } } },
        { type: 'configuration_update', reasoning: { effort: 'low' } },
      ],
    })
    .finalResponse();
  compareType<typeof reset.output_parsed, null>(true);
  expect(reset.output_parsed).toBeNull();
  expect(reset.output_text).toBe('ordinary text');
});

test('a continuation can select a local parser without sending another format', async () => {
  const body = { previous_response_id: 'resp_previous', input: 'Explain further' };
  const options = { parseAs: withEvidence, headers: { 'X-Test-Parser': 'retained' } };
  const client = clientReturning('{"evidence":["source"]}', (request, wire) => {
    expect(request.headers.get('X-Test-Parser')).toBe('retained');
    expect(wire).toMatchObject(body);
    expect(wire).not.toHaveProperty('text');
    expect(wire).not.toHaveProperty('parseAs');
  });
  const parsed = await client.responses.parse(body, options);
  const streamed = await client.responses.stream(body, options).finalResponse();
  compareType<typeof parsed.output_parsed, { evidence: string[] } | null>(true);
  compareType<typeof streamed.output_parsed, { evidence: string[] } | null>(true);
  expect([parsed.output_parsed, streamed.output_parsed]).toEqual([
    { evidence: ['source'] },
    { evidence: ['source'] },
  ]);
  expect(options.parseAs).toBe(withEvidence);
});

test('a local opt-out preserves the wire format and a reset rejects a conflicting parser', async () => {
  const client = clientReturning('ordinary text', (_request, wire) => {
    expect(wire).toMatchObject({ text: { format: { type: 'json_schema', name: 'short_answer' } } });
    expect(wire).not.toHaveProperty('parseAs');
  });
  const skipped = await client.responses.parse({ text: { format: shortAnswer } }, { parseAs: null });
  compareType<typeof skipped.output_parsed, null>(true);
  expect(skipped.output_parsed).toBeNull();
  expect(skipped.output_text).toBe('ordinary text');
  const reset = {
    input: [{ type: 'configuration_update', text: { format: { type: 'text' } } }],
  } satisfies OpenAI.Responses.ResponseCreateParamsNonStreaming;
  expect(() => client.responses.parse(reset, { parseAs: withEvidence })).toThrow('plain-text format update');
  expect(() => client.responses.stream(reset, { parseAs: withEvidence })).toThrow('plain-text format update');
});

test('replayed streams accept a local parser without adding retrieval parameters', async () => {
  const client = clientReturning('{"evidence":[]}', (request) => {
    expect(request.method).toBe('GET');
    expect(new URL(request.url).searchParams.has('parseAs')).toBe(false);
  });
  const final = await client.responses
    .stream({ response_id: 'resp_test' }, { parseAs: withEvidence })
    .finalResponse();
  compareType<typeof final.output_parsed, { evidence: string[] } | null>(true);
  expect(final.output_parsed).toEqual({ evidence: [] });
});

test('optional parser settings and mutable update histories retain every possible output type', async () => {
  const client = clientReturning('{"answer":"yes"}');
  function parseWith(options: { parseAs?: typeof withEvidence | null }) {
    return client.responses.parse({ text: { format: shortAnswer } }, options);
  }
  const withOptions = await parseWith({});
  compareType<typeof withOptions.output_parsed, { answer: string } | { evidence: string[] } | null>(true);
  expect(withOptions.output_parsed).toEqual({ answer: 'yes' });
  const disabled = await parseWith({ parseAs: null });
  expect(disabled.output_parsed).toBeNull();

  const updates: { type: 'configuration_update'; text: { format: typeof withEvidence } }[] = [];
  const withUpdates = await client.responses.parse({ text: { format: shortAnswer }, input: updates });
  compareType<typeof withUpdates.output_parsed, { answer: string } | { evidence: string[] } | null>(true);
  expect(withUpdates.output_parsed).toEqual({ answer: 'yes' });
});

test.each(['parse', 'stream'] as const)(
  '%s retains the format that was sent when shared history changes after serialization',
  async (mode) => {
    const input: OpenAI.Responses.ResponseInput = [];
    const client = clientReturning('{"answer":"sent"}', (_request, wire) => {
      expect(wire).toMatchObject({
        input: [],
        text: { format: { type: 'json_schema', name: 'short_answer' } },
      });
      input.push({ type: 'configuration_update', text: { format: withEvidence } });
    });
    const body = { text: { format: shortAnswer }, input };
    const result =
      mode === 'parse'
        ? await client.responses.parse(body)
        : await client.responses.stream(body).finalResponse();
    expect(result.output_parsed).toEqual({ answer: 'sent' });
  },
);

test.each(['parse', 'stream'] as const)(
  '%s selects the parser after a format update removes its text during serialization',
  async (mode) => {
    let serializations = 0;
    const item: OpenAI.Responses.ResponseConfigurationUpdateItemParam & {
      toJSON: () => OpenAI.Responses.ResponseConfigurationUpdateItemParam;
    } = {
      type: 'configuration_update',
      reasoning: { effort: 'low' },
      text: { format: withEvidence },
      toJSON() {
        serializations += 1;
        delete this.text;
        return this;
      },
    };
    const client = clientReturning('{"answer":"sent"}', (_request, wire) => {
      expect(wire).toMatchObject({
        input: [{ type: 'configuration_update', reasoning: { effort: 'low' } }],
        text: { format: { type: 'json_schema', name: 'short_answer' } },
      });
      expect(wire).not.toHaveProperty('input.0.text');
    });
    const body = { text: { format: shortAnswer }, input: [item] };
    const result =
      mode === 'parse'
        ? await client.responses.parse(body)
        : await client.responses.stream(body).finalResponse();
    expect(serializations).toBe(1);
    expect(result.output_parsed).toEqual({ answer: 'sent' });
  },
);

test.each(['parse', 'stream'] as const)(
  '%s accepts an explicit parser when toJSON omits a locally visible format',
  async (mode) => {
    const item = {
      type: 'configuration_update' as const,
      reasoning: { effort: 'low' as const },
      text: { format: withEvidence },
      toJSON() {
        return { type: this.type, reasoning: this.reasoning };
      },
    };
    const client = clientReturning('{"answer":"sent"}', (_request, wire) => {
      expect(wire).toMatchObject({
        input: [{ type: 'configuration_update', reasoning: { effort: 'low' } }],
        text: { format: { type: 'json_schema', name: 'short_answer' } },
      });
      expect(wire).not.toHaveProperty('input.0.text');
      expect(wire).not.toHaveProperty('parseAs');
    });
    const body = { text: { format: shortAnswer }, input: [item] };
    const options = { parseAs: shortAnswer };
    const result =
      mode === 'parse'
        ? await client.responses.parse(body, options)
        : await client.responses.stream(body, options).finalResponse();
    expect(result.output_parsed).toEqual({ answer: 'sent' });
    expect(item.text.format).toBe(withEvidence);
  },
);

test.each(['parse', 'stream'] as const)(
  '%s captures the format selected by prepareOptions on the successful retry',
  async (mode) => {
    let attempts = 0;
    const PreparedClient = clientWithPreparation((options) => {
      attempts += 1;
      if (attempts === 2 && isObj(options.body)) {
        options.body = { ...options.body, text: { format: withEvidence } };
      }
    });
    const client = clientReturning(
      '{"evidence":["retried"]}',
      (_request, wire) => {
        if (attempts === 1) {
          expect(wire).toMatchObject({ text: { format: { name: 'short_answer' } } });
          throw new Error('synthetic transport retry');
        }
        expect(wire).toMatchObject({ text: { format: { name: 'with_evidence' } } });
      },
      undefined,
      PreparedClient,
    ).withOptions({ maxRetries: 1 });
    const body = { text: { format: shortAnswer } };
    const result =
      mode === 'parse'
        ? await client.responses.parse(body)
        : await client.responses.stream(body).finalResponse();
    expect(attempts).toBe(2);
    expect(result.output_parsed).toEqual({ evidence: ['retried'] });
  },
);

test('turning off text parsing still parses strict tool arguments in the stream', async () => {
  const call = {
    type: 'function_call',
    id: 'fc_test',
    call_id: 'call_test',
    name: 'record',
    arguments: '{"value":42}',
  } as const;
  const client = clientReturning('ordinary text', undefined, call);
  const final = await client.responses
    .stream(
      {
        text: { format: shortAnswer },
        input: [{ type: 'configuration_update', text: { format: { type: 'text' } } }],
        tools: [{ type: 'function', name: 'record', strict: true, parameters: { type: 'object' } }],
      },
      { parseAs: null },
    )
    .finalResponse();
  expect(final.output_parsed).toBeNull();
  expect(final.output).toContainEqual({ ...call, parsed_arguments: { value: 42 } });
});

test('a format change remains typed across a long literal message history', async () => {
  const note = { role: 'user', content: 'Explain the preceding answer.' } as const;
  const four = [note, note, note, note] as const;
  const sixteen = [...four, ...four, ...four, ...four] as const;
  const subsequent = [...sixteen, ...sixteen, ...sixteen, ...sixteen] as const;
  const client = clientReturning('{"evidence":[]}');
  const parsed = await client.responses.parse({
    text: { format: shortAnswer },
    input: [{ type: 'configuration_update', text: { format: withEvidence } }, ...subsequent, ...subsequent],
  });
  compareType<typeof parsed.output_parsed, { evidence: string[] } | null>(true);
  expect(parsed.output_parsed).toEqual({ evidence: [] });

  const block = [...subsequent, ...subsequent, ...subsequent, ...subsequent] as const;
  const large = await client.responses.parse({
    input: [
      { type: 'configuration_update', text: { format: withEvidence } },
      ...block,
      ...block,
      ...block,
      ...block,
    ],
  });
  compareType<typeof large.output_parsed, { evidence: string[] } | null>(true);
  expect(large.output_parsed).toEqual({ evidence: [] });
});

test('spreading ordinary create parameters preserves an explicitly selected Zod result type', async () => {
  const client = clientReturning('{"answer":"yes"}');
  function parse(body: OpenAI.Responses.ResponseCreateParamsNonStreaming) {
    return client.responses.parse({ ...body, text: { ...body.text, format: shortAnswer } });
  }
  const result = await parse({ input: 'Please answer' });
  compareType<typeof result.output_parsed, { answer: string } | null>(true);
  expect(result.output_parsed?.answer).toBe('yes');

  function withExplicitInput(input: OpenAI.Responses.ResponseInput) {
    return client.responses.parse({ input, text: { format: shortAnswer } });
  }
  const fromHistory = await withExplicitInput([]);
  compareType<typeof fromHistory.output_parsed, unknown>(true);
  expect(fromHistory.output_parsed).toEqual({ answer: 'yes' });
});

test.each(['nested format', 'replacement body', 'new update'] as const)(
  'parse and stream read a %s from the prepared request',
  async (change) => {
    const PreparedClient = clientWithPreparation((options) => {
      if (!isObj(options.body) || !isObj(options.body['text'])) {
        throw new Error('Missing text settings');
      }
      if (change === 'nested format') {
        options.body['text']['format'] = withEvidence;
      } else if (change === 'replacement body') {
        options.body = { ...options.body, text: { format: withEvidence } };
      } else {
        options.body = {
          ...options.body,
          input: [{ type: 'configuration_update', text: { format: withEvidence } }],
        };
      }
    });
    const client = clientReturning(
      '{"evidence":["prepared"]}',
      (_request, wire) => {
        if (change === 'new update') {
          expect(wire).toMatchObject({
            input: [{ type: 'configuration_update', text: { format: { name: 'with_evidence' } } }],
          });
        } else {
          expect(wire).toMatchObject({ text: { format: { name: 'with_evidence' } } });
        }
      },
      undefined,
      PreparedClient,
    );
    const parsed = await client.responses.parse({ text: { format: shortAnswer } });
    const streamed = await client.responses.stream({ text: { format: shortAnswer } }).finalResponse();
    expect([parsed.output_parsed, streamed.output_parsed]).toEqual([
      { evidence: ['prepared'] },
      { evidence: ['prepared'] },
    ]);
    const skipped = await client.responses.parse({ text: { format: shortAnswer } }, { parseAs: null });
    expect(skipped.output_parsed).toBeNull();
  },
);

test.each(['parse', 'stream'] as const)('%s rejects a prepared text reset before dispatch', async (mode) => {
  const ResetClient = clientWithPreparation((options) => {
    options.body = {
      stream: true,
      input: [{ type: 'configuration_update', text: { format: { type: 'text' } } }],
    };
  });
  let requests = 0;
  const client = new ResetClient({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: async () => {
      requests += 1;
      return new Response(null, { headers: { 'Content-Type': 'text/event-stream' } });
    },
  });
  const body = { input: 'Continue' };
  const result =
    mode === 'parse'
      ? client.responses.parse(body, { parseAs: withEvidence })
      : client.responses.stream(body, { parseAs: withEvidence }).finalResponse();
  await expect(result).rejects.toThrow('Cannot use parseAs with a plain-text format update.');
  expect(requests).toBe(0);
});
