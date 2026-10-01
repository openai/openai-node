import { describe, expect, test, vi } from 'vitest';
import OpenAI from 'openai';
import { AgentTurnResultError } from 'openai/lib/beta/agents/agent-turn-result-error';
import type { Turn } from 'openai/resources/beta/agents/sessions/turns';

const turn: Turn = {
  id: 'turn_active',
  session_id: 'session_test',
  agent_id: 'agent_test',
  object: 'agent.session.turn',
  status: 'waiting',
  subagent_id: null,
  created_at: 1,
  started_at: 1,
  completed_at: null,
  error: null,
  usage: null,
};
const history = {
  id: 'message_final',
  type: 'message',
  role: 'assistant',
  phase: 'final_answer',
  status: 'completed',
  turn_id: turn.id,
  content: [{ type: 'output_text', text: 'Recovered answer' }],
};
function attachTransport(
  config: {
    idle?: boolean;
    race?: boolean;
    duplicate?: boolean;
    noInitial?: boolean;
    nullID?: boolean;
    paginated?: boolean;
    observed?: boolean;
    postFailure?: boolean;
    missingHandler?: boolean;
  } = {},
) {
  const requests: Request[] = [];
  let finished = !!config.idle;
  let subscribed = false;
  let listCalls = 0;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel: cancelled,
  });
  const send = (event: Record<string, unknown>) =>
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  const currentTurn = () => ({
    ...turn,
    status: finished ? 'completed' : 'waiting',
    completed_at: finished ? 2 : null,
  });
  const session = () => ({
    id: turn.session_id,
    status: finished ? 'idle' : 'requires_action',
    required_actions: finished
      ? []
      : [
          {
            type: 'function_call',
            turn_id: turn.id,
            call_id: 'call_lookup',
            name: 'lookup',
            arguments: '{}',
          },
        ],
  });
  const complete = () => {
    finished = true;
    if (config.observed) {
      send({
        type: 'agent.session.turn.item.done',
        event_id: 'answer',
        turn_id: turn.id,
        output_index: 0,
        item: {
          ...history,
          content: [
            {
              type: 'output_text',
              text: 'Recovered answer',
              annotations: [
                {
                  type: 'url_citation',
                  url: 'https://example.com',
                  title: 'Source',
                  start_index: 0,
                  end_index: 1,
                },
              ],
            },
          ],
        },
      });
    }
    send({
      type: 'agent.session.turn.completed',
      event_id: 'completed',
      turn_id: turn.id,
      turn: currentTurn(),
    });
    send({ type: 'agent.session.idle', event_id: 'idle', session: session() });
  };
  const client = new OpenAI({
    apiKey: 'synthetic',
    maxRetries: 0,
    fetch: async (url, init) => {
      const req = new Request(url, init);
      requests.push(req);
      const path = new URL(req.url).pathname;
      if (path.endsWith('/turns')) {
        listCalls += 1;
        const data = config.noInitial && listCalls === 1 ? [] : [currentTurn()];
        return Response.json({ object: 'list', data, has_more: false });
      }
      if (path.includes('/turns/')) {
        return Response.json(currentTurn());
      }
      if (path.endsWith('/items')) {
        const after = new URL(req.url).searchParams.get('after');
        if (config.paginated && !after) {
          return Response.json({
            object: 'list',
            data: [{ ...history, id: 'other', turn_id: 'turn_older' }],
            has_more: true,
            last_id: 'other',
          });
        }
        return Response.json({
          object: 'list',
          data: [{ ...history, id: config.nullID ? null : history.id }],
          has_more: false,
        });
      }
      if (path.endsWith('/events')) {
        if (req.method === 'POST') {
          if (config.postFailure) {
            return Response.json({ error: { message: 'Submission failed' } }, { status: 500 });
          }
          complete();
          return new Response(null, { status: 204 });
        }
        subscribed = true;
        if (config.race) {
          finished = true;
        }
        if (!finished) {
          const call = {
            type: 'agent.session.turn.item.added',
            event_id: 'call',
            turn_id: turn.id,
            output_index: 0,
            item: {
              type: 'function_call',
              id: 'function_item',
              call_id: 'call_lookup',
              turn_id: turn.id,
              name: 'lookup',
              arguments: '{}',
              status: 'in_progress',
            },
          };
          send(call);
          if (config.duplicate) {
            send({ ...call, event_id: 'call_duplicate' });
          }
        }
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
      }
      expect(subscribed).toBe(true);
      return Response.json(session());
    },
  });
  return { client, requests, cancelled };
}
async function drain(events: AsyncIterable<unknown>) {
  for await (const _event of events) {
    /* stream only */
  }
}

