import { vi } from 'vitest';
import OpenAI from 'openai';
import type { SessionUpdateParams } from 'openai/resources/beta/agents/sessions/sessions';

const cases: { name: string; body: SessionUpdateParams }[] = [
  { name: 'omitted settings', body: {} },
  { name: 'empty agent settings', body: { agent: {} } },
  { name: 'omitted reasoning effort', body: { agent: { reasoning: {} } } },
  { name: 'empty model', body: { agent: { model: '' } } },
  {
    name: 'populated settings',
    body: { agent: { model: 'gpt-5', reasoning: { effort: 'low' }, service_tier: 'priority' } },
  },
  { name: 'explicit null resets', body: { agent: { reasoning: { effort: null }, service_tier: null } } },
  { name: 'metadata update', body: { metadata: { purpose: 'test' } } },
  { name: 'null metadata', body: { metadata: null } },
  { name: 'empty metadata', body: { metadata: {} } },
];

test.each(cases)('session update preserves $name', async ({ body }) => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  const client = new OpenAI({
    apiKey: 'test-key',
    baseURL: 'https://example.test/v1',
    fetch: fetchMock,
    maxRetries: 0,
  });

  await client.beta.agents.sessions.update('session_test', body);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.test/v1/agents/sessions/session_test');
  expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(body);
});
