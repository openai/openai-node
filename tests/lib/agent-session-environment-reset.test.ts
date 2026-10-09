import { expect, test, vi } from 'vitest';

import OpenAI from 'openai';
import type { AgentSessionEnvironmentResetEvent, AgentSessionEvent } from 'openai/resources/beta/agents';

test.each([
  { turnID: null, resetCount: 0 },
  { turnID: 'turn_synthetic', resetCount: 7 },
])('decodes an environment reset with turn $turnID and count $resetCount', async ({ turnID, resetCount }) => {
  const expected: AgentSessionEnvironmentResetEvent = {
    type: 'agent.session.environment.reset',
    event_id: 'event_synthetic',
    session_id: 'session_synthetic',
    environment_id: 'environment_synthetic',
    turn_id: turnID,
    reset_count: resetCount,
  };
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
    const request = new Request(input, init);
    expect(request.method).toBe('GET');
    expect(new URL(request.url).pathname).toBe('/v1/agents/sessions/session_synthetic/events');
    return Promise.resolve(
      new Response(`data: ${JSON.stringify(expected)}\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
  });
  const client = new OpenAI({
    apiKey: 'synthetic',
    baseURL: 'https://sdk-test.example/v1',
    maxRetries: 0,
    fetch,
  });
  const stream = await client.beta.agents.sessions.events.stream('session_synthetic');
  const events: AgentSessionEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }

  expect(events).toEqual([expected]);
  expect(fetch).toHaveBeenCalledOnce();
  const [event] = events;
  if (event?.type !== 'agent.session.environment.reset') {
    throw new Error('Expected the reset event from the public session event stream');
  }

  const reset: AgentSessionEnvironmentResetEvent = event;
  expect(reset.turn_id).toBe(turnID);
  expect(reset.reset_count).toBe(resetCount);
  expect(reset.environment_id).toBe('environment_synthetic');
});
