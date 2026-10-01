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
    successor?: boolean;
    manualEnvironment?: boolean;
    manualOrigin?: 'browser_origin_access' | 'browser_authentication';
    staleFunction?: boolean;
    staleEnvironment?: boolean;
    staleIdle?: boolean;
    historyReplay?: boolean;
    earlyIdle?: boolean;
    emptyRoot?: boolean;
    legacyCursor?: 'metadata' | 'missing' | 'repeat';
    firstApproval?: boolean;
    terminalStatus?: 'completed' | 'failed' | 'cancelled';
    multipleMessages?: boolean;
    baselineRace?: boolean;
    readEnd?: 'eof' | 'error';
    activeReadFailure?: boolean;
    historyFailure?: boolean;
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
    status: finished ? (config.terminalStatus ?? 'completed') : 'waiting',
    completed_at: finished ? 2 : null,
  });
  const session = () => {
    let required_actions: unknown[] = [
      {
        type: 'function_call',
        turn_id: config.successor && finished ? 'turn_successor' : turn.id,
        call_id: 'call_lookup',
        name: config.staleFunction ? 'stale_unknown' : 'lookup',
        arguments: '{}',
      },
    ];
    if (config.manualEnvironment || config.staleEnvironment) {
      required_actions = [{ type: 'environment_connection', environment_id: 'env_test' }];
    }
    if (config.manualOrigin) {
      required_actions = [
        {
          type: 'computer_use_approval_request',
          turn_id: turn.id,
          request_id: 'approval_test',
          request: { type: config.manualOrigin, origin: 'https://example.com', reason: null },
        },
      ];
    }
    let status = (finished && !config.successor) || config.staleIdle ? 'idle' : 'requires_action';
    if (!finished && config.staleEnvironment) {
      status = 'in_progress';
    }
    return {
      id: turn.session_id,
      status,
      required_actions: finished && !config.successor ? [] : required_actions,
    };
  };
  const complete = () => {
    finished = true;
    if (config.readEnd) {
      if (config.readEnd === 'eof') {
        controller.close();
      } else {
        controller.error(new Error('Synthetic SSE read failed'));
      }
      return;
    }
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
    // oxlint-disable-next-line complexity -- One synthetic transport explicitly enumerates the reconnect race cases.
    fetch: async (url, init) => {
      const req = new Request(url, init);
      requests.push(req);
      const path = new URL(req.url).pathname;
      if (path.endsWith('/turns')) {
        listCalls += 1;
        let data =
          config.emptyRoot || config.firstApproval || (config.noInitial && listCalls === 1)
            ? []
            : [currentTurn()];
        if ((config.baselineRace && listCalls === 1) || config.historyReplay) {
          data = [{ ...currentTurn(), id: 'turn_old', status: 'completed' }];
        }
        return Response.json({ object: 'list', data, has_more: false });
      }
      if (path.includes('/turns/')) {
        return Response.json(
          path.endsWith('/turn_old')
            ? { ...currentTurn(), id: 'turn_old', status: 'completed' }
            : currentTurn(),
        );
      }
      if (path.endsWith('/items')) {
        if (config.historyFailure) {
          return Response.json({ error: { message: 'History read failed' } }, { status: 500 });
        }
        if (config.multipleMessages) {
          const messages = ['First', 'Second'].map((text, index) => ({
            ...history,
            id: `message_${index}`,
            content: [{ type: 'output_text', text }],
          }));
          if (new URL(req.url).searchParams.get('order') !== 'asc') {
            messages.reverse();
          }
          return Response.json({ object: 'list', data: messages, has_more: false });
        }
        const after = new URL(req.url).searchParams.get('after');
        if (config.legacyCursor && (!after || config.legacyCursor === 'repeat')) {
          return Response.json({
            object: 'list',
            data: [history, { ...history, id: null, role: 'user', turn_id: 'turn_old' }],
            has_more: true,
            ...(config.legacyCursor === 'missing' ? {} : { last_id: 'cursor_legacy' }),
          });
        }
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
        if (config.firstApproval) {
          send({
            type: 'agent.session.turn.item.added',
            event_id: 'first_approval',
            turn_id: null,
            output_index: 0,
            item: { type: 'computer_use_approval_request', id: 'approval_item', turn_id: turn.id },
          });
        }
        if (config.earlyIdle) {
          send({
            type: 'agent.session.idle',
            event_id: 'early_idle',
            session: { ...session(), status: 'idle' },
          });
        }
        if (config.historyReplay) {
          send({
            type: 'agent.session.turn.item.added',
            event_id: 'historical_auth',
            turn_id: 'turn_old',
            output_index: 0,
            item: { type: 'computer_use_approval_request', id: 'old_auth', turn_id: 'turn_old' },
          });
        }
        if (config.race || config.baselineRace) {
          finished = true;
        }
        if (config.activeReadFailure) {
          controller.error(new Error('Synthetic SSE read failed'));
        }
        if (!finished && !config.manualEnvironment && !config.manualOrigin && !config.activeReadFailure) {
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
    const { client, requests } = attachTransport({ postFailure: true });
    await expect(
      client.beta.agents.sessions
        .stream(turn.session_id, { toolHandlers: { lookup: () => 'found' } })
        .finalResult(),
    ).rejects.toMatchObject({ reason: 'observation' });
    expect(requests.some((request) => new URL(request.url).pathname.endsWith('/items'))).toBe(false);
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
  test('settles the selected completed root without servicing a successor session action', async () => {
    const { client, requests } = attachTransport({ race: true, successor: true });
    const lookup = vi.fn(() => 'must not execute');
    const result = await client.beta.agents.sessions
      .stream(turn.session_id, { toolHandlers: { lookup } })
      .finalResult();
    expect(result.turn_id).toBe(turn.id);
    expect(result.output_text).toBe('Recovered answer');
    expect(lookup).not.toHaveBeenCalled();
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
  });
  test.each(['failed', 'cancelled'] as const)(
    'recovers durable partial messages before reporting %s',
    async (terminalStatus) => {
      const { client } = attachTransport({ race: true, terminalStatus });
      await expect(client.beta.agents.sessions.stream(turn.session_id).finalResult()).rejects.toMatchObject({
        reason: terminalStatus,
        messages: [expect.objectContaining({ id: history.id })],
      });
    },
  );
  test('reports a blocking environment connection without waiting for a nonexistent replay frame', async () => {
    const { client } = attachTransport({ manualEnvironment: true });
    await expect(client.beta.agents.sessions.stream(turn.session_id).finalResult()).rejects.toMatchObject({
      reason: 'requires_action',
      required_actions: [{ type: 'environment_connection', environment_id: 'env_test' }],
    });
  });
  test.each(['browser_origin_access', 'browser_authentication'] as const)(
    'reports a selected pending %s approval from its session snapshot',
    async (manualOrigin) => {
      const { client } = attachTransport({ manualOrigin });
      await expect(client.beta.agents.sessions.stream(turn.session_id).finalResult()).rejects.toMatchObject({
        reason: 'requires_action',
        required_actions: [
          expect.objectContaining({
            type: 'computer_use_approval_request',
            turn_id: turn.id,
            request: expect.objectContaining({ type: manualOrigin }),
          }),
        ],
      });
    },
  );
  test('ignores stale function snapshots and dispatches only the replayed function', async () => {
    const { client } = attachTransport({ staleFunction: true });
    const lookup = vi.fn(() => 'found');
    const result = await client.beta.agents.sessions
      .stream(turn.session_id, { toolHandlers: { lookup } })
      .finalResult();
    expect(result.output_text).toBe('Recovered answer');
    expect(lookup).toHaveBeenCalledOnce();
  });
  test('keeps helper ordering while preserving caller query options', async () => {
    const { client, requests } = attachTransport({ race: true, multipleMessages: true });
    const result = await client.beta.agents.sessions
      .stream(turn.session_id, {}, { query: { trace: 'yes' } })
      .finalResult();
    expect(result.output_text).toBe('FirstSecond');
    const listRequests = requests.filter((request) =>
      /\/(?:items|turns)$/u.test(new URL(request.url).pathname),
    );
    expect(listRequests.every((request) => new URL(request.url).searchParams.get('trace') === 'yes')).toBe(
      true,
    );
  });
  test('an idle baseline can select a distinct turn that starts and finishes during subscription', async () => {
    const { client } = attachTransport({ baselineRace: true });
    const result = await client.beta.agents.sessions.stream(turn.session_id).finalResult();
    expect(result.turn_id).toBe(turn.id);
    expect(result.output_text).toBe('Recovered answer');
  });
  test.each(['eof', 'error'] as const)(
    'one durable pass recovers terminal output after SSE %s',
    async (readEnd) => {
      const { client, requests } = attachTransport({ readEnd });
      const result = await client.beta.agents.sessions
        .stream(turn.session_id, { toolHandlers: { lookup: () => 'found' } })
        .finalResult();
      expect(result.output_text).toBe('Recovered answer');
      expect(requests.filter((request) => new URL(request.url).pathname.endsWith('/items'))).toHaveLength(1);
    },
  );
  test.each([false, true])(
    'preserves the original SSE error when recovery cannot establish completion (history failure %s)',
    async (historyFailure) => {
      const { client } = attachTransport(
        historyFailure ? { readEnd: 'error', historyFailure: true } : { activeReadFailure: true },
      );
      await expect(
        client.beta.agents.sessions
          .stream(turn.session_id, { toolHandlers: { lookup: () => 'found' } })
          .finalResult(),
      ).rejects.toMatchObject({ reason: 'observation', cause: { message: 'Synthetic SSE read failed' } });
    },
  );
  test.each(['staleEnvironment', 'staleIdle', 'earlyIdle'] as const)(
    'keeps observing the selected active turn despite %s projection',
    async (kind) => {
      const { client } = attachTransport({ [kind]: true });
      const handler = vi.fn(() => 'found');
      const result = await client.beta.agents.sessions
        .stream(turn.session_id, { toolHandlers: { lookup: handler } })
        .finalResult();
      expect(result.output_text).toBe('Recovered answer');
      expect(handler).toHaveBeenCalledOnce();
    },
  );

  test.each([false, true])(
    'historical authentication replay cannot select the old completed root (early idle %s)',
    async (earlyIdle) => {
      const { client } = attachTransport({ historyReplay: true, earlyIdle });
      const handler = vi.fn(() => 'found');
      const result = await client.beta.agents.sessions
        .stream(turn.session_id, { toolHandlers: { lookup: handler } })
        .finalResult();
      expect(result.turn_id).toBe(turn.id);
      expect(handler).toHaveBeenCalledOnce();
    },
  );
  test.each(['failed', 'cancelled'] as const)(
    'raw recovery preserves the read error for %s work',
    async (terminalStatus) => {
      const { client } = attachTransport({ readEnd: 'error', terminalStatus });
      await expect(
        drain(
          client.beta.agents.sessions.stream(turn.session_id, { toolHandlers: { lookup: () => 'found' } }),
        ),
      ).rejects.toThrow('Synthetic SSE read failed');
    },
  );
  test.each([false, true])(
    'reports environment connection with no selected work (historical roots %s)',
    async (historyReplay) => {
      const { client } = attachTransport({
        emptyRoot: !historyReplay,
        historyReplay,
        manualEnvironment: true,
      });
      await expect(client.beta.agents.sessions.stream(turn.session_id).finalResult()).rejects.toMatchObject({
        reason: 'requires_action',
        session_id: turn.session_id,
        required_actions: [{ type: 'environment_connection', environment_id: 'env_test' }],
      });
    },
  );
  test('an explicit parsed attachment type cannot omit its format', () => {
    const { client } = attachTransport({ idle: true });
    const checkTypes = () =>
      // @ts-expect-error An explicit parsed type requires parameters containing outputFormat.
      client.beta.agents.sessions.stream<{ summary: string }>(turn.session_id);
    expect(checkTypes).toBeTypeOf('function');
  });
  test('continues through a legacy null item using the response cursor', async () => {
    const { client, requests } = attachTransport({ race: true, legacyCursor: 'metadata' });
    const result = await client.beta.agents.sessions.stream(turn.session_id).finalResult();
    expect(result.output_text).toBe('Recovered answer');
    expect(
      requests.some((request) => new URL(request.url).searchParams.get('after') === 'cursor_legacy'),
    ).toBe(true);
  });
  test.each(['missing', 'repeat'] as const)(
    'does not return partial success when pagination cursor is %s',
    async (legacyCursor) => {
      const { client } = attachTransport({ race: true, legacyCursor });
      await expect(client.beta.agents.sessions.stream(turn.session_id).finalResult()).rejects.toMatchObject({
        reason: 'observation',
        messages: [expect.objectContaining({ id: history.id })],
      });
    },
  );
  test('diagnoses an approval when its replay first identifies the selected root', async () => {
    const { client } = attachTransport({ firstApproval: true, manualOrigin: 'browser_authentication' });
    await expect(client.beta.agents.sessions.stream(turn.session_id).finalResult()).rejects.toMatchObject({
      reason: 'requires_action',
      turn: expect.objectContaining({ id: turn.id }),
      required_actions: [expect.objectContaining({ type: 'computer_use_approval_request' })],
    });
  });
});
