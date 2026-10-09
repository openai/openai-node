import { vi } from 'vitest';
import OpenAI from 'openai';
import type { AgentSessionItem } from 'openai/resources/beta/agents/agents';

test.each(['promise', 'page'])('root turn item %s iteration follows the response cursor', async (mode) => {
  const items: AgentSessionItem[] = [
    {
      id: null,
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'legacy message' }],
      phase: null,
      status: 'completed',
      turn_id: 'turn_test',
    },
    {
      id: 'item_final',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'terminal page' }],
      phase: 'final_answer',
      status: 'completed',
      turn_id: 'turn_test',
    },
  ];
  const cursor = 'cursor:legacy/+=';
  const transport = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () =>
      Response.json({ error: { message: 'Unexpected third pagination request' } }, { status: 400 }),
    )
    .mockResolvedValueOnce(
      Response.json({ object: 'list', data: [items[0]], has_more: true, last_id: cursor }),
    )
    .mockResolvedValueOnce(
      Response.json({ object: 'list', data: [items[1]], has_more: false, last_id: 'cursor_final' }),
    );
  const client = new OpenAI({
    apiKey: 'synthetic-key',
    baseURL: 'https://example.test/v1',
    fetch: transport,
    maxRetries: 0,
  });

  const result = client.beta.agents.sessions.turns.items.list('turn_test', {
    session_id: 'session_test',
    limit: 1,
    order: 'asc',
  });
  const source = mode === 'page' ? await result : result;
  if (mode === 'page') {
    const page = await result;
    expect(page.last_id).toBe(cursor);
  }
  const received: AgentSessionItem[] = [];
  for await (const item of source) {
    received.push(item);
  }

  expect(received).toEqual(items);
  expect(transport).toHaveBeenCalledTimes(2);
  for (const [index, [input, init]] of transport.mock.calls.entries()) {
    const url = new URL(String(input));
    expect(init?.method).toBe('GET');
    expect(url.pathname).toBe('/v1/agents/sessions/session_test/turns/turn_test/items');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '1',
      order: 'asc',
      ...(index === 0 ? {} : { after: cursor }),
    });
  }
});