describe('beta agents stream attachment', () => {
  test.each([false, true])(
    'dispatches replayed pending calls once without resending input (late root %s)',
    async (noInitial) => {
      const { client, requests } = attachTransport({ duplicate: true, noInitial, paginated: true });
      const lookup = vi.fn(() => 'found');
      const result = await client.beta.agents.sessions
        .stream(turn.session_id, { toolHandlers: { lookup } })
        .finalResult();
      expect(result.turn_id).toBe(turn.id);
      expect(result.output_text).toBe('Recovered answer');
      expect(lookup).toHaveBeenCalledOnce();
      const posts = requests.filter((request) => request.method === 'POST');
      expect(posts).toHaveLength(1);
      expect(await posts[0]?.json()).toMatchObject({
        events: [{ type: 'agent.session.input.tool_result', call_id: 'call_lookup', turn_id: turn.id }],
      });
      expect(requests.filter((req) => new URL(req.url).pathname.endsWith('/items'))).toHaveLength(2);
    },
  );
  test('recovers completion between discovery and subscription without waiting for another event', async () => {
    const { client, requests, cancelled } = attachTransport({ race: true });
    const result = await client.beta.agents.sessions.stream(turn.session_id).finalResult();
    expect(result.output_text).toBe('Recovered answer');
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
    expect(cancelled).toHaveBeenCalled();
  });
  test('idle attachment drains but never returns an arbitrary older result', async () => {
    const first = attachTransport({ idle: true });
    await drain(first.client.beta.agents.sessions.stream(turn.session_id));
    expect(first.requests.some((req) => new URL(req.url).pathname.endsWith('/items'))).toBe(false);
    const second = attachTransport({ idle: true });
    await expect(
      second.client.beta.agents.sessions.stream(turn.session_id).finalResult(),
    ).rejects.toMatchObject({ reason: 'observation', turn_id: undefined });
  });
  test('raw iteration does not fetch or retain final output history', async () => {
    const { client, requests } = attachTransport();
    const stream = client.beta.agents.sessions.stream(turn.session_id, {
      toolHandlers: { lookup: () => 'found' },
    });
    await drain(stream);
    expect(requests.some((req) => new URL(req.url).pathname.endsWith('/items'))).toBe(false);
    await expect(stream.finalResult()).rejects.toThrow('withResultCollection');
  });
  test('progress then result preserves observed annotations during durable reconciliation', async () => {
    const { client } = attachTransport({ observed: true });
    const stream = client.beta.agents.sessions
      .stream(turn.session_id, { toolHandlers: { lookup: () => 'found' } })
      .withResultCollection();
    await drain(stream);
    const result = await stream.finalResult();
    expect(result.messages[0]?.content[0]).toMatchObject({
      annotations: [expect.objectContaining({ title: 'Source' })],
    });
    expect(await stream.finalResult()).toBe(result);
  });
  test('does not silently discard a historical final message with a missing identity', async () => {
    const { client } = attachTransport({ race: true, nullID: true });
    await expect(client.beta.agents.sessions.stream(turn.session_id).finalResult()).rejects.toBeInstanceOf(
      AgentTurnResultError,
    );
  });
  test('unhandled actions are not mistaken for successful completion', async () => {
    const { client } = attachTransport();
    await expect(client.beta.agents.sessions.stream(turn.session_id).finalResult()).rejects.toMatchObject({
      reason: 'requires_action',
    });
  });
  test('handler failures submit redacted errors through the existing dispatcher', async () => {
    const { client, requests } = attachTransport();
    await client.beta.agents.sessions
      .stream(turn.session_id, {
        toolHandlers: {
          lookup: () => {
            throw new Error('private failure');
          },
        },
      })
      .finalResult();
    const post = requests.find((req) => req.method === 'POST');
    expect(await post?.json()).toMatchObject({ events: [{ success: false, error: 'Tool handler failed.' }] });
  });
  test('failed result submission leaves recovery to a new attachment', async () => {
    const { client } = attachTransport({ postFailure: true });
    await expect(
      client.beta.agents.sessions
        .stream(turn.session_id, { toolHandlers: { lookup: () => 'found' } })
        .finalResult(),
    ).rejects.toMatchObject({ reason: 'observation' });
  });
  test('a new attachment can handle a call abandoned before dispatch; answered calls are not replayed', async () => {
    const handler = vi.fn(() => 'found');
    const first = attachTransport();
    // oxlint-disable-next-line no-unreachable-loop -- Break at the first frame to simulate a disconnect before dispatch.
    for await (const event of first.client.beta.agents.sessions.stream(turn.session_id, {
      toolHandlers: { lookup: handler },
    })) {
      expect(event.type).toBe('agent.session.turn.item.added');
      break;
    }
    expect(handler).not.toHaveBeenCalled();
    const second = attachTransport();
    await second.client.beta.agents.sessions
      .stream(turn.session_id, { toolHandlers: { lookup: handler } })
      .finalResult();
    expect(handler).toHaveBeenCalledOnce();
    const third = attachTransport({ idle: true });
    await drain(
      third.client.beta.agents.sessions.stream(turn.session_id, { toolHandlers: { lookup: handler } }),
    );
    expect(handler).toHaveBeenCalledOnce();
    expect(third.requests.some((req) => req.method === 'POST')).toBe(false);
  });
});
